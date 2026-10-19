import type { DiagnosticSnapshot, RepairRunbook } from "./recoveryTypes";

const CREDIT_RESTART_RUNBOOKS: ReadonlySet<RepairRunbook> = new Set([
  "VALIDATE_SESSION",
  "RESTART_CREDIT_WORKER",
]);

export function isExpectedCreditReconciliationPending(
  creditWorkerHealth: Record<string, unknown>,
): boolean {
  return (
    creditWorkerHealth.auth === "ok" &&
    creditWorkerHealth.queue === "ok" &&
    creditWorkerHealth.browser === "ok" &&
    creditWorkerHealth.cancellationQueue === "ok" &&
    creditWorkerHealth.cancellationExecution === "checking" &&
    creditWorkerHealth.cancellationCheckStalled !== true &&
    Number(creditWorkerHealth.activeConsultations ?? 0) === 0
  );
}

/**
 * O worker avisa quando o login da Loft só se resolve com uma pessoa (CAPTCHA,
 * código por SMS/e-mail, credencial recusada ou ausente). Reiniciar o processo
 * ou o Chromium nunca resolve isso — apenas repete tentativas de login.
 */
export function creditAuthRequiresHuman(creditWorkerHealth: Record<string, unknown>): boolean {
  return creditWorkerHealth.authRequiresHuman === true;
}

export function activeCreditConsultationCount(
  creditWorkerHealth: Record<string, unknown>,
  databaseCount = 0,
): number {
  const runtimeCount = Number(creditWorkerHealth.activeConsultations);
  const safeRuntimeCount =
    Number.isFinite(runtimeCount) && runtimeCount > 0 ? Math.floor(runtimeCount) : 0;
  const safeDatabaseCount =
    Number.isFinite(databaseCount) && databaseCount > 0 ? Math.floor(databaseCount) : 0;
  const activeCancellationCount = creditWorkerHealth.activeCancellation === true ? 1 : 0;
  return Math.max(safeRuntimeCount, safeDatabaseCount, activeCancellationCount);
}

/**
 * Incidentes antigos podem continuar na fila depois que o worker já se recuperou
 * ou uma nova versão foi publicada. Nessa situação, reiniciá-lo novamente só
 * interrompe consultas saudáveis e pode criar um ciclo de reparos em cascata.
 */
export function shouldSkipHealthyCreditWorkerRestart(
  runbook: RepairRunbook,
  snapshot: DiagnosticSnapshot,
): boolean {
  if (!CREDIT_RESTART_RUNBOOKS.has(runbook)) return false;
  if (!snapshot.creditWorkerReachable) return false;

  const coreHealthy =
    snapshot.creditWorkerHealth.auth === "ok" &&
    snapshot.creditWorkerHealth.queue === "ok" &&
    snapshot.creditWorkerHealth.browser === "ok";

  return (
    coreHealthy &&
    (snapshot.creditWorkerReady ||
      isExpectedCreditReconciliationPending(snapshot.creditWorkerHealth))
  );
}
