import type { DiagnosticSnapshot, RepairRunbook } from "./recoveryTypes";

const CREDIT_RESTART_RUNBOOKS: ReadonlySet<RepairRunbook> = new Set([
  "VALIDATE_SESSION",
  "RESTART_CREDIT_WORKER",
]);

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
  if (!snapshot.creditWorkerReachable || !snapshot.creditWorkerReady) return false;

  return (
    snapshot.creditWorkerHealth.auth === "ok" &&
    snapshot.creditWorkerHealth.queue === "ok" &&
    snapshot.creditWorkerHealth.browser === "ok"
  );
}
