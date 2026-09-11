import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "./env";
import { classifyAutomationError } from "./errorClassifier";
import { logErro, logStructured } from "./logger";
import { redactObject, redactSensitiveText } from "./redaction";
import type { AutomationErrorEvent, SafeErrorArtifacts } from "./recoveryTypes";
import { supabaseAdmin } from "./supabaseAdmin";

interface StoredErrorPayload {
  correlation_id: string;
  simulation_id: string | null;
  initiating_user_id: string | null;
  environment: string;
  service: string;
  category: string;
  severity: string;
  automation_step: string | null;
  last_successful_step: string | null;
  message_redacted: string;
  stack_trace_redacted: string | null;
  error_code: string | null;
  attempt_count: number;
  fingerprint: string;
  initial_diagnosis: string;
  deploy_version: string;
  automation_version: string;
  vps_id: string;
  runtime: string;
  duration_ms: number | null;
  metadata: Record<string, unknown>;
}

interface SpoolRecord {
  payload: StoredErrorPayload;
  errorId?: string;
  screenshotPath?: string;
  domPath?: string;
  artifactsMeta: Record<string, unknown>;
}

function createPayload(event: AutomationErrorEvent): StoredErrorPayload {
  const classified = classifyAutomationError(event.error);
  return {
    correlation_id: event.correlationId,
    simulation_id: event.simulationId ?? null,
    initiating_user_id: event.initiatingUserId ?? null,
    environment: event.environment,
    service: event.service ?? "credit-automation",
    category: classified.category,
    severity: classified.severity,
    automation_step: event.step ?? null,
    last_successful_step: event.lastSuccessfulStep ?? null,
    message_redacted: classified.message,
    stack_trace_redacted: classified.stack,
    error_code: event.errorCode ?? classified.code,
    attempt_count: Math.max(0, event.attemptCount ?? 1),
    fingerprint: classified.fingerprint,
    initial_diagnosis: classified.diagnosis,
    deploy_version: event.deployVersion ?? env.deployVersion,
    automation_version: event.automationVersion ?? env.automationVersion,
    vps_id: event.vpsId ?? env.vpsId,
    runtime: event.runtime ?? `node ${process.version}; ${process.platform}/${process.arch}`,
    duration_ms: event.durationMs == null ? null : Math.max(0, Math.round(event.durationMs)),
    metadata: (redactObject(event.metadata ?? {}) as Record<string, unknown>) || {},
  };
}

async function recordPayload(payload: StoredErrorPayload): Promise<string> {
  const { data, error } = await (supabaseAdmin as any).rpc("record_automation_error", {
    p_error: payload,
  });
  if (error) throw error;
  if (typeof data !== "string" || !data) throw new Error("RPC nao retornou o id do erro.");
  return data;
}

async function uploadArtifacts(
  errorId: string,
  artifacts: SafeErrorArtifacts | undefined,
  files?: { screenshotPath?: string; domPath?: string },
): Promise<Record<string, unknown>> {
  const metadata: Record<string, unknown> = {
    url: artifacts?.url,
    pageTitle: artifacts?.pageTitle,
    screenshotSkippedReason: artifacts?.screenshotSkippedReason,
  };
  const bucket = supabaseAdmin.storage.from("automation-error-artifacts");

  const screenshot = artifacts?.screenshot ??
    (files?.screenshotPath ? await fs.readFile(files.screenshotPath) : undefined);
  if (screenshot) {
    const objectPath = `${errorId}/screenshot.png`;
    const { error } = await bucket.upload(objectPath, screenshot, {
      contentType: "image/png",
      upsert: true,
    });
    if (error) throw error;
    metadata.screenshotPath = objectPath;
  }

  const domText = artifacts?.sanitizedDomText ??
    (files?.domPath ? await fs.readFile(files.domPath, "utf8") : undefined);
  if (domText) {
    const objectPath = `${errorId}/page-context.txt`;
    const { error } = await bucket.upload(objectPath, redactSensitiveText(domText), {
      contentType: "text/plain; charset=utf-8",
      upsert: true,
    });
    if (error) throw error;
    metadata.domPath = objectPath;
  }

  const clean = Object.fromEntries(Object.entries(metadata).filter(([, value]) => value != null && value !== ""));
  if (Object.keys(clean).length) {
    const { error } = await supabaseAdmin.from("automation_errors").update({ artifacts: clean }).eq("id", errorId);
    if (error) throw error;
  }
  return clean;
}

async function spoolRecord(
  payload: StoredErrorPayload,
  artifacts: SafeErrorArtifacts | undefined,
  errorId?: string,
): Promise<void> {
  await fs.mkdir(env.errorSpoolDir, { recursive: true });
  const base = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const record: SpoolRecord = {
    payload,
    errorId,
    artifactsMeta: {
      url: artifacts?.url,
      pageTitle: artifacts?.pageTitle,
      screenshotSkippedReason: artifacts?.screenshotSkippedReason,
    },
  };
  if (artifacts?.screenshot) {
    record.screenshotPath = path.join(env.errorSpoolDir, `${base}.png`);
    await fs.writeFile(record.screenshotPath, artifacts.screenshot, { mode: 0o600 });
  }
  if (artifacts?.sanitizedDomText) {
    record.domPath = path.join(env.errorSpoolDir, `${base}.txt`);
    await fs.writeFile(record.domPath, redactSensitiveText(artifacts.sanitizedDomText), { mode: 0o600 });
  }
  await fs.writeFile(path.join(env.errorSpoolDir, `${base}.json`), JSON.stringify(record), { mode: 0o600 });
}

export async function reportAutomationError(event: AutomationErrorEvent): Promise<string | null> {
  const payload = createPayload(event);
  try {
    const errorId = await recordPayload(payload);
    try {
      await uploadArtifacts(errorId, event.artifacts);
    } catch (artifactError) {
      await spoolRecord(payload, event.artifacts, errorId).catch(() => {});
      logErro(`[${event.correlationId}] Artefatos preservados para reenvio`, artifactError);
    }
    logStructured("automation_error_recorded", {
      correlationId: event.correlationId,
      errorId,
      category: payload.category,
      severity: payload.severity,
    });
    return errorId;
  } catch (error) {
    await spoolRecord(payload, event.artifacts).catch((spoolError) =>
      logErro("Falha ao preservar erro no spool local", spoolError),
    );
    logErro(`[${event.correlationId}] Falha ao registrar erro estruturado`, error);
    return null;
  }
}

export async function flushAutomationErrorSpool(limit = 10): Promise<number> {
  await fs.mkdir(env.errorSpoolDir, { recursive: true });
  const files = (await fs.readdir(env.errorSpoolDir))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .slice(0, limit);
  let flushed = 0;
  for (const name of files) {
    const jsonPath = path.join(env.errorSpoolDir, name);
    try {
      const record = JSON.parse(await fs.readFile(jsonPath, "utf8")) as SpoolRecord;
      const errorId = record.errorId || (await recordPayload(record.payload));
      await uploadArtifacts(errorId, record.artifactsMeta as SafeErrorArtifacts, {
        screenshotPath: record.screenshotPath,
        domPath: record.domPath,
      });
      await fs.unlink(jsonPath);
      if (record.screenshotPath) await fs.unlink(record.screenshotPath).catch(() => {});
      if (record.domPath) await fs.unlink(record.domPath).catch(() => {});
      flushed += 1;
    } catch (error) {
      logErro(`Spool ${name} ainda nao pode ser enviado`, error);
      break;
    }
  }
  return flushed;
}
