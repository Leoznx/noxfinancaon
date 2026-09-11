import { runbookForCategory } from "./errorClassifier";
import { redactObject, redactSensitiveText } from "./redaction";
import type {
  AutomationErrorRecord,
  DiagnosticSnapshot,
  RepairJobRecord,
  RepairJobStatus,
  RepairRunbook,
} from "./recoveryTypes";

export class ManualInterventionRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManualInterventionRequiredError";
  }
}

export class RetryableRepairError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableRepairError";
  }
}

export interface RunbookResult {
  summary: string;
  changed: boolean;
  rollbackAvailable: boolean;
  rollbackContext?: Record<string, unknown>;
}

export interface ValidationResult {
  ok: boolean;
  summary: string;
  details?: Record<string, unknown>;
  manualRequired?: boolean;
}

export interface RepairEngineDependencies {
  collectDiagnostics: () => Promise<DiagnosticSnapshot>;
  updateJob: (patch: Record<string, unknown>) => Promise<void>;
  addStep: (step: {
    sequence: number;
    stage: string;
    status: "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED";
    progress: number;
    message: string;
    details?: Record<string, unknown>;
  }) => Promise<void>;
  applyRunbook: (
    runbook: RepairRunbook,
    snapshot: DiagnosticSnapshot,
    error: AutomationErrorRecord,
  ) => Promise<RunbookResult>;
  validate: (
    runbook: RepairRunbook,
    snapshot: DiagnosticSnapshot,
    error: AutomationErrorRecord,
  ) => Promise<ValidationResult>;
  rollback: (runbook: RepairRunbook, context: Record<string, unknown>) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

export type RepairExecutionResult = "success" | "retry" | "failed" | "rolled_back" | "manual";

const BACKOFF_MS = [5_000, 15_000, 45_000];

function safePatch(patch: Record<string, unknown>): Record<string, unknown> {
  return redactObject(patch) as Record<string, unknown>;
}

export async function executeRepairJob(
  job: RepairJobRecord,
  error: AutomationErrorRecord,
  deps: RepairEngineDependencies,
): Promise<RepairExecutionResult> {
  // Cada tentativa ocupa seu proprio bloco para manter a auditoria imutavel.
  let sequence = Math.max(0, job.attempt_count - 1) * 100;
  let applied: RunbookResult | null = null;
  const runbook = runbookForCategory(error.category);

  const transition = async (
    status: RepairJobStatus,
    progress: number,
    message: string,
    extra: Record<string, unknown> = {},
  ) => {
    await deps.updateJob(safePatch({ status, progress, stage_message: message, ...extra }));
  };
  const step = async (
    stage: string,
    status: "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED",
    progress: number,
    message: string,
    details?: Record<string, unknown>,
  ) => {
    sequence += 1;
    await deps.addStep({ sequence, stage, status, progress, message: redactSensitiveText(message, 4_000), details: redactObject(details ?? {}) as Record<string, unknown> });
  };

  try {
    await transition("COLLECTING_CONTEXT", 5, "Coletando logs, saude e contexto correlacionado.");
    await step("COLLECTING_CONTEXT", "RUNNING", 8, "Coleta tecnica iniciada.");
    const snapshot = await deps.collectDiagnostics();
    await transition("DIAGNOSING", 22, "Contexto coletado; classificando a causa.");
    await step("COLLECTING_CONTEXT", "SUCCESS", 22, "Contexto tecnico coletado.", snapshot as unknown as Record<string, unknown>);

    await step("DIAGNOSING", "RUNNING", 28, `Categoria ${error.category}; selecionando runbook permitido.`);
    const diagnosis = error.initial_diagnosis || "Diagnostico inicial indisponivel.";
    await transition("SNAPSHOTTING", 38, "Diagnostico concluido; criando ponto de recuperacao.", {
      diagnosis,
      runbook,
    });
    await step("DIAGNOSING", "SUCCESS", 38, `${diagnosis} Runbook: ${runbook}.`);

    const recoveryPoint = {
      createdAt: new Date().toISOString(),
      version: snapshot.automationVersion,
      environment: snapshot.environment,
      vpsId: snapshot.vpsId,
      runtime: snapshot.runtime,
      serviceState: {
        creditWorkerReachable: snapshot.creditWorkerReachable,
        creditWorkerReady: snapshot.creditWorkerReady,
        activeConsultations: snapshot.activeConsultations,
      },
      sessionLock: snapshot.sessionLock,
    };
    await transition("REPAIRING", 48, "Ponto de recuperacao salvo; executando runbook seguro.", {
      snapshot: recoveryPoint,
    });
    await step("SNAPSHOTTING", "SUCCESS", 48, "Ponto de recuperacao registrado.", recoveryPoint);

    if (runbook === "MANUAL_INTERVENTION") {
      throw new ManualInterventionRequiredError(
        "Nao existe correcao automatica segura para esta categoria. Analise humana necessaria.",
      );
    }

    const restarting = runbook === "RESTART_CREDIT_WORKER" || runbook === "VALIDATE_SESSION";
    await transition(
      restarting ? "RESTARTING" : "REPAIRING",
      58,
      restarting ? "Reiniciando somente o processo de credito." : "Aplicando runbook permitido.",
    );
    await step(restarting ? "RESTARTING" : "REPAIRING", "RUNNING", 60, `Executando ${runbook}.`);
    applied = await deps.applyRunbook(runbook, snapshot, error);
    await transition("VALIDATING", 76, "Runbook concluido; validando todos os componentes.", {
      result_summary: applied.summary,
      rollback_available: applied.rollbackAvailable,
    });
    await step(restarting ? "RESTARTING" : "REPAIRING", "SUCCESS", 76, applied.summary);

    await step("VALIDATING", "RUNNING", 82, "Validando VPS, fila, worker, navegador e formulario seguro.");
    const validation = await deps.validate(runbook, snapshot, error);
    if (!validation.ok) {
      if (validation.manualRequired) throw new ManualInterventionRequiredError(validation.summary);
      throw new RetryableRepairError(validation.summary);
    }
    await step("VALIDATING", "SUCCESS", 96, validation.summary, validation.details);
    await transition("SUCCESS", 100, "Correcao aplicada e validada com sucesso.", {
      result_summary: `${applied.summary} ${validation.summary}`,
      finished_at: new Date().toISOString(),
      lease_expires_at: null,
    });
    await step("SUCCESS", "SUCCESS", 100, "Automacao novamente pronta para novas simulacoes.");
    return "success";
  } catch (caught) {
    const errorMessage = redactSensitiveText(caught, 4_000);
    await step("ERROR", "FAILED", Math.min(95, 60 + sequence * 4), errorMessage).catch(() => {});

    if (caught instanceof ManualInterventionRequiredError) {
      await transition("MANUAL_REQUIRED", Math.min(99, 70 + sequence * 3), caught.message, {
        failure_reason: caught.message,
        finished_at: new Date().toISOString(),
        lease_expires_at: null,
      });
      return "manual";
    }

    if (applied?.changed && applied.rollbackAvailable && applied.rollbackContext) {
      try {
        await transition("ROLLING_BACK", 90, "A validacao falhou; revertendo a alteracao aplicada.", {
          failure_reason: errorMessage,
        });
        await deps.rollback(runbook, applied.rollbackContext);
        await step("ROLLING_BACK", "SUCCESS", 98, "Rollback tecnico concluido.");
        await transition("ROLLED_BACK", 100, "Rollback realizado; intervencao humana recomendada.", {
          rollback_reason: errorMessage,
          finished_at: new Date().toISOString(),
          lease_expires_at: null,
        });
        return "rolled_back";
      } catch (rollbackError) {
        const rollbackMessage = redactSensitiveText(rollbackError, 2_000);
        await step("ROLLING_BACK", "FAILED", 98, rollbackMessage).catch(() => {});
      }
    }

    if (job.attempt_count < job.max_attempts) {
      const backoff = BACKOFF_MS[Math.max(0, job.attempt_count - 1)] ?? BACKOFF_MS.at(-1)!;
      await transition("QUEUED", 0, `Tentativa ${job.attempt_count} falhou; nova tentativa com backoff limitado.`, {
        failure_reason: errorMessage,
        next_attempt_at: new Date(Date.now() + backoff).toISOString(),
        worker_id: null,
        lease_expires_at: null,
      });
      return "retry";
    }

    await transition("FAILED", 100, "O reparo atingiu o limite de tres tentativas sem validacao positiva.", {
      failure_reason: errorMessage,
      finished_at: new Date().toISOString(),
      lease_expires_at: null,
    });
    return "failed";
  }
}
