import type { AutomationErrorRecord, DiagnosticSnapshot, RepairRunbook } from "./recoveryTypes";

type ConcreteRunbook = Exclude<RepairRunbook, "AI_DIAGNOSE_AND_RECOVER">;

export interface AiRecoveryPlan {
  runbook: ConcreteRunbook;
  explanation: string;
  evidence: string[];
}

const restartCategories = new Set([
  "BROWSER_CRASH",
  "BROWSER_PROFILE_LOCKED",
  "PLAYWRIGHT_TIMEOUT",
  "SESSION_EXPIRED",
  "AUTHENTICATION_ERROR",
  "WORKER_OFFLINE",
  "VPS_HIGH_CPU",
  "VPS_HIGH_MEMORY",
  "INTERNAL_SERVER_ERROR",
  "DEPLOY_ERROR",
  "DEPENDENCY_ERROR",
]);

/**
 * Planejador local e deterministico: correlaciona o erro com sinais atuais e
 * escolhe somente um runbook previamente autorizado. Nenhum comando livre,
 * dado pessoal ou instrucao gerada por terceiros e executado.
 */
export function planAiRecovery(
  snapshot: DiagnosticSnapshot,
  error: AutomationErrorRecord,
): AiRecoveryPlan {
  const evidence = [
    `categoria=${error.category}`,
    `banco=${snapshot.databaseReachable ? "online" : "offline"}`,
    `worker=${snapshot.creditWorkerReachable ? "online" : "offline"}`,
    `worker_pronto=${snapshot.creditWorkerReady ? "sim" : "nao"}`,
    `portal=${snapshot.portalReachable ? "online" : "offline"}`,
    `consultas_ativas=${snapshot.activeConsultations}`,
  ];

  if (!snapshot.databaseReachable || error.category === "DATABASE_ERROR") {
    return {
      runbook: "CHECK_DATABASE",
      explanation: "A fila compartilhada precisa responder antes de qualquer outra acao.",
      evidence,
    };
  }
  if (error.category === "VPS_LOW_DISK") {
    return {
      runbook: "CLEAN_OWN_TEMP_ARTIFACTS",
      explanation: "A limpeza fica limitada aos artefatos temporarios proprios e expirados.",
      evidence,
    };
  }
  if (
    !snapshot.portalReachable ||
    error.category === "CREDPAGO_UNAVAILABLE" ||
    error.category === "NETWORK_ERROR"
  ) {
    return {
      runbook: "WAIT_EXTERNAL_DEPENDENCY",
      explanation: "A dependencia externa sera consultada novamente com espera controlada.",
      evidence,
    };
  }
  if (
    !snapshot.creditWorkerReachable ||
    !snapshot.creditWorkerReady ||
    restartCategories.has(error.category)
  ) {
    return {
      runbook: "RESTART_CREDIT_WORKER",
      explanation:
        "O processo isolado de credito sera reiniciado e validado sem interromper outros servicos.",
      evidence,
    };
  }
  return {
    runbook: "VALIDATE_SELECTORS",
    explanation:
      "Os componentes estao online; a navegacao segura confirmara formulario, sessao e seletores sem enviar simulacao.",
    evidence,
  };
}
