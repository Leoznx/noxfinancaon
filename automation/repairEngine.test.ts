import assert from "node:assert/strict";
import test from "node:test";
import {
  executeRepairJob,
  ManualRepairRequiredError,
  type RepairEngineDependencies,
} from "./repairEngine";
import type {
  AutomationErrorRecord,
  DiagnosticSnapshot,
  RepairJobRecord,
} from "./recoveryTypes";

const snapshot = {
  collectedAt: "2026-09-14T20:00:00.000Z",
  environment: "test",
  vpsId: "test",
  automationVersion: "test",
  runtime: "node test",
  cpuPercent: 1,
  memoryPercent: 1,
  memoryUsedBytes: 1,
  memoryLimitBytes: 100,
  diskUsedPercent: 1,
  diskFreeBytes: 100,
  creditWorkerReachable: true,
  creditWorkerReady: false,
  creditWorkerHealth: { auth: "blocked" },
  databaseReachable: true,
  portalReachable: true,
  portalBlocked: true,
  activeConsultations: 0,
  sessionLock: {},
} satisfies DiagnosticSnapshot;

test("bloqueio externo encerra na primeira tentativa como ação necessária", async () => {
  const updates: Array<Record<string, unknown>> = [];
  let validationCalled = false;
  const job = {
    id: "job",
    error_id: "error",
    service: "credit-automation",
    worker_id: "worker",
    status: "COLLECTING_CONTEXT",
    progress: 5,
    stage_message: "",
    runbook: null,
    diagnosis: null,
    snapshot: null,
    result_summary: null,
    failure_reason: null,
    rollback_reason: null,
    rollback_available: false,
    attempt_count: 1,
    max_attempts: 3,
    created_at: snapshot.collectedAt,
    updated_at: snapshot.collectedAt,
  } satisfies RepairJobRecord;
  const automationError = {
    id: "error",
    correlation_id: "NOX-SYS-20260914-1234ABCD",
    simulation_id: null,
    initiating_user_id: null,
    environment: "test",
    service: "credit-automation",
    category: "CREDPAGO_UNAVAILABLE",
    severity: "ERROR",
    status: "NOVO",
    automation_step: null,
    last_successful_step: null,
    message_redacted: "CREDPAGO_ACCOUNT_BLOCKED",
    initial_diagnosis: "Conta bloqueada pelo parceiro.",
    metadata: {},
    created_at: snapshot.collectedAt,
    last_seen_at: snapshot.collectedAt,
  } satisfies AutomationErrorRecord;
  const deps: RepairEngineDependencies = {
    collectDiagnostics: async () => snapshot,
    updateJob: async (patch) => void updates.push(patch),
    addStep: async () => {},
    applyRunbook: async () => {
      throw new ManualRepairRequiredError("Liberacao externa necessaria.");
    },
    validate: async () => {
      validationCalled = true;
      return { ok: false, summary: "nao deveria validar" };
    },
    rollback: async () => {},
  };

  const result = await executeRepairJob(job, automationError, deps);
  assert.equal(result, "manual_required");
  assert.equal(validationCalled, false);
  assert.equal(updates.at(-1)?.status, "MANUAL_REQUIRED");
  assert.equal(updates.at(-1)?.progress, 100);
});
