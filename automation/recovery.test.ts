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
import { shouldSkipHealthyCreditWorkerRestart } from "./repairPolicy";
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

test("oculta a marca e o endereço do provedor nos diagnósticos", () => {
  const output = redactSensitiveText(
    "Liberação da Loft pendente em https://app.loft.com.br/fianca-aluguel/imobiliaria/cr/index.php",
  );
  assert.doesNotMatch(output, /loft/i);
  assert.match(output, /parceiro de crédito/);
  assert.match(output, /PORTAL_DO_PARCEIRO/);
  assert.equal(
    sanitizeUrl("https://app.loft.com.br/fianca-aluguel/imobiliaria?cpf=123"),
    "[PORTAL_DO_PARCEIRO]",
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

test("classifica bloqueio comercial do parceiro sem confundir com seletor", () => {
  const result = classifyAutomationError(
    new Error(
      "Botão não encontrado. Liberação necessária para criar contratos; solicite a liberação ao time comercial da Loft.",
    ),
  );
  assert.equal(result.category, "CREDPAGO_UNAVAILABLE");
  assert.equal(result.runbook, "WAIT_EXTERNAL_DEPENDENCY");
});

test("monitor transforma qualquer linha real de erro em incidente e ignora evento ja tratado", () => {
  const when = new Date("2026-09-11T12:00:00Z");
  assert.match(
    analyzeWorkerLogLine("ERRO: navegador falhou", when)?.correlationId ?? "",
    /^NOX-SYS-20260911-/,
  );
  assert.match(
    analyzeWorkerLogLine("Worker de credito falhou: exit=1", when)?.correlationId ?? "",
    /^NOX-SYS-20260911-/,
  );
  assert.equal(
    analyzeWorkerLogLine('{"event":"automation_error_recorded","status":"ERROR"}', when),
    null,
  );
  assert.equal(analyzeWorkerLogLine("Validação concluída com 0 erros", when), null);
  assert.equal(
    analyzeWorkerLogLine(
      "ERRO: Spool 1789420477371-caa817.json ainda nao pode ser enviado — StorageApiError",
      when,
    ),
    null,
  );
  assert.equal(
    analyzeWorkerLogLine("ERROR:dbus/bus.cc:405 Failed to connect to the bus", when),
    null,
  );
  assert.equal(
    analyzeWorkerLogLine(
      "ERRO: Falha ao salvar sessão atualizada — browserContext.storageState: Protocol error (Storage.getCookies): Failed to find browser context for id ABC",
      when,
    ),
    null,
  );
});

test("reparo historico nao reinicia um worker que ja esta saudavel", () => {
  const snapshot = {
    creditWorkerReachable: true,
    creditWorkerReady: true,
    creditWorkerHealth: { auth: "ok", queue: "ok", browser: "ok" },
  } as DiagnosticSnapshot;

  assert.equal(shouldSkipHealthyCreditWorkerRestart("RESTART_CREDIT_WORKER", snapshot), true);
  assert.equal(shouldSkipHealthyCreditWorkerRestart("VALIDATE_SESSION", snapshot), true);
  assert.equal(
    shouldSkipHealthyCreditWorkerRestart("RESTART_CREDIT_WORKER", {
      ...snapshot,
      creditWorkerReady: false,
      creditWorkerHealth: { auth: "required", queue: "ok", browser: "ok" },
    }),
    false,
  );
  assert.equal(shouldSkipHealthyCreditWorkerRestart("VALIDATE_SELECTORS", snapshot), false);
});

test("analise automatica seleciona somente runbooks permitidos a partir da saude atual", () => {
  const snapshot = {
    databaseReachable: true,
    creditWorkerReachable: true,
    creditWorkerReady: true,
    portalReachable: true,
    portalBlocked: false,
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
  assert.equal(
    planAiRecovery({ ...snapshot, portalBlocked: true }, error).runbook,
    "WAIT_EXTERNAL_DEPENDENCY",
  );
});
