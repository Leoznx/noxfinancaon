import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workerUrl = new URL("./credpagoWorker.ts", import.meta.url);
const migrationUrl = new URL(
  "../supabase/migrations/20261013233000_allow_causal_reused_loft_proposal.sql",
  import.meta.url,
);
const safetyMigrationUrl = new URL(
  "../supabase/migrations/20261013100000_loft_cancellation_jobs_per_execution.sql",
  import.meta.url,
);
const exhaustedRepairsMigrationUrl = new URL(
  "../supabase/migrations/20261014003000_finish_exhausted_repair_jobs.sql",
  import.meta.url,
);
const stabilizationMigrationUrl = new URL(
  "../supabase/migrations/20261015193000_stabilize_credit_automation.sql",
  import.meta.url,
);

test("usa uma RPC exclusiva para o ID causal devolvido pela submissão", async () => {
  const [worker, migration] = await Promise.all([
    readFile(workerUrl, "utf8"),
    readFile(migrationUrl, "utf8"),
  ]);

  assert.match(worker, /attach_loft_proposal_id_from_submission/);
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.attach_loft_proposal_id_from_submission/,
  );
  assert.match(migration, /v_job\.submitted_at IS NULL/);
  assert.doesNotMatch(migration, /ANY\(v_job\.known_proposal_ids\)/);
  assert.match(migration, /GRANT EXECUTE[\s\S]*TO service_role/);
});

test("mantém fechados os vínculos inferidos e a reconciliação manual", async () => {
  const migration = await readFile(safetyMigrationUrl, "utf8");
  const knownIdGuards = migration.match(/p_proposal_id = ANY\(v_job\.known_proposal_ids\)/g) ?? [];

  assert.equal(knownIdGuards.length, 2);
});

test("reconcilia automaticamente somente a única proposta nova após o envio", async () => {
  const worker = await readFile(workerUrl, "utf8");

  assert.match(worker, /reconcilePendingLoftCancellation/);
  assert.match(worker, /resolveLoftProposalReconciliation/);
  assert.match(worker, /\.is\("proposal_id", null\)/);
  assert.match(worker, /await vincularPropostaAoCancelamento\(job\.id, resolution\.proposalId\)/);
  assert.match(worker, /finishAlreadyTerminalLoftReconciliation/);
  assert.match(worker, /\.in\("status", \["prepared", "scheduled", "retry"\]\)/);
  assert.match(worker, /await ensureLoggedIn\("reconcile-cancellation"/);
  assert.match(worker, /reconcilePreparedLoftCancellation/);
  assert.match(worker, /abortPreparedLoftCancellation/);
  assert.doesNotMatch(worker, /fluxo legado de CNPJ não devolve um ID causal/);
});

test("prioriza cancelamentos vencidos antes de reconciliar submissões mais novas", async () => {
  const worker = await readFile(workerUrl, "utf8");
  const loopStart = worker.indexOf(
    "if (env.loftCancellationEnabled && !cancelamentoEmAndamento && emAndamento.size === 0)",
  );
  const loopEnd = worker.indexOf("if (cancelamentoEmAndamento)", loopStart);
  const cancellationLoop = worker.slice(loopStart, loopEnd);

  assert.ok(loopStart >= 0 && loopEnd > loopStart);
  assert.ok(
    cancellationLoop.indexOf("await claimNextLoftCancellation()") <
      cancellationLoop.indexOf("await reconcilePendingLoftCancellation("),
  );
  assert.match(worker, /function isPendingLoftReconciliationError/);
  assert.match(worker, /String\(candidate\.code \?\? ""\) !== "55000"/);
  assert.match(worker, /reconcilia\[cç\]\[aã\]o\\s\+necess\[aá\]ria/);
});

test("serializa o snapshot na sessão e evita reabrir a lista durante a estabilização", async () => {
  const worker = await readFile(workerUrl, "utf8");

  const snapshot = worker.indexOf("? await iniciarSnapshotPropostas()");
  const fill = worker.indexOf("await fillPessoa(", snapshot);
  assert.ok(snapshot >= 0 && fill > snapshot);
  assert.match(worker, /snapshotDesteClique/);
  assert.match(worker, /proximaReconciliacaoLoftEm\.set\(job\.id/);
  assert.doesNotMatch(
    worker,
    /throw new Error\(\s*"As propostas candidatas já aparecem em estado terminal/,
  );
});

test("encerra reparos sem lease depois que todas as tentativas foram consumidas", async () => {
  const migration = await readFile(exhaustedRepairsMigrationUrl, "utf8");

  assert.match(migration, /attempt_count >= max_attempts/);
  assert.match(migration, /lease_expires_at IS NULL OR lease_expires_at < v_now/);
  assert.match(migration, /status = 'FAILED'/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.claim_next_repair_job/);
});

test("valida a autenticação antes de tocar a fila de cancelamentos", async () => {
  const worker = await readFile(workerUrl, "utf8");
  const loopStart = worker.indexOf("for (;;) {");
  const loop = worker.slice(loopStart);

  assert.ok(loopStart >= 0);
  assert.ok(
    loop.indexOf("await validarAutenticacao(") <
      loop.indexOf("if (env.loftCancellationEnabled && !cancelamentoEmAndamento"),
  );
  assert.match(worker, /if \(reconciliacaoCancelamentoPendente\)[\s\S]*continue;/);
  assert.match(worker, /error instanceof LoftCancellationQueueError/);
});

test("não transforma falha terminal identificada em indisponibilidade global", async () => {
  const migration = await readFile(stabilizationMigrationUrl, "utf8");
  const claimStart = migration.lastIndexOf(
    "CREATE OR REPLACE FUNCTION public.claim_next_loft_proposal_cancellation",
  );
  const claim = migration.slice(claimStart);

  assert.ok(claimStart >= 0);
  assert.match(claim, /status = 'prepared'/);
  assert.match(claim, /status IN \('scheduled', 'retry'\)[\s\S]*proposal_id IS NULL/);
  assert.doesNotMatch(claim, /status = 'failed'/);
  assert.doesNotMatch(claim, /status IN \('processing', 'retry'\)/);
});

test("renova consulta órfã sem perder a idempotência de uma execução recente", async () => {
  const migration = await readFile(stabilizationMigrationUrl, "utf8");

  assert.match(migration, /interval '12 minutes'/);
  assert.match(migration, /interval '15 minutes'/);
  assert.match(
    migration,
    /coalesce\(v_consultation\.automation_started_at, v_consultation\.updated_at\)/,
  );
  assert.doesNotMatch(
    migration,
    /v_consultation\.status = 'processando'\s+OR \(v_consultation\.status = 'pendente'/,
  );
});
