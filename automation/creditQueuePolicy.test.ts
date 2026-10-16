import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { decideFailureDisposition, mayPersistLeaseResult, retryDelayMs } from "./creditQueuePolicy";

const baseDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  baseDir,
  "../supabase/migrations/20261016183000_credit_automation_durable_queue.sql",
);
const staleQueueMigrationPath = path.resolve(
  baseDir,
  "../supabase/migrations/20261016233000_quarantine_stale_legacy_credit_queue.sql",
);
const workerPath = path.resolve(baseDir, "credpagoWorker.ts");

test("falhas anteriores ao envio usam backoff limitado", () => {
  assert.equal(
    decideFailureDisposition({
      providerSubmissionState: "not_submitted",
      retryable: true,
      attemptCount: 1,
      maxAttempts: 3,
    }),
    "queued",
  );
  assert.equal(retryDelayMs(1, 15_000), 15_000);
  assert.equal(retryDelayMs(3, 15_000), 60_000);
  assert.equal(retryDelayMs(20, 15_000), 600_000);
});

test("queda depois do envio nunca autoriza reenvio cego", () => {
  for (const state of ["submitting", "submitted", "unknown"] as const) {
    assert.equal(
      decideFailureDisposition({
        providerSubmissionState: state,
        retryable: true,
        attemptCount: 1,
        maxAttempts: 3,
      }),
      "requires_verification",
    );
  }
});

test("limite de tentativas termina em falha técnica, não recusa", () => {
  assert.equal(
    decideFailureDisposition({
      providerSubmissionState: "not_submitted",
      retryable: true,
      attemptCount: 3,
      maxAttempts: 3,
    }),
    "technical_failure",
  );
});

test("token e versão impedem resposta atrasada de worker antigo", () => {
  const expected = {
    expectedWorkerId: "worker-b",
    expectedLeaseToken: "lease-new",
    expectedExecutionVersion: 2,
  };
  assert.equal(
    mayPersistLeaseResult({
      ...expected,
      workerId: "worker-a",
      leaseToken: "lease-old",
      executionVersion: 1,
    }),
    false,
  );
  assert.equal(
    mayPersistLeaseResult({
      ...expected,
      workerId: "worker-b",
      leaseToken: "lease-new",
      executionVersion: 2,
    }),
    true,
  );
});

test("migration implementa claim, heartbeat, idempotência e estado incerto", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /DROP INDEX IF EXISTS public\.uniq_consulta_user_document/i);
  assert.match(sql, /uniq_credit_simulation_idempotency/i);
  assert.match(sql, /idx_credit_provider_external_id/i);
  assert.match(sql, /sync_loft_proposal_id_to_credit_simulation/i);
  assert.match(sql, /Idempotency key already used with different simulation data/i);
  assert.match(sql, /FOR UPDATE SKIP LOCKED/i);
  assert.match(sql, /lease_token = p_lease_token[\s\S]*execution_version = p_execution_version/i);
  assert.match(sql, /technical_status = 'requires_verification'/i);
  assert.match(sql, /provider_submission_state IN \('submitting', 'submitted', 'unknown'\)/i);
  assert.match(sql, /circuit_open_until/i);
  assert.doesNotMatch(sql, /SET\s+resultado\s*=\s*'erro'/i);
});

test("worker não abre outra página da sessão enquanto uma simulação está ativa", async () => {
  const worker = await readFile(workerPath, "utf8");
  const guard = worker.indexOf("if (emAndamento.size > 0)");
  const authProbe = worker.indexOf("const autenticacaoPronta = await validarAutenticacao", guard);
  const cancellationProbe = worker.indexOf(
    "const superficieCancelamentoPronta = await validarSuperficieCancelamento",
    guard,
  );
  assert.ok(guard >= 0);
  assert.ok(authProbe > guard);
  assert.ok(cancellationProbe > guard);
  assert.match(worker.slice(guard, authProbe), /continue;/);
});

test("cancelamento e reconciliação possuem watchdog total menor que o lease", async () => {
  const worker = await readFile(workerPath, "utf8");
  const envSource = await readFile(path.resolve(baseDir, "env.ts"), "utf8");
  const cancellationStart = worker.indexOf("async function processLoftCancellation");
  const reconciliationStart = worker.indexOf("async function reconcilePendingLoftCancellation");

  assert.ok(cancellationStart >= 0);
  assert.ok(reconciliationStart >= 0);
  assert.match(
    worker.slice(cancellationStart, cancellationStart + 7_000),
    /runWithRuntimeWatchdog/,
  );
  assert.match(
    worker.slice(reconciliationStart, reconciliationStart + 7_000),
    /runWithRuntimeWatchdog/,
  );
  assert.match(envSource, /LOFT_CANCELLATION_OPERATION_TIMEOUT_MS[\s\S]*240_000/);
});

test("migration isola solicitações legadas antigas sem reenviá-las", async () => {
  const sql = await readFile(staleQueueMigrationPath, "utf8");
  assert.match(sql, /technical_status\s*=\s*'requires_verification'/i);
  assert.match(sql, /status\s*=\s*'requer_verificacao'/i);
  assert.match(sql, /provider_submission_state\s*=\s*'not_submitted'/i);
  assert.match(sql, /attempt_count\s*=\s*0/i);
  assert.match(sql, /created_at\s*<\s*clock_timestamp\(\)\s*-\s*interval\s*'24 hours'/i);
  assert.doesNotMatch(sql, /delete\s+from/i);
});
