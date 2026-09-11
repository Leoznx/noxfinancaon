import fs from "node:fs/promises";
import os from "node:os";
import { env } from "./env";
import { inspectAutomationLock } from "./automationLock";
import { redactObject } from "./redaction";
import type { DiagnosticSnapshot, HealthStatus } from "./recoveryTypes";
import { supabaseAdmin } from "./supabaseAdmin";

async function readNumber(file: string): Promise<number | null> {
  try {
    const value = (await fs.readFile(file, "utf8")).trim();
    if (value === "max") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function fetchJson(url: string, timeoutMs = 8_000): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function portalReachable(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(env.credpagoUrl, {
      method: "HEAD",
      redirect: "manual",
      signal: controller.signal,
    });
    return response.status > 0 && response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function collectSystemDiagnostics(): Promise<DiagnosticSnapshot> {
  const [cgroupLimit, cgroupUsed, creditHealth, lock, portalOk] = await Promise.all([
    readNumber("/sys/fs/cgroup/memory.max"),
    readNumber("/sys/fs/cgroup/memory.current"),
    fetchJson(`http://127.0.0.1:${env.healthPort}/health`),
    inspectAutomationLock(env.automationLockPath),
    portalReachable(),
  ]);

  let databaseReachable = false;
  let activeConsultations = 0;
  try {
    const { count, error } = await supabaseAdmin
      .from("consultas_credito")
      .select("id", { count: "exact", head: true })
      .eq("status", "processando")
      .eq("origem", "nox_financa");
    if (error) throw error;
    databaseReachable = true;
    activeConsultations = count ?? 0;
  } catch {
    databaseReachable = false;
  }

  const memoryLimit = cgroupLimit && cgroupLimit < Number.MAX_SAFE_INTEGER ? cgroupLimit : os.totalmem();
  const memoryUsed = cgroupUsed ?? os.totalmem() - os.freemem();
  const memoryPercent = memoryLimit > 0 ? Math.round((memoryUsed / memoryLimit) * 10_000) / 100 : null;
  const load = os.loadavg()[0];
  const cpuPercent = os.cpus().length > 0 ? Math.min(100, Math.round((load / os.cpus().length) * 10_000) / 100) : null;

  let diskUsedPercent: number | null = null;
  let diskFreeBytes: number | null = null;
  try {
    const stats = await fs.statfs(env.repairArtifactDir).catch(() => fs.statfs(pathRoot(env.repairArtifactDir)));
    const total = Number(stats.blocks) * Number(stats.bsize);
    diskFreeBytes = Number(stats.bavail) * Number(stats.bsize);
    diskUsedPercent = total > 0 ? Math.round(((total - diskFreeBytes) / total) * 10_000) / 100 : null;
  } catch {
    // Mantem null: falta de metrica nunca vira zero saudavel.
  }

  return {
    collectedAt: new Date().toISOString(),
    environment: env.automationEnvironment,
    vpsId: env.vpsId,
    automationVersion: env.automationVersion,
    runtime: `node ${process.version}; ${process.platform}/${process.arch}`,
    cpuPercent,
    memoryPercent,
    memoryUsedBytes: memoryUsed,
    memoryLimitBytes: memoryLimit,
    diskUsedPercent,
    diskFreeBytes,
    creditWorkerReachable: creditHealth != null,
    creditWorkerReady: creditHealth?.ready === true,
    creditWorkerHealth: (redactObject(creditHealth ?? {}) as Record<string, unknown>) || {},
    databaseReachable,
    portalReachable: portalOk,
    activeConsultations,
    sessionLock: lock,
  };
}

function pathRoot(input: string): string {
  const parsed = input.match(/^([A-Za-z]:[\\/]|\/)/);
  return parsed?.[1] || ".";
}

export function overallHealthStatus(snapshot: DiagnosticSnapshot): HealthStatus {
  if (!snapshot.databaseReachable || !snapshot.creditWorkerReachable) return "OFFLINE";
  if (
    !snapshot.creditWorkerReady ||
    !snapshot.portalReachable ||
    (snapshot.cpuPercent != null && snapshot.cpuPercent >= env.highCpuPercent) ||
    (snapshot.memoryPercent != null && snapshot.memoryPercent >= env.highMemoryPercent) ||
    (snapshot.diskUsedPercent != null && snapshot.diskUsedPercent >= env.lowDiskUsedPercent)
  ) return "UNSTABLE";
  return "ONLINE";
}

export function healthComponents(snapshot: DiagnosticSnapshot): Array<{
  component: string;
  status: HealthStatus;
  summary: string;
  metrics: Record<string, unknown>;
}> {
  const thresholdStatus = (value: number | null, limit: number): HealthStatus =>
    value == null ? "UNKNOWN" : value >= limit ? "UNSTABLE" : "ONLINE";
  return [
    {
      component: "automation",
      status: overallHealthStatus(snapshot),
      summary: snapshot.creditWorkerReady ? "Automacao pronta para novas simulacoes." : "Automacao requer atencao.",
      metrics: { activeConsultations: snapshot.activeConsultations },
    },
    {
      component: "credit-worker",
      status: !snapshot.creditWorkerReachable ? "OFFLINE" : snapshot.creditWorkerReady ? "ONLINE" : "UNSTABLE",
      summary: !snapshot.creditWorkerReachable ? "Worker de credito sem resposta." : snapshot.creditWorkerReady ? "Worker e navegador prontos." : "Worker ativo, mas ainda nao pronto.",
      metrics: snapshot.creditWorkerHealth,
    },
    {
      component: "database",
      status: snapshot.databaseReachable ? "ONLINE" : "OFFLINE",
      summary: snapshot.databaseReachable ? "Fila Supabase acessivel." : "Fila Supabase indisponivel.",
      metrics: {},
    },
    {
      component: "portal",
      status: snapshot.portalReachable ? "ONLINE" : "OFFLINE",
      summary: snapshot.portalReachable ? "Portal de credito acessivel." : "Portal de credito sem resposta.",
      metrics: {},
    },
    {
      component: "vps-resources",
      status: [
        thresholdStatus(snapshot.cpuPercent, env.highCpuPercent),
        thresholdStatus(snapshot.memoryPercent, env.highMemoryPercent),
        thresholdStatus(snapshot.diskUsedPercent, env.lowDiskUsedPercent),
      ].includes("UNSTABLE") ? "UNSTABLE" : "ONLINE",
      summary: "CPU, memoria e disco monitorados pelo cgroup/container.",
      metrics: {
        cpuPercent: snapshot.cpuPercent,
        memoryPercent: snapshot.memoryPercent,
        diskUsedPercent: snapshot.diskUsedPercent,
        diskFreeBytes: snapshot.diskFreeBytes,
      },
    },
  ];
}
