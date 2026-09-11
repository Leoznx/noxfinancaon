import assert from "node:assert/strict";
import test from "node:test";
import {
  createCorrelationId,
  createStableSystemCorrelationId,
  ensureCorrelationId,
  isValidCorrelationId,
} from "./correlation";
import { classifyAutomationError, runbookForCategory } from "./errorClassifier";
import { planAiRecovery } from "./aiRecoveryPlanner";
import { analyzeWorkerLogLine } from "./logIncidentMonitor";
import { redactObject, redactSensitiveText, sanitizeUrl } from "./redaction";
import type { AutomationErrorRecord, DiagnosticSnapshot } from "./recoveryTypes";

test("gera correlation id sem PII e no formato rastreavel", () => {
  const id = createCorrelationId("SIM", new Date("2026-09-11T12:00:00Z"));
  assert.match(id, /^NOX-SIM-20260911-[A-F0-9]{8}$/);
  assert.equal(isValidCorrelationId(id), true);
  assert.equal(ensureCorrelationId(id), id);
  assert.match(ensureCorrelationId("cpf-123"), /^NOX-SIM-\d{8}-[A-F0-9]{8}$/);
});

test("gera correlacao estavel para a mesma linha de log", () => {
  const when = new Date("2026-09-11T12:00:00Z");
  assert.equal(
    createStableSystemCorrelationId("worker-failure", when),
    createStableSystemCorrelationId("worker-failure", when),
  );
  assert.match(
    createStableSystemCorrelationId("worker-failure", when),
    /^NOX-SYS-20260911-[A-F0-9]{8}$/,
  );
});

test("mascara credenciais, bearer, JWT, email, documento e telefone", () => {
  const output = redactSensitiveText(
    "Authorization: Bearer opaque-token-123\npassword=segredo total\n" +
      "eyJabcdefghijk.abcdefghijklmnop.abcdefghij user@nox.com 123.456.789-01 (11) 99999-0000",
  );
  assert.doesNotMatch(output, /opaque-token|segredo total|user@nox|123\.456|99999-0000/);
  assert.match(output, /REDACTED/);
});

test("remove query e hash de URLs capturadas", () => {
  assert.equal(
    sanitizeUrl("https://portal.test/form?cpf=123#resposta"),
    "https://portal.test/form",
  );
});

test("mascara chaves sigilosas em objetos aninhados", () => {
  assert.deepEqual(redactObject({ ok: true, nested: { token: "abc", email: "user@nox.com" } }), {
    ok: true,
    nested: { token: "[REDACTED]", email: "[EMAIL_REDACTED]" },
  });
});

test("classifica seletor e escolhe apenas runbook permitido", () => {
  const result = classifyAutomationError(new Error("Campo CPF não encontrado pelo locator"));
  assert.equal(result.category, "SELECTOR_NOT_FOUND");
  assert.equal(result.runbook, "VALIDATE_SELECTORS");
  assert.equal(runbookForCategory("UNKNOWN_ERROR"), "AI_DIAGNOSE_AND_RECOVER");
});

test("falha de banco e worker offline recebem severidade critica", () => {
  assert.equal(
    classifyAutomationError(new Error("Supabase gateway timeout")).category,
    "DATABASE_ERROR",
  );
  assert.equal(classifyAutomationError(new Error("worker offline")).severity, "CRITICAL");
});

test("monitor transforma qualquer linha real de erro em incidente e ignora evento ja tratado", () => {
  const when = new Date("2026-09-11T12:00:00Z");
  assert.match(
    analyzeWorkerLogLine("ERRO: navegador falhou", when)?.correlationId ?? "",
    /^NOX-SYS-20260911-/,
  );
  assert.equal(
    analyzeWorkerLogLine('{"event":"automation_error_recorded","status":"ERROR"}', when),
    null,
  );
  assert.equal(analyzeWorkerLogLine("Validação concluída com 0 erros", when), null);
});

test("analise automatica seleciona somente runbooks permitidos a partir da saude atual", () => {
  const snapshot = {
    databaseReachable: true,
    creditWorkerReachable: true,
    creditWorkerReady: true,
    portalReachable: true,
    activeConsultations: 0,
  } as DiagnosticSnapshot;
  const error = { category: "UNKNOWN_ERROR" } as AutomationErrorRecord;
  assert.equal(planAiRecovery(snapshot, error).runbook, "VALIDATE_SELECTORS");
  assert.equal(
    planAiRecovery({ ...snapshot, databaseReachable: false }, error).runbook,
    "CHECK_DATABASE",
  );
  assert.equal(
    planAiRecovery({ ...snapshot, creditWorkerReady: false }, error).runbook,
    "RESTART_CREDIT_WORKER",
  );
});
