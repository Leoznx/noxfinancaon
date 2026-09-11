import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";
import { createCorrelationId } from "./correlation";
import { validateSimulationFormReady } from "./credpagoSelectors";
import { env } from "./env";
import { flushAutomationErrorSpool, reportAutomationError } from "./errorReporter";
import { log, logErro, logStructured } from "./logger";
import {
  executeRepairJob,
  ManualInterventionRequiredError,
  RetryableRepairError,
  type RepairEngineDependencies,
  type RunbookResult,
  type ValidationResult,
} from "./repairEngine";
import { redactObject, redactSensitiveText } from "./redaction";
import type {
  AutomationErrorRecord,
  DiagnosticSnapshot,
  RepairJobRecord,
  RepairRunbook,
} from "./recoveryTypes";
import {
  collectSystemDiagnostics,
  healthComponents,
  overallHealthStatus,
} from "./systemDiagnostics";
import { supabaseAdmin } from "./supabaseAdmin";

const workerId = `repair-${env.vpsId}-${crypto.randomBytes(4).toString("hex")}`;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const runtime = {
  startedAt: new Date().toISOString(),
  lastHealthAt: null as string | null,
  lastJobAt: null as string | null,
  currentJobId: null as string | null,
  databaseReachable: false,
  status: "UNKNOWN" as "ONLINE" | "UNSTABLE" | "OFFLINE" | "UNKNOWN",
};

const failureCounts = new Map<string, number>();
const incidentCorrelations = new Map<string, string>();

async function requestCreditWorkerRestart(reason: string): Promise<void> {
  if (!process.send) {
    throw new ManualInterventionRequiredError(
      "O repair worker nao esta sob o supervisor autorizado para reiniciar o processo de credito.",
    );
  }
  const requestId = crypto.randomUUID();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      process.off("message", onMessage);
      reject(new RetryableRepairError("O supervisor nao confirmou o restart no prazo."));
    }, 30_000);
    const onMessage = (message: unknown) => {
      const value = message as { type?: string; requestId?: string; ok?: boolean; error?: string };
      if (value?.type !== "restart-credit-result" || value.requestId !== requestId) return;
      clearTimeout(timer);
      process.off("message", onMessage);
      if (value.ok) resolve();
      else reject(new RetryableRepairError(value.error || "O supervisor recusou o restart."));
    };
    process.on("message", onMessage);
    process.send?.({
      type: "restart-credit",
      requestId,
      reason: redactSensitiveText(reason, 300),
    });
  });
}

async function waitForCreditReady(timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(`http://127.0.0.1:${env.healthPort}/ready`, {
        signal: controller.signal,
      });
      if (response.ok) return;
    } catch {
      // Processo ainda iniciando.
    } finally {
      clearTimeout(timer);
    }
    await sleep(2_000);
  }
  throw new RetryableRepairError("O worker de credito nao ficou pronto apos o restart controlado.");
}

async function cleanOwnTempArtifacts(): Promise<number> {
  const root = path.resolve(env.repairArtifactDir);
  await fs.mkdir(root, { recursive: true });
  const retentionCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const target = path.resolve(root, entry.name);
    if (path.dirname(target) !== root) continue;
    const stat = await fs.stat(target);
    if (stat.mtimeMs < retentionCutoff) {
      await fs.unlink(target);
      removed += 1;
    }
  }
  return removed;
}

async function applyRunbook(
  runbook: RepairRunbook,
  snapshot: DiagnosticSnapshot,
  error: AutomationErrorRecord,
): Promise<RunbookResult> {
  switch (runbook) {
    case "VALIDATE_SESSION":
    case "RESTART_CREDIT_WORKER": {
      if (snapshot.activeConsultations > 0) {
        throw new RetryableRepairError(
          `Ha ${snapshot.activeConsultations} consulta(s) em andamento; restart adiado para evitar duplicidade.`,
        );
      }
      await requestCreditWorkerRestart(`${runbook}:${error.correlation_id}`);
      await waitForCreditReady();
      return {
        summary: "Processo de credito e Chromium reiniciados isoladamente pelo supervisor.",
        changed: true,
        rollbackAvailable: false,
      };
    }
    case "WAIT_EXTERNAL_DEPENDENCY":
      await sleep(3_000);
      return { summary: "Dependencias consultadas novamente com espera controlada.", changed: false, rollbackAvailable: false };
    case "VALIDATE_SELECTORS":
      return { summary: "Nenhuma alteracao aplicada; seletores serao verificados em navegacao segura.", changed: false, rollbackAvailable: false };
    case "CHECK_DATABASE":
      if (!snapshot.databaseReachable) throw new RetryableRepairError("O Supabase continua indisponivel.");
      return { summary: "Conexao, autenticacao de servico e fila do Supabase responderam.", changed: false, rollbackAvailable: false };
    case "CLEAN_OWN_TEMP_ARTIFACTS": {
      const removed = await cleanOwnTempArtifacts();
      return {
        summary: `${removed} artefato(s) temporario(s) proprio(s), fora da retencao, removido(s).`,
        changed: removed > 0,
        rollbackAvailable: false,
      };
    }
    case "MANUAL_INTERVENTION":
      throw new ManualInterventionRequiredError("Categoria sem runbook automatico seguro.");
  }
}

async function safeBrowserValidation(): Promise<Record<string, unknown>> {
  if (!env.storageStatePath) {
    throw new ManualInterventionRequiredError(
      "Validacao automatica indisponivel no modo de perfil persistente em uso. Verifique a sessao manualmente.",
    );
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      storageState: env.storageStatePath,
      viewport: { width: 1366, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(env.credpagoUrl, {
      waitUntil: "domcontentloaded",
      timeout: Math.min(env.repairValidationTimeoutMs, 45_000),
    });
    const selectors = await validateSimulationFormReady(page);
    await context.close();
    return { selectors, submitted: false };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function validateRepair(): Promise<ValidationResult> {
  const snapshot = await collectSystemDiagnostics();
  if (!snapshot.databaseReachable) return { ok: false, summary: "Supabase/fila ainda indisponivel." };
  if (!snapshot.creditWorkerReachable) return { ok: false, summary: "Worker de credito ainda sem resposta." };
  if (!snapshot.creditWorkerReady) {
    const auth = String(snapshot.creditWorkerHealth.auth ?? "");
    return {
      ok: false,
      manualRequired: auth === "required",
      summary: auth === "required"
        ? "A Loft exige autenticacao humana (OTP/CAPTCHA ou credencial recusada)."
        : "Worker ativo, mas autenticacao/fila ainda nao estao prontas.",
    };
  }
  if (!snapshot.portalReachable) return { ok: false, summary: "Portal externo continua indisponivel." };
  if (snapshot.memoryPercent != null && snapshot.memoryPercent >= env.highMemoryPercent) {
    return { ok: false, summary: `Memoria ainda em ${snapshot.memoryPercent}%.` };
  }
  if (snapshot.diskUsedPercent != null && snapshot.diskUsedPercent >= env.lowDiskUsedPercent) {
    return { ok: false, summary: `Disco ainda em ${snapshot.diskUsedPercent}% de uso.` };
  }

  try {
    const browserValidation = await safeBrowserValidation();
    return {
      ok: true,
      summary: "Health checks aprovados e formulario validado sem preencher ou enviar dados.",
      details: browserValidation,
    };
  } catch (error) {
    const message = redactSensitiveText(error, 2_000);
    return {
      ok: false,
      manualRequired: /captcha|otp|autentica[cç][aã]o humana|sess[aã]o expirada|login loft/i.test(message),
      summary: message,
    };
  }
}

async function persistHealth(snapshot: DiagnosticSnapshot): Promise<void> {
  const previous = new Map<string, { consecutive_failures?: number; last_success_at?: string | null }>();
  const { data } = await (supabaseAdmin as any)
    .from("system_health")
    .select("component,consecutive_failures,last_success_at")
    .eq("service", "credit-automation")
    .eq("environment", env.automationEnvironment);
  for (const row of data ?? []) previous.set(row.component, row);

  const rows = healthComponents(snapshot).map((component) => {
    const prior = previous.get(component.component);
    const success = component.status === "ONLINE";
    return {
      service: "credit-automation",
      component: component.component,
      environment: env.automationEnvironment,
      status: component.status,
      summary: component.summary,
      metrics: redactObject(component.metrics),
      version: env.automationVersion,
      consecutive_failures: success ? 0 : (prior?.consecutive_failures ?? 0) + 1,
      last_success_at: success ? snapshot.collectedAt : prior?.last_success_at ?? null,
      checked_at: snapshot.collectedAt,
    };
  });
  const { error } = await (supabaseAdmin as any)
    .from("system_health")
    .upsert(rows, { onConflict: "service,component,environment" });
  if (error) throw error;
}

async function queueAutomaticRepair(errorId: string): Promise<void> {
  if (!env.repairAutoEnabled) return;
  const { data: active } = await (supabaseAdmin as any)
    .from("repair_jobs")
    .select("id")
    .eq("error_id", errorId)
    .in("status", ["QUEUED", "COLLECTING_CONTEXT", "DIAGNOSING", "SNAPSHOTTING", "REPAIRING", "RESTARTING", "VALIDATING", "ROLLING_BACK"])
    .limit(1);
  if (active?.length) return;
  const { error } = await (supabaseAdmin as any).from("repair_jobs").insert({
    error_id: errorId,
    service: "credit-automation",
    requested_by: null,
    stage_message: "Auto-recuperacao segura acionada pelo watchdog.",
  });
  if (error && error.code !== "23505") throw error;
}

async function observeIncident(
  key: string,
  active: boolean,
  message: string,
  autoRepair: boolean,
): Promise<void> {
  if (!active) {
    failureCounts.delete(key);
    incidentCorrelations.delete(key);
    return;
  }
  const failures = (failureCounts.get(key) ?? 0) + 1;
  failureCounts.set(key, failures);
  if (failures < 2 || incidentCorrelations.has(key)) return;

  const correlationId = createCorrelationId("SYS");
  incidentCorrelations.set(key, correlationId);
  const errorId = await reportAutomationError({
    correlationId,
    environment: env.automationEnvironment,
    service: "automation-watchdog",
    step: "health-check",
    error: new Error(message),
    attemptCount: failures,
    metadata: { monitor: key },
  });
  if (errorId && autoRepair) await queueAutomaticRepair(errorId);
}

let healthCheckRunning = false;
async function runHealthCycle(): Promise<void> {
  if (healthCheckRunning) return;
  healthCheckRunning = true;
  try {
    const snapshot = await collectSystemDiagnostics();
    runtime.lastHealthAt = snapshot.collectedAt;
    runtime.databaseReachable = snapshot.databaseReachable;
    runtime.status = overallHealthStatus(snapshot);
    if (snapshot.databaseReachable) await persistHealth(snapshot);

    await Promise.all([
      observeIncident("worker-offline", !snapshot.creditWorkerReachable, "Worker offline: processo de credito sem resposta.", true),
      observeIncident(
        "worker-not-ready",
        snapshot.creditWorkerReachable && !snapshot.creditWorkerReady,
        String(snapshot.creditWorkerHealth.auth || "") === "required"
          ? "Authentication error: a sessao do portal requer intervencao ou renovacao."
          : "Worker offline: processo ativo, mas a fila nao esta pronta.",
        true,
      ),
      observeIncident("portal-offline", !snapshot.portalReachable, "CredPago unavailable: portal externo indisponivel.", false),
      observeIncident("high-cpu", snapshot.cpuPercent != null && snapshot.cpuPercent >= env.highCpuPercent, `High CPU: CPU acima de ${env.highCpuPercent}%.`, true),
      observeIncident("high-memory", snapshot.memoryPercent != null && snapshot.memoryPercent >= env.highMemoryPercent, `High memory: memoria acima de ${env.highMemoryPercent}%.`, true),
      observeIncident("low-disk", snapshot.diskUsedPercent != null && snapshot.diskUsedPercent >= env.lowDiskUsedPercent, `Low disk: disco acima de ${env.lowDiskUsedPercent}% de uso.`, true),
    ]);
  } catch (error) {
    runtime.databaseReachable = false;
    runtime.status = "OFFLINE";
    logErro("Ciclo de health do repair worker falhou", error);
  } finally {
    healthCheckRunning = false;
  }
}

function startHealthServer(): http.Server {
  const server = http.createServer((req, res) => {
    const publicHealth = {
      status: runtime.status === "OFFLINE" ? "degraded" : "ok",
      service: "repair-worker",
      version: env.automationVersion,
      lastHealthAt: runtime.lastHealthAt,
      currentJob: runtime.currentJobId ? "running" : "idle",
    };
    if (req.method === "GET" && req.url === "/live") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "repair-worker", version: env.automationVersion }));
      return;
    }
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(runtime.status === "OFFLINE" ? 503 : 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(publicHealth));
      return;
    }
    if (req.method === "GET" && req.url === "/details" && env.repairHealthToken) {
      if (req.headers.authorization !== `Bearer ${env.repairHealthToken}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "unauthorized" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...publicHealth, ...runtime, workerId }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "not_found" }));
  });
  server.listen(env.repairHealthPort, "0.0.0.0", () =>
    log(`Repair health em 0.0.0.0:${env.repairHealthPort}/health`),
  );
  return server;
}

async function claimNextJob(): Promise<RepairJobRecord | null> {
  const { data, error } = await (supabaseAdmin as any).rpc("claim_next_repair_job", {
    p_worker_id: workerId,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) ?? null;
}

async function processJob(job: RepairJobRecord): Promise<void> {
  const { data, error } = await (supabaseAdmin as any)
    .from("automation_errors")
    .select("*")
    .eq("id", job.error_id)
    .single();
  if (error) throw error;
  const automationError = data as AutomationErrorRecord;
  runtime.currentJobId = job.id;
  runtime.lastJobAt = new Date().toISOString();

  const leaseTimer = setInterval(() => {
    void (supabaseAdmin as any).rpc("renew_repair_job_lease", {
      p_job_id: job.id,
      p_worker_id: workerId,
    });
  }, 30_000);
  leaseTimer.unref();

  const deps: RepairEngineDependencies = {
    collectDiagnostics: collectSystemDiagnostics,
    updateJob: async (patch) => {
      const { error: updateError } = await (supabaseAdmin as any)
        .from("repair_jobs")
        .update(patch)
        .eq("id", job.id)
        .eq("worker_id", workerId);
      if (updateError) throw updateError;
    },
    addStep: async (repairStep) => {
      const { error: stepError } = await (supabaseAdmin as any).from("repair_steps").insert({
        job_id: job.id,
        ...repairStep,
        details: redactObject(repairStep.details ?? {}),
        finished_at: repairStep.status === "RUNNING" ? null : new Date().toISOString(),
      });
      if (stepError) throw stepError;
    },
    applyRunbook,
    validate: async () => validateRepair(),
    rollback: async () => {
      throw new Error("Este runbook de producao nao altera configuracao persistente reversivel.");
    },
    sleep,
  };

  try {
    const result = await executeRepairJob(job, automationError, deps);
    logStructured("repair_job_finished", {
      jobId: job.id,
      correlationId: automationError.correlation_id,
      result,
      attempt: job.attempt_count,
    });
  } finally {
    clearInterval(leaseTimer);
    try {
      const { error: releaseError } = await (supabaseAdmin as any).rpc("release_repair_lock", {
        p_job_id: job.id,
        p_worker_id: workerId,
      });
      if (releaseError) {
        logStructured("repair_lock_release_failed", {
          jobId: job.id,
          error: redactSensitiveText(String(releaseError.message ?? releaseError)),
        });
      }
    } catch (releaseError) {
      logStructured("repair_lock_release_failed", {
        jobId: job.id,
        error: redactSensitiveText(
          releaseError instanceof Error ? releaseError.message : String(releaseError),
        ),
      });
    }
    runtime.currentJobId = null;
  }
}

async function main(): Promise<void> {
  log(`Repair worker iniciado (${workerId}). Auto-recuperacao: ${env.repairAutoEnabled ? "ativa" : "desativada"}.`);
  const healthServer = startHealthServer();
  await runHealthCycle();
  const healthTimer = setInterval(() => void runHealthCycle(), 30_000);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(healthTimer);
    await new Promise<void>((resolve) => healthServer.close(() => resolve()));
  };
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());

  while (!stopping) {
    try {
      await flushAutomationErrorSpool();
      const job = await claimNextJob();
      if (job) await processJob(job);
      else await sleep(env.repairPollIntervalMs);
    } catch (error) {
      logErro("Falha no loop do repair worker; processo continua ativo", error);
      await sleep(Math.max(env.repairPollIntervalMs, 5_000));
    }
  }
}

main().catch((error) => {
  logErro("Repair worker encerrado por falha fatal", error);
  process.exit(1);
});
