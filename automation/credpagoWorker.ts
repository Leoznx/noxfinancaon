import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { randomUUID } from "node:crypto";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import http from "node:http";
import { env } from "./env";
import { supabaseAdmin } from "./supabaseAdmin";
import { formatErrorDetail, log, logErro, logStructured, maskDocumento } from "./logger";
import {
  fillPessoa,
  fillDocumento,
  fillTipoImovel,
  fillCep,
  fillValores,
  submitSimulation,
  openLegacyCreditSimulation,
  lookupLegacyProposalResult,
  isCaptchaPresent,
  loginWithCredentials,
  detectAuthenticationState,
  isCreditSimulationUrl,
  CreditSimulationFormNotReadyError,
} from "./credpagoSelectors";
import { parseResultado } from "./credpagoParser";
import { isTransientPortalError, validateConsultaForAutomation } from "./errorPolicy";
import type { ConsultaCreditoRow } from "./types";
import { acquireAutomationLock, type AutomationLockHandle } from "./automationLock";
import { ensureCorrelationId, createCorrelationId } from "./correlation";
import { classifyAutomationError } from "./errorClassifier";
import { reportAutomationError } from "./errorReporter";
import { redactSensitiveText } from "./redaction";
import { captureSafeErrorArtifacts } from "./safeArtifacts";
import { primeiroNomeCliente, somenteDigitos } from "./customerIdentity";
import {
  assertCreditSimulationAvailable,
  isCredPagoAccountBlockedError,
} from "./credpagoAvailability";
import { LoftCancellationClient, extractLoftProposalId } from "./loftCancellation";
import {
  cancelLoftProposalViaPortal,
  listLoftProposalIdsForDocument,
  listLoftProposalsForDocument,
  probeLoftProposalCancellationPortal,
  isLoftProposalReconciliationExpired,
  resolveLoftProposalReconciliation,
} from "./loftPortalCancellation";
import { runWithRuntimeWatchdog } from "./runtimeWatchdog";
import { selectRandomCreditSimulationCep } from "./creditSimulationCep";
import { observeCreditSimulationApi } from "./creditSimulationApiObserver";

/**
 * Traduz qualquer falha interna (Playwright, rede, timeout) para uma mensagem segura,
 * sem jargão técnico nem menção ao nome do parceiro de crédito — é isso que o corretor
 * vê no NOX FINANÇA quando a automação não consegue concluir a consulta.
 */
function mensagemSeguraParaErro(erroTecnico: string): string {
  if (isCredPagoAccountBlockedError(erroTecnico)) {
    return "A conta de integração aguarda liberação do parceiro para criar contratos. Nenhum dado foi enviado; tente novamente após a liberação.";
  }
  if (/captcha/i.test(erroTecnico)) {
    return "Não foi possível continuar automaticamente por causa de uma verificação de segurança. Resolva manualmente e reenvie a consulta.";
  }
  if (/login n[ãa]o confirmado|modo headless/i.test(erroTecnico)) {
    return "O login não foi confirmado a tempo. Reenvie a consulta após concluir o login.";
  }
  if (/tempo limite/i.test(erroTecnico)) {
    return erroTecnico;
  }
  if (/n[ãa]o foi poss[ií]vel identificar o resultado/i.test(erroTecnico)) {
    return erroTecnico;
  }
  if (/CNPJ.*ID causal|ID causal.*CNPJ|fluxo legado de CNPJ/i.test(erroTecnico)) {
    return "As simulações para pessoa jurídica estão temporariamente indisponíveis porque o cancelamento seguro da proposta ainda não pôde ser confirmado. Nenhum dado foi enviado; acione o suporte antes de tentar novamente.";
  }
  return "Não foi possível concluir a consulta no momento. Tente novamente em instantes.";
}

// ---------------------------------------------------------------------------
// Login compartilhado entre consultas concorrentes.
// Várias abas podem detectar "não logado" ao mesmo tempo (ex.: perfil novo +
// 3 consultas simultâneas) — todas compartilham cookies do mesmo contexto, então
// só uma renovação deve acontecer; as demais abas esperam a mesma promise e
// recarregam para herdar a sessão recém-autenticada.
// ---------------------------------------------------------------------------
let loginEmAndamento: Promise<void> | null = null;

class CredPagoAuthenticationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CredPagoAuthenticationError";
  }
}

class CredPagoServiceUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CredPagoServiceUnavailableError";
  }
}

class LoftCancellationUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LoftCancellationUnavailableError";
  }
}

class LoftCancellationQueueError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LoftCancellationQueueError";
  }
}

class ConsultaStateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsultaStateConflictError";
  }
}

class ConsultaLeaseLostError extends ConsultaStateConflictError {
  constructor() {
    super("O lease da consulta foi perdido para outra execução.");
    this.name = "ConsultaLeaseLostError";
  }
}

type AuthRuntimeStatus = "checking" | "ok" | "required" | "unavailable" | "blocked";
type QueueRuntimeStatus = "checking" | "ok" | "unavailable";
type BrowserRuntimeStatus = "checking" | "ok" | "unavailable";

interface LoftCancellationJob {
  id: string;
  consultation_id: string;
  correlation_id: string;
  submission_token: string;
  proposal_id: string | null;
  known_proposal_ids: string[];
  status: "prepared" | "scheduled" | "processing" | "retry" | "failed";
  created_at: string;
  submitted_at: string | null;
  attempt_count: number;
  max_attempts: number;
}

interface ScheduledLoftCancellation {
  id: string;
  submissionToken: string;
  proposalId: string | null;
  knownProposalIds: string[];
}

interface TrackedLoftCancellation extends ScheduledLoftCancellation {
  clicked: boolean;
  submittedAt: string | null;
  confirmed: boolean;
}

const runtimeState: {
  auth: AuthRuntimeStatus;
  lastAuthCheckAt: string | null;
  lastAuthSuccessAt: string | null;
  authCheckStartedAt: string | null;
  lastLoopAt: string | null;
  consecutiveAuthFailures: number;
  browserRestarts: number;
  queue: QueueRuntimeStatus;
  lastQueueSuccessAt: string | null;
  lastQueueErrorAt: string | null;
  consecutiveQueueFailures: number;
  cancellationQueue: QueueRuntimeStatus;
  cancellationExecution: QueueRuntimeStatus;
  cancellationCheckStartedAt: string | null;
  cancellationOperationStartedAt: string | null;
  lastCancellationQueueSuccessAt: string | null;
  lastCancellationQueueErrorAt: string | null;
  consecutiveCancellationQueueFailures: number;
  browser: BrowserRuntimeStatus;
  activeConsultations: number;
  totalProcessed: number;
  totalFailed: number;
  lastSuccessfulSimulationAt: string | null;
  averageDurationMs: number | null;
  activeCancellation: boolean;
  totalCancellations: number;
  totalCancellationFailures: number;
  lastSuccessfulCancellationAt: string | null;
  queueDepth: number;
  retryingConsultations: number;
  requiresVerification: number;
  expiredLeases: number;
  oldestQueueAgeSeconds: number;
  providerConsecutiveFailures: number;
  circuitOpen: boolean;
  circuitOpenUntil: string | null;
} = {
  auth: "checking",
  lastAuthCheckAt: null,
  lastAuthSuccessAt: null,
  authCheckStartedAt: null,
  lastLoopAt: null,
  consecutiveAuthFailures: 0,
  browserRestarts: 0,
  queue: "checking",
  lastQueueSuccessAt: null,
  lastQueueErrorAt: null,
  consecutiveQueueFailures: 0,
  cancellationQueue: "checking",
  cancellationExecution: "checking",
  cancellationCheckStartedAt: null,
  cancellationOperationStartedAt: null,
  lastCancellationQueueSuccessAt: null,
  lastCancellationQueueErrorAt: null,
  consecutiveCancellationQueueFailures: 0,
  browser: "checking",
  activeConsultations: 0,
  totalProcessed: 0,
  totalFailed: 0,
  lastSuccessfulSimulationAt: null,
  averageDurationMs: null,
  activeCancellation: false,
  totalCancellations: 0,
  totalCancellationFailures: 0,
  lastSuccessfulCancellationAt: null,
  queueDepth: 0,
  retryingConsultations: 0,
  requiresVerification: 0,
  expiredLeases: 0,
  oldestQueueAgeSeconds: 0,
  providerConsecutiveFailures: 0,
  circuitOpen: false,
  circuitOpenUntil: null,
};

const recentDurations: number[] = [];
const loftCancellationClient =
  env.loftCancellationEnabled && env.loftCancellationMode === "api"
    ? new LoftCancellationClient({
        apiBaseUrl: env.loftApiBaseUrl,
        tokenUrl: env.loftOauthTokenUrl,
        clientId: env.loftOauthClientId,
        clientSecret: env.loftOauthClientSecret,
        scope: env.loftOauthScope,
        authorizationDetails: env.loftOauthAuthorizationDetails || undefined,
        requestTimeoutMs: env.loftCancellationRequestTimeoutMs,
      })
    : null;

let proximaValidacaoAuthEm = 0;
let proximaValidacaoCancelamentoEm = 0;
let ultimaRecuperacaoConsultasEm = 0;
let ultimaSinalizacaoAuthNaFilaEm = 0;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function registrarSucessoFila(): void {
  const estavaIndisponivel = runtimeState.queue === "unavailable";
  runtimeState.queue = "ok";
  runtimeState.lastQueueSuccessAt = new Date().toISOString();
  runtimeState.consecutiveQueueFailures = 0;
  if (estavaIndisponivel) log("Conexão com a fila do Supabase recuperada.");
}

function registrarFalhaFila(contexto: string, error: unknown): void {
  const primeiraFalha = runtimeState.queue !== "unavailable";
  runtimeState.queue = "unavailable";
  runtimeState.lastQueueErrorAt = new Date().toISOString();
  runtimeState.consecutiveQueueFailures += 1;
  if (primeiraFalha || runtimeState.consecutiveQueueFailures % 12 === 0) {
    logErro(
      `${contexto}; o worker continuará ativo e tentará novamente (falha ${runtimeState.consecutiveQueueFailures})`,
      error,
    );
  }
}

function registrarSucessoFilaCancelamento(): void {
  const estavaIndisponivel = runtimeState.cancellationQueue === "unavailable";
  runtimeState.cancellationQueue = "ok";
  runtimeState.lastCancellationQueueSuccessAt = new Date().toISOString();
  runtimeState.consecutiveCancellationQueueFailures = 0;
  if (estavaIndisponivel) log("Conexão com a fila de cancelamentos recuperada.");
}

function registrarFalhaFilaCancelamento(contexto: string, error: unknown): void {
  const primeiraFalha = runtimeState.cancellationQueue !== "unavailable";
  runtimeState.cancellationQueue = "unavailable";
  runtimeState.lastCancellationQueueErrorAt = new Date().toISOString();
  runtimeState.consecutiveCancellationQueueFailures += 1;
  if (primeiraFalha || runtimeState.consecutiveCancellationQueueFailures % 12 === 0) {
    logErro(
      `${contexto}; o cancelamento continuará tentando (falha ${runtimeState.consecutiveCancellationQueueFailures})`,
      error,
    );
  }
}

async function navegarParaPortal(page: Page, timeoutMs = 30_000): Promise<void> {
  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
    try {
      await page.goto(env.credpagoUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      return;
    } catch (error) {
      ultimoErro = error;
      if (!isTransientPortalError(error) || page.isClosed()) throw error;
      if (tentativa === 2) {
        throw new CredPagoServiceUnavailableError(
          "O portal permaneceu indisponível após duas tentativas de navegação.",
          { cause: error },
        );
      }
      logErro(`Portal indisponível na navegação; nova tentativa ${tentativa + 1}/2`, error);
      await sleep(1_000);
    }
  }
  throw new CredPagoServiceUnavailableError("Não foi possível abrir o portal.", {
    cause: ultimoErro,
  });
}

async function solicitarLoginManual(): Promise<void> {
  log("Tela de login detectada na CredPago.");
  log("Faça login manualmente na CredPago. Depois pressione Enter para continuar.");
  const rl = readline.createInterface({ input: stdin, output: stdout });
  await rl.question("");
  rl.close();
}

async function ensureLoggedIn(
  cid: string,
  page: Page,
  persistirSessao: () => Promise<void>,
): Promise<void> {
  const initialState = await detectAuthenticationState(page);
  if (initialState === "authenticated") return;
  if (initialState === "unknown") {
    throw new CredPagoServiceUnavailableError(
      "O portal da CredPago não informou o estado da autenticação.",
    );
  }

  if (!loginEmAndamento) {
    loginEmAndamento = (async () => {
      if (env.credpagoLogin && env.credpagoPassword) {
        log("Sessão expirada — renovando automaticamente pelo portal de autenticação.");
        await loginWithCredentials(
          page,
          env.credpagoLogin,
          env.credpagoPassword,
          env.authLoginTimeoutMs,
        );
        await persistirSessao();
        log("Acesso ao portal renovado e sessão persistida.");
        return;
      }

      if (env.headless) {
        throw new CredPagoAuthenticationError(
          "Sessão expirada e credenciais de renovação não configuradas na VPS.",
        );
      }

      await solicitarLoginManual();
      await persistirSessao();
    })()
      .catch((error) => {
        if (error instanceof CredPagoAuthenticationError) throw error;
        throw new CredPagoAuthenticationError(
          error instanceof Error
            ? `Não foi possível renovar o acesso ao portal: ${error.message}`
            : "Não foi possível renovar o acesso ao portal.",
          { cause: error },
        );
      })
      .finally(() => {
        loginEmAndamento = null;
      });
  } else {
    log(`[${cid}] Login já solicitado por outra consulta — aguardando confirmação...`);
  }

  await loginEmAndamento;

  // O login pode ter sido feito em OUTRA aba — recarrega esta para herdar a sessão
  // agora autenticada no contexto compartilhado (cookies são por contexto, não por aba).
  await navegarParaPortal(page);

  if ((await detectAuthenticationState(page)) !== "authenticated") {
    throw new CredPagoAuthenticationError(
      "Login não confirmado — a página ainda parece ser a tela de login.",
    );
  }
}

// ---------------------------------------------------------------------------
// Sessão ociosa: quando o worker fica muito tempo sem processar nenhuma
// consulta (ex.: horas sem nenhuma pendente), a PRIMEIRA consulta real que
// chega sempre travava no clique de "Simular Crédito" — a página não muda,
// não dá nenhum erro visível, e nem o reclique automático (ver
// credpagoParser.ts) resolve, porque ele só reclica no MESMO estado quebrado.
// A consulta seguinte, processada logo em seguida, sempre funcionava normal.
// Isso indica sessão/estado de página "frio" depois de ficar parado — a
// correção é forçar um reload de verdade antes de preencher o formulário
// sempre que a última atividade real foi há muito tempo.
// ---------------------------------------------------------------------------
let ultimaAtividadeEm = Date.now();
// A validacao periodica do cancelamento tambem navega com a mesma sessao e a
// mantem aquecida. O limite fica acima desse ciclo para nao carregar duas vezes
// a pagina justamente na primeira consulta depois de alguns minutos ociosa.
const SESSAO_OCIOSA_MS = Math.max(5 * 60 * 1000, env.authCheckIntervalMs + 30_000);

// A lista da Loft e custosa (navegacao + busca em todas as abas). Depois que
// uma reconciliacao ainda nao madura foi verificada, aguardamos em memoria antes
// de abrir a mesma lista novamente. Novas simulacoes continuam fluindo nesse
// intervalo e, apos restart, a verificacao segura simplesmente e refeita.
const RECONCILIATION_RETRY_MS = 30_000;
const proximaReconciliacaoLoftEm = new Map<string, number>();

// ---------------------------------------------------------------------------
// Fila / persistência
// ---------------------------------------------------------------------------

async function agendarCancelamentoLoft(
  consulta: ConsultaCreditoRow,
  submissionToken: string,
  knownProposalIds: string[],
): Promise<ScheduledLoftCancellation | null> {
  if (!env.loftCancellationEnabled) return null;
  const abortarPreparacao = async (): Promise<void> => {
    let lastAbortError: unknown = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await (supabaseAdmin as any).rpc("abort_loft_proposal_preparation", {
        p_consultation_id: consulta.id,
        p_submission_token: submissionToken,
        p_known_proposal_ids: knownProposalIds,
      });
      if (!response.error) {
        const abortedRow = (Array.isArray(response.data) ? response.data[0] : response.data) as {
          submission_token?: unknown;
          status?: unknown;
        } | null;
        if (abortedRow?.submission_token === submissionToken && abortedRow?.status === "aborted") {
          registrarSucessoFilaCancelamento();
          return;
        }
        lastAbortError = new Error("A fila não confirmou o abort da preparação.");
      } else {
        lastAbortError = response.error;
      }
      if (attempt < 2) await sleep(250);
    }
    throw lastAbortError ?? new Error("Não foi possível abortar a preparação da submissão.");
  };
  const falharDepoisDeAbortar = async (scheduleError: unknown): Promise<never> => {
    try {
      await abortarPreparacao();
    } catch (abortError) {
      throw new AggregateError(
        [scheduleError, abortError],
        "O agendamento falhou e não foi possível confirmar o abort seguro da preparação.",
      );
    }
    throw scheduleError;
  };
  const args = {
    p_consultation_id: consulta.id,
    p_submission_token: submissionToken,
    p_known_proposal_ids: knownProposalIds,
    p_delay_seconds: Math.round(env.loftCancellationDelayMs / 1000),
  };
  let data: unknown = null;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await (supabaseAdmin as any).rpc("schedule_loft_proposal_cancellation", args);
    if (!response.error) {
      data = response.data;
      lastError = null;
      break;
    }
    lastError = response.error;
    if (attempt < 2) await sleep(250);
  }
  if (lastError) return falharDepoisDeAbortar(lastError);
  const row = (Array.isArray(data) ? data[0] : data) as {
    id?: unknown;
    proposal_id?: unknown;
    status?: unknown;
  } | null;
  if (typeof row?.id !== "string" || row.status !== "prepared") {
    return falharDepoisDeAbortar(
      new Error("A fila não devolveu um job de cancelamento no estado preparado."),
    );
  }
  registrarSucessoFilaCancelamento();
  return {
    id: row.id,
    submissionToken,
    proposalId: extractLoftProposalId(row.proposal_id),
    knownProposalIds,
  };
}

async function vincularPropostaAoCancelamento(jobId: string, proposalId: string): Promise<string> {
  const normalizedProposalId = extractLoftProposalId(proposalId);
  if (!normalizedProposalId) throw new Error("Identificador de proposta inválido.");
  const { data, error } = await (supabaseAdmin as any).rpc("attach_loft_proposal_id", {
    p_job_id: jobId,
    p_proposal_id: normalizedProposalId,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { proposal_id?: unknown } | null;
  const attachedProposalId = extractLoftProposalId(row?.proposal_id);
  if (attachedProposalId !== normalizedProposalId) {
    throw new Error("A fila não confirmou o vínculo com a proposta da Loft.");
  }
  registrarSucessoFilaCancelamento();
  return attachedProposalId;
}

async function vincularPropostaCausalAoCancelamento(
  jobId: string,
  proposalId: string,
): Promise<string> {
  const normalizedProposalId = extractLoftProposalId(proposalId);
  if (!normalizedProposalId) throw new Error("Identificador de proposta inválido.");
  const { data, error } = await (supabaseAdmin as any).rpc(
    "attach_loft_proposal_id_from_submission",
    {
      p_job_id: jobId,
      p_proposal_id: normalizedProposalId,
    },
  );
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { proposal_id?: unknown } | null;
  const attachedProposalId = extractLoftProposalId(row?.proposal_id);
  if (attachedProposalId !== normalizedProposalId) {
    throw new Error("A fila não confirmou o ID devolvido pela submissão atual.");
  }
  registrarSucessoFilaCancelamento();
  return attachedProposalId;
}

async function confirmarSubmissaoParaCancelamento(
  jobId: string,
  submittedAt: string,
): Promise<void> {
  const { data, error } = await (supabaseAdmin as any).rpc("confirm_loft_proposal_submission", {
    p_job_id: jobId,
    p_submitted_at: submittedAt,
    p_delay_seconds: Math.round(env.loftCancellationDelayMs / 1000),
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as {
    id?: unknown;
    submitted_at?: unknown;
  } | null;
  if (row?.id !== jobId || typeof row?.submitted_at !== "string") {
    throw new Error("A fila não confirmou o início do prazo de cancelamento.");
  }
  registrarSucessoFilaCancelamento();
}

async function claimNextLoftCancellation(): Promise<LoftCancellationJob | null> {
  if (!env.loftCancellationEnabled) return null;
  const { error: recoveryError } = await (supabaseAdmin as any).rpc(
    "recover_expired_loft_proposal_cancellations",
  );
  if (recoveryError) {
    throw new LoftCancellationQueueError(
      "Não foi possível recuperar leases expirados da fila de cancelamentos.",
      { cause: recoveryError },
    );
  }
  const { data, error } = await (supabaseAdmin as any).rpc(
    "claim_next_loft_proposal_cancellation",
    { p_worker_id: env.vpsId },
  );
  if (error) {
    if (isPendingLoftReconciliationError(error)) {
      registrarSucessoFilaCancelamento();
      throw error;
    }
    throw new LoftCancellationQueueError("Não foi possível reservar o próximo cancelamento.", {
      cause: error,
    });
  }
  registrarSucessoFilaCancelamento();
  const row = Array.isArray(data) ? data[0] : null;
  return row ? (row as LoftCancellationJob) : null;
}

function isPendingLoftReconciliationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Record<string, unknown>;
  if (String(candidate.code ?? "") !== "55000") return false;
  const detail = [candidate.message, candidate.details, candidate.hint]
    .map((value) => String(value ?? ""))
    .join(" ");
  return /reconcilia[cç][aã]o\s+necess[aá]ria/i.test(detail);
}

async function finishLoftCancellation(
  job: LoftCancellationJob,
  result:
    | { success: true; proposalId: string; cancellationReason: string | null }
    | { success: false; error: unknown },
): Promise<void> {
  const now = new Date();
  const terminalFailure = !result.success && job.attempt_count >= job.max_attempts;
  const retryDelayMinutes = Math.min(30, Math.max(1, 2 ** Math.max(0, job.attempt_count - 1)));
  const payload = result.success
    ? {
        status: "cancelled",
        proposal_id: result.proposalId,
        cancellation_reason: result.cancellationReason,
        cancelled_at: now.toISOString(),
        last_error: null,
        next_attempt_at: now.toISOString(),
        worker_id: null,
        lease_expires_at: null,
      }
    : {
        status: terminalFailure ? "failed" : "retry",
        last_error: redactSensitiveText(formatErrorDetail(result.error), 2_000),
        next_attempt_at: new Date(now.getTime() + retryDelayMinutes * 60_000).toISOString(),
        worker_id: null,
        lease_expires_at: null,
      };

  const { data, error } = await supabaseAdmin
    .from("loft_proposal_cancellations")
    .update(payload)
    .eq("id", job.id)
    .eq("status", "processing")
    .eq("worker_id", env.vpsId)
    .eq("attempt_count", job.attempt_count)
    .gt("lease_expires_at", now.toISOString())
    .select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("O lease do cancelamento mudou antes da gravação final.");
  registrarSucessoFilaCancelamento();
}

async function loadLoftCancellationDocument(job: LoftCancellationJob): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("consultas_credito")
    .select("documento,tenant_document")
    .eq("id", job.consultation_id)
    .maybeSingle();
  if (error) {
    throw new LoftCancellationQueueError(
      "Não foi possível carregar o documento vinculado ao cancelamento.",
      { cause: error },
    );
  }
  const document = String(data?.documento || data?.tenant_document || "").replace(/\D/g, "");
  if (!/^(?:\d{11}|\d{14})$/.test(document)) {
    throw new Error("A consulta vinculada não possui CPF/CNPJ válido para localizar a proposta.");
  }
  return document;
}

async function finishAlreadyTerminalLoftReconciliation(job: LoftCancellationJob): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("loft_proposal_cancellations")
    .update({
      status: "cancelled",
      cancellation_reason: null,
      cancelled_at: now,
      last_error: null,
      next_attempt_at: now,
      worker_id: null,
      lease_expires_at: null,
    })
    .eq("id", job.id)
    .in("status", ["prepared", "scheduled", "retry"])
    .is("proposal_id", null)
    .eq("attempt_count", job.attempt_count)
    .select("id");
  if (error) {
    throw new LoftCancellationQueueError("Não foi possível concluir a reconciliação terminal.", {
      cause: error,
    });
  }
  if (!data?.length) {
    throw new Error("O job mudou antes da conclusão da reconciliação terminal.");
  }
  registrarSucessoFilaCancelamento();
}

async function finishMissingLoftReconciliation(job: LoftCancellationJob): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("loft_proposal_cancellations")
    .update({
      status: "aborted",
      last_error: null,
      next_attempt_at: now,
      worker_id: null,
      lease_expires_at: null,
    })
    .eq("id", job.id)
    .in("status", ["scheduled", "retry"])
    .is("proposal_id", null)
    .is("worker_id", null)
    .eq("attempt_count", job.attempt_count)
    .select("id");
  if (error) {
    throw new LoftCancellationQueueError(
      "Não foi possível concluir a reconciliação sem proposta nova.",
      { cause: error },
    );
  }
  if (!data?.length) {
    throw new Error("O job mudou antes da conclusão da reconciliação vazia.");
  }
  registrarSucessoFilaCancelamento();
}

async function reconcilePreparedLoftCancellation(
  job: LoftCancellationJob,
  proposalId: string,
): Promise<void> {
  const { data, error } = await (supabaseAdmin as any).rpc("reconcile_loft_proposal_cancellation", {
    p_job_id: job.id,
    p_proposal_id: proposalId,
    p_submitted_at: job.created_at,
  });
  if (error) {
    throw new LoftCancellationQueueError(
      "Não foi possível vincular a proposta encontrada ao preparo interrompido.",
      { cause: error },
    );
  }
  const row = (Array.isArray(data) ? data[0] : data) as {
    id?: unknown;
    proposal_id?: unknown;
  } | null;
  if (row?.id !== job.id || extractLoftProposalId(row?.proposal_id) !== proposalId) {
    throw new LoftCancellationQueueError(
      "A fila não confirmou a reconciliação do preparo interrompido.",
    );
  }
  registrarSucessoFilaCancelamento();
}

async function abortPreparedLoftCancellation(job: LoftCancellationJob): Promise<void> {
  const { data, error } = await (supabaseAdmin as any).rpc("abort_loft_proposal_preparation", {
    p_consultation_id: job.consultation_id,
    p_submission_token: job.submission_token,
    p_known_proposal_ids: job.known_proposal_ids ?? [],
  });
  if (error) {
    throw new LoftCancellationQueueError(
      "Não foi possível encerrar o preparo sem envio confirmado.",
      { cause: error },
    );
  }
  const row = (Array.isArray(data) ? data[0] : data) as {
    id?: unknown;
    status?: unknown;
  } | null;
  if (row?.id !== job.id || row.status !== "aborted") {
    throw new LoftCancellationQueueError(
      "A fila não confirmou o encerramento do preparo sem envio.",
    );
  }
  registrarSucessoFilaCancelamento();
}

async function reconcilePendingLoftCancellation(
  context: BrowserContext,
  persistirSessao: () => Promise<void>,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("loft_proposal_cancellations")
    .select(
      "id,consultation_id,correlation_id,submission_token,proposal_id,known_proposal_ids,status,created_at,submitted_at,attempt_count,max_attempts",
    )
    .in("status", ["prepared", "scheduled", "retry"])
    .is("proposal_id", null)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) {
    throw new LoftCancellationQueueError(
      "Não foi possível consultar os cancelamentos que exigem reconciliação.",
      { cause: error },
    );
  }
  registrarSucessoFilaCancelamento();
  const job = Array.isArray(data) && data.length ? (data[0] as LoftCancellationJob) : null;
  if (!job) return false;

  const proximaVerificacao = proximaReconciliacaoLoftEm.get(job.id) ?? 0;
  if (Date.now() < proximaVerificacao) return true;

  const document = await loadLoftCancellationDocument(job);
  let page: Page | null = null;
  try {
    runtimeState.cancellationOperationStartedAt = new Date().toISOString();
    const visibleProposals = await runWithRuntimeWatchdog(
      (async () => {
        page = await context.newPage();
        await navegarParaPortal(page);
        await ensureLoggedIn("reconcile-cancellation", page, persistirSessao);
        return listLoftProposalsForDocument(page, document, env.loftCancellationRequestTimeoutMs);
      })(),
      {
        timeoutMs: env.loftCancellationOperationTimeoutMs,
        message:
          `A reconciliação do cancelamento excedeu ` +
          `${Math.round(env.loftCancellationOperationTimeoutMs / 1000)}s e foi abortada.`,
        abort: () => page?.close(),
      },
    );
    const resolution = resolveLoftProposalReconciliation(
      visibleProposals,
      job.known_proposal_ids ?? [],
    );
    if (!resolution) {
      if (
        !isLoftProposalReconciliationExpired(
          job.submitted_at ?? job.created_at,
          Math.max(2 * 60_000, env.loftCancellationDelayMs),
        )
      ) {
        registrarSucessoFilaCancelamento();
        runtimeState.cancellationExecution = "checking";
        proximaReconciliacaoLoftEm.set(job.id, Date.now() + RECONCILIATION_RETRY_MS);
        return true;
      }
      await persistirSessao();
      if (job.status === "prepared") await abortPreparedLoftCancellation(job);
      else await finishMissingLoftReconciliation(job);
      proximaReconciliacaoLoftEm.delete(job.id);
      runtimeState.cancellationExecution = "ok";
      log(
        "Job de cancelamento encerrado sem clique: nenhuma proposta nova apareceu após o prazo completo de reconciliação.",
      );
      return true;
    }
    if (resolution.kind === "already-terminal") {
      const submittedAt = Date.parse(job.submitted_at ?? job.created_at);
      if (!Number.isFinite(submittedAt)) {
        throw new Error("O job de reconciliação não possui uma data de envio válida.");
      }
      if (Date.now() - submittedAt < 2 * 60_000) {
        registrarSucessoFilaCancelamento();
        runtimeState.cancellationExecution = "ok";
        proximaReconciliacaoLoftEm.set(job.id, submittedAt + 2 * 60_000);
        return true;
      }
      await persistirSessao();
      await finishAlreadyTerminalLoftReconciliation(job);
      proximaReconciliacaoLoftEm.delete(job.id);
      runtimeState.cancellationExecution = "ok";
      runtimeState.totalCancellations += 1;
      runtimeState.lastSuccessfulCancellationAt = new Date().toISOString();
      log(
        `Job de cancelamento concluído sem clique: ${resolution.proposalIds.length} propostas novas já estavam em estado terminal.`,
      );
      return true;
    }
    if (job.status === "prepared") {
      await reconcilePreparedLoftCancellation(job, resolution.proposalId);
    } else {
      await vincularPropostaAoCancelamento(job.id, resolution.proposalId);
    }
    proximaReconciliacaoLoftEm.delete(job.id);
    await persistirSessao();
    runtimeState.cancellationExecution = "ok";
    log("Job de cancelamento reconciliado com a única proposta nova encontrada após o envio.");
    return true;
  } finally {
    runtimeState.cancellationOperationStartedAt = null;
    await page?.close().catch(() => {});
  }
}

async function processLoftCancellation(
  job: LoftCancellationJob,
  context: BrowserContext,
  persistirSessao: () => Promise<void>,
): Promise<void> {
  if (!env.loftCancellationEnabled || !env.loftCancellationReason) return;
  const cid = ensureCorrelationId(job.correlation_id);
  const startedAt = Date.now();
  logStructured("loft_proposal_cancellation_started", {
    correlationId: cid,
    simulationId: job.consultation_id,
    proposalId: job.proposal_id,
    attempt: job.attempt_count,
  });

  let page: Page | null = null;
  try {
    if (!job.proposal_id) {
      throw new Error(
        "O job não possui o identificador exato devolvido pelo envio; nenhuma proposta foi alterada.",
      );
    }
    const operacao = async (): Promise<{
      proposalId: string;
      status: string;
      cancellationReason: string | null;
    }> => {
      if (env.loftCancellationMode === "api" && job.proposal_id && loftCancellationClient) {
        const apiResponse = await loftCancellationClient.cancelProposal(
          job.proposal_id,
          env.loftCancellationReason,
          env.loftCancellationComment,
        );
        return {
          ...apiResponse,
          cancellationReason: env.loftCancellationReason,
        };
      }

      const document = await loadLoftCancellationDocument(job);
      page = await context.newPage();
      await navegarParaPortal(page);
      await ensureLoggedIn(cid, page, persistirSessao);
      const portalResponse = await cancelLoftProposalViaPortal(page, {
        proposalId: job.proposal_id,
        document,
        reason: env.loftCancellationReason,
        comment: env.loftCancellationComment || undefined,
        timeoutMs: env.loftCancellationRequestTimeoutMs,
        onProposalResolved: async (proposalId) => {
          const attached = await vincularPropostaAoCancelamento(job.id, proposalId);
          if (attached !== job.proposal_id) {
            throw new Error("A proposta localizada diverge do identificador persistido no job.");
          }
        },
      });
      await persistirSessao();
      return portalResponse;
    };

    runtimeState.cancellationOperationStartedAt = new Date().toISOString();
    const response = await runWithRuntimeWatchdog(operacao(), {
      timeoutMs: env.loftCancellationOperationTimeoutMs,
      message:
        `O cancelamento da proposta excedeu ` +
        `${Math.round(env.loftCancellationOperationTimeoutMs / 1000)}s e foi abortado para retentativa segura.`,
      abort: () => page?.close(),
    });
    await finishLoftCancellation(job, {
      success: true,
      proposalId: response.proposalId,
      cancellationReason: response.cancellationReason,
    });
    runtimeState.cancellationExecution = "ok";
    runtimeState.totalCancellations += 1;
    runtimeState.lastSuccessfulCancellationAt = new Date().toISOString();
    logStructured("loft_proposal_cancellation_finished", {
      correlationId: cid,
      simulationId: job.consultation_id,
      proposalId: response.proposalId,
      status: response.status,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    if (error instanceof LoftCancellationQueueError) {
      registrarFalhaFilaCancelamento("Falha de persistência no cancelamento", error);
    } else {
      // Uma proposta específica pode falhar sem provar que a superfície inteira
      // está indisponível. A sonda independente decide isso no próximo ciclo.
      proximaValidacaoCancelamentoEm = 0;
    }
    runtimeState.totalCancellationFailures += 1;
    await finishLoftCancellation(job, { success: false, error }).catch((persistenceError) =>
      registrarFalhaFilaCancelamento(
        "Falha ao devolver o cancelamento para a fila",
        persistenceError,
      ),
    );
    const terminalFailure = job.attempt_count >= job.max_attempts;
    logErro(
      `[${cid}] Cancelamento da proposta não foi confirmado; ${
        terminalFailure ? "intervenção necessária" : "nova tentativa foi agendada"
      }`,
      error,
    );
    if (job.attempt_count === 1 || terminalFailure) {
      await reportAutomationError({
        correlationId: cid,
        simulationId: job.consultation_id,
        environment: env.automationEnvironment,
        service: "loft-proposal-cancellation",
        step:
          env.loftCancellationMode === "api" && job.proposal_id
            ? "cancel-proposal-api"
            : "cancel-proposal-portal",
        error,
        attemptCount: job.attempt_count,
        durationMs: Date.now() - startedAt,
        metadata: {
          proposalId: job.proposal_id,
          terminalFailure,
        },
      });
    }
  } finally {
    runtimeState.cancellationOperationStartedAt = null;
    await page?.close().catch(() => {});
  }
}

async function claimNextConsulta(): Promise<ConsultaCreditoRow | null> {
  const { data, error } = await supabaseAdmin.rpc("claim_next_credit_simulation", {
    p_worker_id: env.vpsId,
    p_provider_credential_key: env.creditProviderCredentialKey,
  });
  if (error) throw error;
  registrarSucessoFila();
  const row = Array.isArray(data) ? data[0] : null;
  return row ? ({ ...row, inquilino: null } as unknown as ConsultaCreditoRow) : null;
}

async function renovarLease(
  consulta: ConsultaCreditoRow,
  step: string,
  providerSubmissionState?: ConsultaCreditoRow["provider_submission_state"],
): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc("heartbeat_credit_simulation", {
    p_consultation_id: consulta.id,
    p_worker_id: consulta.worker_id,
    p_lease_token: consulta.lease_token,
    p_execution_version: consulta.execution_version,
    p_step: step,
    p_provider_submission_state: providerSubmissionState ?? null,
  });
  if (error) throw error;
  if (data !== true) throw new ConsultaLeaseLostError();
  if (providerSubmissionState) consulta.provider_submission_state = providerSubmissionState;
  registrarSucessoFila();
}

/**
 * Grava a etapa atual para a barra de progresso do modal "Consultando crédito"
 * no frontend (Realtime já escuta UPDATEs desta tabela). Falha aqui nunca deve
 * derrubar a consulta — é só um indicador visual, não parte do resultado.
 */
async function atualizarStep(
  consulta: ConsultaCreditoRow,
  step:
    | "abrindo"
    | "preenchendo"
    | "enviando"
    | "aguardando_resultado"
    | "recuperando_portal"
    | "reenviando"
    | "aguardando_recuperacao_portal",
): Promise<void> {
  await renovarLease(consulta, step);
}

async function atualizarResultado(
  consulta: ConsultaCreditoRow,
  resultado: {
    status: "aprovado" | "recusado" | "em_analise" | "erro";
    mensagem: string;
    rawSummary: unknown;
    clienteNome?: string | null;
    clienteDocumento?: string | null;
    proposalId?: string | null;
  },
): Promise<void> {
  if (resultado.status === "erro") {
    throw new Error(resultado.mensagem || "O portal devolveu um resultado não reconhecido.");
  }

  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= 5; tentativa += 1) {
    try {
      const { data, error } = await supabaseAdmin.rpc("finish_credit_simulation", {
        p_consultation_id: consulta.id,
        p_worker_id: consulta.worker_id,
        p_lease_token: consulta.lease_token,
        p_execution_version: consulta.execution_version,
        p_credit_result: resultado.status,
        p_message: resultado.mensagem,
        p_raw_response: resultado.rawSummary,
        p_customer_name: resultado.clienteNome ?? null,
        p_customer_document: resultado.clienteDocumento ?? null,
        p_provider_external_id: resultado.proposalId ?? null,
      });
      if (error) throw error;
      if (data !== true) throw new ConsultaLeaseLostError();
      registrarSucessoFila();
      return;
    } catch (error) {
      if (error instanceof ConsultaStateConflictError) throw error;
      ultimoErro = error;
      registrarFalhaFila(`Falha ao salvar resultado da consulta (tentativa ${tentativa}/5)`, error);
      if (tentativa < 5) await sleep(Math.min(1_000 * 2 ** (tentativa - 1), 8_000));
    }
  }
  throw ultimoErro;
}

const PROVIDER_HEALTH_CATEGORIES = new Set([
  "AUTHENTICATION_ERROR",
  "SESSION_EXPIRED",
  "BROWSER_CRASH",
  "PLAYWRIGHT_TIMEOUT",
  "NETWORK_ERROR",
  "CREDPAGO_UNAVAILABLE",
  "INTERNAL_SERVER_ERROR",
]);

async function marcarErro(
  consulta: ConsultaCreditoRow,
  erroTecnico: string,
  options: {
    retryable: boolean;
    providerSubmissionState: ConsultaCreditoRow["provider_submission_state"];
    rawResponse?: Record<string, unknown>;
  },
): Promise<"queued" | "technical_failure" | "requires_verification" | "lease_lost"> {
  const mensagemSegura = mensagemSeguraParaErro(erroTecnico);
  const classified = classifyAutomationError(erroTecnico);
  const { data, error } = await supabaseAdmin.rpc("fail_credit_simulation", {
    p_consultation_id: consulta.id,
    p_worker_id: consulta.worker_id,
    p_lease_token: consulta.lease_token,
    p_execution_version: consulta.execution_version,
    p_error_category: classified.category,
    p_technical_detail: redactSensitiveText(erroTecnico, 2_000),
    p_user_message: mensagemSegura,
    p_raw_response: {
      ...(options.rawResponse ?? {}),
      erroTecnico: redactSensitiveText(erroTecnico, 2_000),
      categoria: classified.category,
      capturadoEm: new Date().toISOString(),
    },
    p_retryable: options.retryable,
    p_provider_submission_state: options.providerSubmissionState,
    p_affects_provider_health: PROVIDER_HEALTH_CATEGORIES.has(classified.category),
  });
  if (error) throw error;
  registrarSucessoFila();
  return String(data) as "queued" | "technical_failure" | "requires_verification" | "lease_lost";
}

/**
 * Falha de autenticação não é falha de crédito. Preserva a consulta na fila para
 * retomá-la automaticamente depois que a sessão for recuperada, em vez de mostrar
 * erro ao corretor no site ou no aplicativo.
 */
async function recolocarNaFilaAguardandoServico(
  consulta: ConsultaCreditoRow,
  step:
    | "aguardando_autenticacao"
    | "aguardando_liberacao_parceiro"
    | "aguardando_cancelamento" = "aguardando_autenticacao",
): Promise<"queued" | "technical_failure" | "requires_verification" | "lease_lost"> {
  const technicalDetail =
    step === "aguardando_cancelamento"
      ? "A fila causal de cancelamento está temporariamente indisponível."
      : step === "aguardando_liberacao_parceiro"
        ? "A conta do parceiro está temporariamente indisponível."
        : "A autenticação do parceiro precisa ser renovada.";
  return marcarErro(consulta, technicalDetail, {
    retryable: true,
    providerSubmissionState: "not_submitted",
    rawResponse: { step },
  });
}

async function atualizarMetricasFila(): Promise<void> {
  const agora = Date.now();
  if (agora - ultimaRecuperacaoConsultasEm < env.queueMetricsIntervalMs) return;
  ultimaRecuperacaoConsultasEm = agora;
  const { data, error } = await supabaseAdmin.rpc("get_credit_automation_metrics");
  if (error) throw error;
  const metrics = (data ?? {}) as Record<string, unknown>;
  runtimeState.queueDepth = Number(metrics.queued) || 0;
  runtimeState.retryingConsultations = Number(metrics.retrying) || 0;
  runtimeState.requiresVerification = Number(metrics.requiresVerification) || 0;
  runtimeState.expiredLeases = Number(metrics.expiredLeases) || 0;
  runtimeState.oldestQueueAgeSeconds = Number(metrics.oldestQueueAgeSeconds) || 0;
  runtimeState.providerConsecutiveFailures = Number(metrics.providerConsecutiveFailures) || 0;
  runtimeState.circuitOpen = metrics.circuitOpen === true;
  runtimeState.circuitOpenUntil =
    typeof metrics.circuitOpenUntil === "string" ? metrics.circuitOpenUntil : null;
  registrarSucessoFila();
}

/**
 * Expõe aos clientes que a fila está pausada por autenticação. Sem esta etapa,
 * uma consulta nova permanecia como "pendente" sem qualquer indicação enquanto
 * o worker tentava recuperar a sessão do parceiro.
 */
async function sinalizarFilaAguardandoServico(
  step: "aguardando_autenticacao" | "aguardando_liberacao_parceiro",
): Promise<void> {
  const agora = Date.now();
  if (agora - ultimaSinalizacaoAuthNaFilaEm < env.authRetryIntervalMs) return;
  ultimaSinalizacaoAuthNaFilaEm = agora;

  const { data, error } = await supabaseAdmin
    .from("consultas_credito")
    .update({ automation_step: step })
    .eq("status", "pendente")
    .eq("origem", "nox_financa")
    .select("id");

  if (error) throw error;
  registrarSucessoFila();
  if (data?.length) {
    log(
      step === "aguardando_liberacao_parceiro"
        ? `${data.length} consulta(s) preservada(s) enquanto a conta aguarda liberacao do parceiro.`
        : `${data.length} consulta(s) aguardando a recuperação da autenticação.`,
    );
  }
}

async function validarAutenticacao(
  context: BrowserContext,
  persistirSessao: () => Promise<void>,
): Promise<boolean> {
  const agora = Date.now();
  if (agora < proximaValidacaoAuthEm) return runtimeState.auth === "ok";

  const statusAnterior = runtimeState.auth;
  runtimeState.auth = "checking";
  runtimeState.lastAuthCheckAt = new Date().toISOString();
  runtimeState.authCheckStartedAt = runtimeState.lastAuthCheckAt;

  let page: Page | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    page = await context.newPage();
    const validacao = (async () => {
      await navegarParaPortal(page!, Math.min(30_000, env.authValidationTimeoutMs));
      await ensureLoggedIn("auth", page!, persistirSessao);
      await assertCreditSimulationAvailable(page!);

      if ((await detectAuthenticationState(page!)) !== "authenticated") {
        throw new CredPagoAuthenticationError(
          "A sessão ainda redireciona para o portal de autenticação.",
        );
      }
    })();

    const watchdog = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void page?.close().catch(() => {});
        reject(
          new Error(
            `A validação da autenticação excedeu ${Math.round(env.authValidationTimeoutMs / 1000)}s e foi abortada.`,
          ),
        );
      }, env.authValidationTimeoutMs);
    });

    await Promise.race([validacao, watchdog]);

    runtimeState.auth = "ok";
    runtimeState.lastAuthSuccessAt = new Date().toISOString();
    runtimeState.consecutiveAuthFailures = 0;
    proximaValidacaoAuthEm = Date.now() + env.authCheckIntervalMs;
    if (statusAnterior !== "ok") {
      log("Autenticação da CredPago validada — fila liberada.");
    }
    return true;
  } catch (error) {
    const isAuthError = error instanceof CredPagoAuthenticationError;
    const isAccountBlocked = isCredPagoAccountBlockedError(error);
    runtimeState.auth = isAccountBlocked ? "blocked" : isAuthError ? "required" : "unavailable";
    runtimeState.consecutiveAuthFailures += 1;
    proximaValidacaoAuthEm = Date.now() + env.authRetryIntervalMs;
    if (statusAnterior !== runtimeState.auth) {
      logErro(
        isAccountBlocked
          ? "Fila pausada: a conta do parceiro esta bloqueada para criar contratos"
          : isAuthError
            ? "Fila pausada: a autenticação da CredPago precisa ser recuperada"
            : "Fila pausada: não foi possível validar o portal da CredPago",
        error,
      );
    }
    return false;
  } finally {
    if (timer) clearTimeout(timer);
    runtimeState.authCheckStartedAt = null;
    await page?.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Processamento de uma consulta — sempre com sua PRÓPRIA aba, nunca compartilhada
// com outra consulta em andamento. `estado.finalizado` evita que um resultado
// atrasado sobrescreva um status já gravado pelo timeout (ou vice-versa).
// ---------------------------------------------------------------------------

interface EstadoConsulta {
  finalizado: boolean;
  persistindoResultado: boolean;
  page: Page | null;
  lastSuccessfulStep: string | null;
  startedAt: number;
  simulationSubmitted: boolean;
  currentStep: string;
  leaseLost: boolean;
}

async function processarConsulta(
  context: BrowserContext,
  consulta: ConsultaCreditoRow,
  estado: EstadoConsulta,
  persistirSessao: () => Promise<void>,
): Promise<void> {
  const correlationId = ensureCorrelationId(consulta.correlation_id);
  const cid = correlationId;
  const doc = consulta.documento_masked || maskDocumento(consulta.documento);
  log(`[${cid}] Consulta recebida (documento ${doc})`);
  logStructured("credit_simulation_started", {
    correlationId,
    simulationId: consulta.id,
    document: doc,
  });

  let page: Page | null = null;
  let simulacaoEnviada = false;
  let resultadoObtido = false;
  const cancelamentosAgendados: TrackedLoftCancellation[] = [];
  const snapshotsEmAndamento = new Set<Promise<unknown>>();
  let ultimoCancelamentoEnviado: TrackedLoftCancellation | null = null;
  const creditSimulationCep = selectRandomCreditSimulationCep();
  const atualizarEtapa = async (
    step:
      | "abrindo"
      | "preenchendo"
      | "enviando"
      | "aguardando_resultado"
      | "recuperando_portal"
      | "reenviando"
      | "aguardando_recuperacao_portal",
  ) => {
    estado.currentStep = step;
    await atualizarStep(consulta, step);
  };
  try {
    const erroValidacao = validateConsultaForAutomation(consulta);
    if (erroValidacao) throw new Error(`Dados da consulta inválidos: ${erroValidacao}.`);

    page = await context.newPage();
    estado.page = page;
    estado.lastSuccessfulStep = "page-created";
    log(`[${cid}] Abrindo CredPago`);
    const sessaoPodeEstarFria = Date.now() - ultimaAtividadeEm > SESSAO_OCIOSA_MS;
    ultimaAtividadeEm = Date.now();
    await navegarParaPortal(page);
    estado.lastSuccessfulStep = "portal-opened";

    if (sessaoPodeEstarFria) {
      log(
        `[${cid}] Sessão ociosa há mais de ${Math.round(SESSAO_OCIOSA_MS / 60000)}min — recarregando antes de preencher (evita o clique em "Simular Crédito" travar sem erro).`,
      );
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    }

    await ensureLoggedIn(cid, page, persistirSessao);
    estado.lastSuccessfulStep = "authentication-confirmed";
    runtimeState.auth = "ok";
    runtimeState.lastAuthSuccessAt = new Date().toISOString();
    proximaValidacaoAuthEm = Date.now() + env.authCheckIntervalMs;

    const prepararFormularioDaConsulta = async () => {
      if (consulta.tipo_pessoa === "PJ") {
        log(`[${cid}] Abrindo formulário de Pessoa Jurídica da Fiança Aluguel`);
        await openLegacyCreditSimulation(page!, env.credpagoLegacyUrl);
        // A primeira navegação cria cookies próprios desse módulo. Persisti-los
        // evita repetir o ciclo completo quando o worker reiniciar.
        await persistirSessao();
      } else if (!isCreditSimulationUrl(page!.url())) {
        // O login costuma redirecionar para o dashboard em vez de voltar à origem.
        await navegarParaPortal(page!);
      }
    };
    await prepararFormularioDaConsulta();

    if (await isCaptchaPresent(page)) {
      throw new Error(
        "A CredPago exibiu um captcha. A automação não tenta resolver captchas — resolva manualmente e reenvie a consulta.",
      );
    }
    await assertCreditSimulationAvailable(page);

    const reportarFalhaDeAgendamento = async (
      error: unknown,
      submissionToken: string,
      step:
        | "snapshot-proposals-before-submission"
        | "schedule-proposal-cancellation"
        | "confirm-proposal-submission"
        | "attach-proposal-id",
      proposalId?: string | null,
    ) => {
      registrarFalhaFilaCancelamento(
        step === "attach-proposal-id"
          ? "Falha ao vincular o identificador da proposta ao cancelamento"
          : step === "confirm-proposal-submission"
            ? "Falha ao iniciar o prazo do cancelamento depois do envio"
            : step === "snapshot-proposals-before-submission"
              ? "Falha ao fotografar as propostas existentes antes do envio"
              : "Falha ao agendar o cancelamento da proposta",
        error,
      );
      await reportAutomationError({
        correlationId,
        simulationId: consulta.id,
        initiatingUserId: consulta.profile_id_solicitante,
        environment: env.automationEnvironment,
        service: "loft-proposal-cancellation",
        step,
        error,
        metadata: {
          simulationSubmitted: simulacaoEnviada,
          proposalIdAvailable: Boolean(proposalId),
          submissionToken,
        },
      });
    };

    type SnapshotPropostas =
      | { ok: true; knownProposalIds: string[]; durationMs: number }
      | { ok: false; error: unknown; durationMs: number };

    const capturarSnapshotPropostas = async (): Promise<string[]> => {
      let snapshotPage: Page | null = null;
      try {
        let knownProposalIds: string[] | null = null;
        let lastSnapshotError: unknown = null;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          await snapshotPage?.close().catch(() => {});
          snapshotPage = await context.newPage();
          try {
            knownProposalIds = await listLoftProposalIdsForDocument(
              snapshotPage,
              consulta.documento || consulta.tenant_document || "",
              env.loftCancellationRequestTimeoutMs,
            );
            lastSnapshotError = null;
            break;
          } catch (error) {
            lastSnapshotError = error;
            if (attempt < 2) {
              log(
                `[${cid}] A lista de propostas não estabilizou — repetindo a captura segura uma única vez.`,
              );
              await sleep(500);
            }
          }
        }
        if (!knownProposalIds) {
          throw lastSnapshotError ?? new Error("A lista de propostas não pôde ser fotografada.");
        }
        return knownProposalIds;
      } finally {
        await snapshotPage?.close().catch(() => {});
      }
    };

    const iniciarSnapshotPropostas = (): Promise<SnapshotPropostas> => {
      const startedAt = Date.now();
      const snapshot: Promise<SnapshotPropostas> = capturarSnapshotPropostas().then(
        (knownProposalIds) => ({
          ok: true as const,
          knownProposalIds,
          durationMs: Date.now() - startedAt,
        }),
        (error) => ({ ok: false as const, error, durationMs: Date.now() - startedAt }),
      );
      snapshotsEmAndamento.add(snapshot);
      void snapshot.finally(() => snapshotsEmAndamento.delete(snapshot));
      return snapshot;
    };

    const prepararCancelamentoAntesDoEnvio = async (
      submissionToken: string,
      snapshotPrecarregado?: SnapshotPropostas | null,
    ) => {
      if (!env.loftCancellationEnabled) return null;
      let snapshotCaptured = false;
      try {
        const snapshot = snapshotPrecarregado ?? (await iniciarSnapshotPropostas());
        if (!snapshot.ok) throw snapshot.error;
        const knownProposalIds = snapshot.knownProposalIds;
        log(`[${cid}] Snapshot de segurança pronto em ${snapshot.durationMs}ms.`);
        snapshotCaptured = true;
        const scheduled = await agendarCancelamentoLoft(
          consulta,
          submissionToken,
          knownProposalIds,
        );
        if (!scheduled) return null;
        const tracking: TrackedLoftCancellation = {
          ...scheduled,
          clicked: false,
          submittedAt: null,
          confirmed: false,
        };
        cancelamentosAgendados.push(tracking);
        return tracking;
      } catch (error) {
        const step = snapshotCaptured
          ? "schedule-proposal-cancellation"
          : "snapshot-proposals-before-submission";
        await reportarFalhaDeAgendamento(error, submissionToken, step).catch((reportError) =>
          logErro("Falha ao registrar indisponibilidade do cancelamento", reportError),
        );
        if (env.loftCancellationRequired) {
          throw new LoftCancellationUnavailableError(
            "A simulação não foi enviada porque o cancelamento obrigatório não pôde ser preparado com segurança.",
            { cause: error },
          );
        }
        return null;
      }
    };

    const confirmarEnvioPreparado = async (tracking: TrackedLoftCancellation) => {
      if (tracking.confirmed || !tracking.clicked || !tracking.submittedAt) {
        return;
      }
      try {
        await confirmarSubmissaoParaCancelamento(tracking.id, tracking.submittedAt);
        tracking.confirmed = true;
      } catch (error) {
        await reportarFalhaDeAgendamento(
          error,
          tracking.submissionToken,
          "confirm-proposal-submission",
          tracking.proposalId,
        ).catch((reportError) =>
          logErro("Falha ao registrar a confirmação pendente do cancelamento", reportError),
        );
      }
    };

    const vincularResultadoAoUltimoEnvio = async (proposalId: string | null): Promise<boolean> => {
      if (!env.loftCancellationEnabled) return false;
      const normalizedProposalId = extractLoftProposalId(proposalId);
      if (!normalizedProposalId) return false;

      const target = ultimoCancelamentoEnviado;
      if (!target) {
        await reportarFalhaDeAgendamento(
          new Error("Nenhum job preparado corresponde ao envio que devolveu a proposta."),
          randomUUID(),
          "attach-proposal-id",
          normalizedProposalId,
        );
        return false;
      }

      target.proposalId = normalizedProposalId;
      try {
        await confirmarEnvioPreparado(target);
        // Este caminho só recebe o ID extraído do mesmo payload HTTP que trouxe
        // o resultado da submissão atual. A Loft pode atualizar e devolver uma
        // proposta já presente no snapshot, sem criar um novo identificador.
        target.proposalId = await vincularPropostaCausalAoCancelamento(
          target.id,
          normalizedProposalId,
        );
        return true;
      } catch (error) {
        await reportarFalhaDeAgendamento(
          error,
          target.submissionToken,
          "attach-proposal-id",
          normalizedProposalId,
        );
        return false;
      }
    };

    const executionPage = page;
    if (!executionPage) throw new Error("A página da simulação não foi inicializada.");

    const executarTentativa = async (tentativa: number) => {
      log(`[${cid}] Preenchendo dados${tentativa > 1 ? ` (recuperação ${tentativa - 1}/1)` : ""}`);
      // A Loft mantém estado mutável no contexto autenticado. Concluímos e fechamos
      // a página do snapshot antes de começar a preencher a simulação para que duas
      // superfícies do portal nunca disputem a mesma sessão.
      let snapshotPrecarregado = env.loftCancellationEnabled
        ? await iniciarSnapshotPropostas()
        : null;
      await atualizarEtapa(tentativa > 1 ? "recuperando_portal" : "preenchendo");
      await fillPessoa(executionPage, consulta.tipo_pessoa || "PF");
      await fillDocumento(executionPage, consulta.documento || "", consulta.tipo_pessoa || "PF");
      await fillTipoImovel(
        executionPage,
        (consulta.tipo_imovel as "Residencial" | "Comercial") || "Residencial",
      );
      // O portal exige CEP, mas o valor digitado no NOX é apenas visual e não é
      // persistido. Um CEP operacional é sorteado uma vez para este processamento.
      await fillCep(executionPage, creditSimulationCep);
      await fillValores(executionPage, {
        aluguel: Number(consulta.valor_aluguel) || 0,
        condominio: Number(consulta.valor_condominio) || 0,
        taxas: Number(consulta.valor_taxas) || 0,
      });
      estado.lastSuccessfulStep = tentativa > 1 ? "recovery-form-filled" : "form-filled";

      log(`[${cid}] Enviando simulação${tentativa > 1 ? " novamente" : ""}`);
      await atualizarEtapa(tentativa > 1 ? "reenviando" : "enviando");
      let apiObserver: ReturnType<typeof observeCreditSimulationApi> | null = null;
      const enviarSimulacaoComCancelamento = async () => {
        apiObserver?.dispose();
        const clickObserver = observeCreditSimulationApi(executionPage);
        apiObserver = clickObserver;
        const aguardarPostDaSimulacao = async (): Promise<boolean> => {
          if (consulta.tipo_pessoa === "PJ") return true;
          const deadline = Date.now() + 5_000;
          do {
            if (clickObserver.hasStarted()) return true;
            await executionPage.waitForTimeout(100);
          } while (Date.now() < deadline);
          return clickObserver.hasStarted();
        };
        // Cada clique possível possui sua própria identidade. Se a preparação
        // opcional desta tentativa falhar, nunca reutilizamos o job de um envio
        // anterior para anexar o ID devolvido por este novo POST.
        ultimoCancelamentoEnviado = null;
        const submissionToken = randomUUID();
        let tracking: TrackedLoftCancellation | null = null;
        const snapshotDesteClique = snapshotPrecarregado;
        snapshotPrecarregado = null;
        const registrarEnvioObservado = async () => {
          simulacaoEnviada = true;
          estado.simulationSubmitted = true;
          estado.currentStep = "aguardando_resultado";
          await renovarLease(consulta, estado.currentStep, "submitted");
          if (tracking) {
            tracking.clicked = true;
            tracking.submittedAt ??= new Date().toISOString();
            ultimoCancelamentoEnviado = tracking;
            await confirmarEnvioPreparado(tracking);
          }
        };
        try {
          await submitSimulation(executionPage, {
            onBeforeClick: async () => {
              tracking = await prepararCancelamentoAntesDoEnvio(
                submissionToken,
                snapshotDesteClique,
              );
              // Persist this before the mouse event. A crash after this point is
              // uncertain and must be reconciled instead of blindly retried.
              await renovarLease(consulta, estado.currentStep, "submitting");
            },
            onAfterClick: async () => {
              if (!(await aguardarPostDaSimulacao())) {
                throw new LoftCancellationUnavailableError(
                  "O clique não produziu o POST esperado da simulação; o prazo de cancelamento não foi iniciado.",
                );
              }
              await registrarEnvioObservado();
            },
          });
        } catch (error) {
          // Um erro do Playwright entre onBeforeClick e onAfterClick pode ocorrer
          // antes ou depois do evento de mouse. Para PF, o POST observado decide:
          // se começou, preservamos o job; se não começou, o prepared bloqueia
          // a fila para uma reconciliação segura.
          const preparedTracking = tracking as TrackedLoftCancellation | null;
          if (preparedTracking && !preparedTracking.clicked && consulta.tipo_pessoa !== "PJ") {
            if (await aguardarPostDaSimulacao()) {
              await registrarEnvioObservado();
            }
          }
          throw error;
        }
      };
      try {
        await enviarSimulacaoComCancelamento();
        estado.lastSuccessfulStep =
          tentativa > 1 ? "recovery-simulation-submitted" : "simulation-submitted";

        log(`[${cid}] Aguardando resultado`);
        await atualizarEtapa("aguardando_resultado");
        return await parseResultado(executionPage, {
          tipoPessoa: consulta.tipo_pessoa === "PJ" ? "PJ" : "PF",
          onLog: (msg) => log(`[${cid}] ${msg}`),
          readObservedResult: () => apiObserver?.read() ?? null,
          hasObservedRequest: () =>
            consulta.tipo_pessoa === "PJ" ? simulacaoEnviada : (apiObserver?.hasStarted() ?? false),
          lookupSubmittedProposal:
            consulta.tipo_pessoa === "PJ"
              ? () =>
                  lookupLegacyProposalResult(
                    executionPage,
                    consulta.documento || "",
                    15_000,
                    ultimoCancelamentoEnviado?.knownProposalIds ?? [],
                  )
              : undefined,
          // Só reclica quando o envio não causou mudança alguma; nunca durante uma
          // análise confirmada ou depois de uma resposta do portal.
          onRetryClick: consulta.tipo_pessoa === "PJ" ? undefined : enviarSimulacaoComCancelamento,
        });
      } finally {
        (apiObserver as ReturnType<typeof observeCreditSimulationApi> | null)?.dispose();
      }
    };

    let resultado: Awaited<ReturnType<typeof executarTentativa>>;
    try {
      resultado = await executarTentativa(1);
    } catch (error) {
      if (
        !(error instanceof CreditSimulationFormNotReadyError) ||
        simulacaoEnviada ||
        ultimoCancelamentoEnviado
      ) {
        throw error;
      }

      log(
        `[${cid}] O portal não concluiu a validação do formulário — recarregando e preenchendo novamente uma única vez.`,
      );
      await atualizarEtapa("recuperando_portal");
      await navegarParaPortal(page);
      await ensureLoggedIn(cid, page, persistirSessao);
      await prepararFormularioDaConsulta();
      await assertCreditSimulationAvailable(page);
      resultado = await executarTentativa(2);
      resultado.rawSummary = {
        ...resultado.rawSummary,
        recuperacaoFormularioTentada: true,
      };
    }
    if (
      resultado.status === "erro" &&
      resultado.rawSummary.motivoTecnico === "provider_internal_error"
    ) {
      const origemPrimeiroResultado = String(resultado.rawSummary.resultadoCapturadoVia || "");
      const proposalIdPrimeiroEnvio =
        origemPrimeiroResultado === "resposta_api" ? resultado.proposalId : null;
      if (proposalIdPrimeiroEnvio) {
        const linked = await vincularResultadoAoUltimoEnvio(proposalIdPrimeiroEnvio);
        if (!linked) {
          throw new LoftCancellationUnavailableError(
            "A recuperação foi interrompida porque o ID do primeiro envio não pôde ser vinculado ao seu job.",
          );
        }
      } else if (ultimoCancelamentoEnviado) {
        throw new LoftCancellationUnavailableError(
          "A Loft retornou erro interno sem um ID causal; o job foi preservado para reconciliação e o reenvio foi bloqueado.",
        );
      }
      log(
        `[${cid}] O portal informou erro interno — aguardando 5s e refazendo a análise uma única vez.`,
      );
      await atualizarEtapa("aguardando_recuperacao_portal");
      await page.waitForTimeout(5_000);
      await navegarParaPortal(page);
      await ensureLoggedIn(cid, page, persistirSessao);
      await prepararFormularioDaConsulta();
      await assertCreditSimulationAvailable(page);
      resultado = await executarTentativa(2);
      resultado.rawSummary = {
        ...resultado.rawSummary,
        recuperacaoAutomaticaTentada: true,
      };
    }
    resultadoObtido = true;
    const resultadoCapturadoVia = String(resultado.rawSummary.resultadoCapturadoVia || "");
    const proposalIdCapturadoNoProprioFluxo =
      resultadoCapturadoVia === "resposta_api" ? resultado.proposalId : null;
    await vincularResultadoAoUltimoEnvio(proposalIdCapturadoNoProprioFluxo);
    estado.lastSuccessfulStep = "result-read";
    log(`[${cid}] Resultado identificado: ${resultado.status}`);

    if (resultado.status === "erro") {
      const technicalReason = String(
        resultado.rawSummary.motivoTecnico || resultado.mensagem || "result_not_recognized",
      );
      const disposition = await marcarErro(consulta, technicalReason, {
        retryable: false,
        providerSubmissionState: simulacaoEnviada ? "submitted" : "not_submitted",
        rawResponse: resultado.rawSummary,
      });
      estado.finalizado = true;
      runtimeState.totalProcessed += 1;
      runtimeState.totalFailed += 1;
      log(
        `[${cid}] Resultado técnico finalizado como ${disposition}; nenhuma decisão de crédito foi gravada.`,
      );
      return;
    }

    if (estado.finalizado) {
      log(
        `[${cid}] Resultado chegou após o tempo limite já ter marcado erro — descartando para não sobrescrever.`,
      );
      return;
    }
    estado.persistindoResultado = true;
    try {
      await atualizarResultado(consulta, {
        ...resultado,
        // O portal é a fonte principal. Se uma versão da tela não renderizar o
        // nome, o cadastro vinculado pelo CPF mantém o resultado identificável.
        clienteNome: primeiroNomeCliente(
          resultado.clienteNome,
          consulta.tenant_name,
          consulta.inquilino?.nome,
          consulta.inquilino?.razao_social,
        ),
        clienteDocumento:
          resultado.clienteDocumento ||
          somenteDigitos(consulta.documento) ||
          somenteDigitos(consulta.tenant_document) ||
          somenteDigitos(consulta.inquilino?.cpf) ||
          somenteDigitos(consulta.inquilino?.cnpj),
      });
      estado.finalizado = true;
      estado.lastSuccessfulStep = "result-persisted";
    } finally {
      estado.persistindoResultado = false;
    }
    log(`[${cid}] Consulta atualizada -> ${resultado.status}`);
    const durationMs = Date.now() - estado.startedAt;
    recentDurations.push(durationMs);
    if (recentDurations.length > 100) recentDurations.shift();
    runtimeState.totalProcessed += 1;
    runtimeState.averageDurationMs = Math.round(
      recentDurations.reduce((sum, value) => sum + value, 0) / recentDurations.length,
    );
    runtimeState.lastSuccessfulSimulationAt = new Date().toISOString();
    logStructured("credit_simulation_finished", {
      correlationId,
      simulationId: consulta.id,
      status: resultado.status,
      durationMs,
    });
  } catch (err) {
    const erroTecnico = formatErrorDetail(err);
    logErro(`[${cid}] Falha ao processar consulta`, err);
    if (estado.finalizado) {
      log(
        `[${cid}] Erro chegou após o tempo limite já ter finalizado a consulta — ignorando gravação.`,
      );
      return;
    }
    if (err instanceof ConsultaStateConflictError) {
      estado.finalizado = true;
      log(
        `[${cid}] O estado da consulta mudou antes da gravação; resultado tardio descartado com segurança.`,
      );
      return;
    }
    if (resultadoObtido) {
      // O parceiro já respondeu. Não converte uma resposta real em "erro" só porque
      // o banco ficou indisponível durante a gravação; o lease a recuperará se todas
      // as cinco tentativas de persistência falharem.
      logErro(
        `[${cid}] Resultado obtido, mas não persistido após as tentativas; consulta será recuperada pelo lease`,
        err,
      );
      return;
    }

    const falhaTemporariaAntesDoEnvio =
      !simulacaoEnviada &&
      (err instanceof CredPagoAuthenticationError ||
        err instanceof CredPagoServiceUnavailableError ||
        err instanceof LoftCancellationUnavailableError ||
        isCredPagoAccountBlockedError(err) ||
        isTransientPortalError(err));
    estado.finalizado = true;
    if (falhaTemporariaAntesDoEnvio) {
      const falhaDeAutenticacao = err instanceof CredPagoAuthenticationError;
      const falhaDeCancelamento = err instanceof LoftCancellationUnavailableError;
      const contaBloqueada = isCredPagoAccountBlockedError(err);
      if (!falhaDeCancelamento) {
        runtimeState.auth = contaBloqueada
          ? "blocked"
          : falhaDeAutenticacao
            ? "required"
            : "unavailable";
        runtimeState.lastAuthCheckAt = new Date().toISOString();
        runtimeState.consecutiveAuthFailures += 1;
        proximaValidacaoAuthEm = 0;
      }
      const artifacts = await captureSafeErrorArtifacts(page, false);
      const returnedToQueue = await recolocarNaFilaAguardandoServico(
        consulta,
        falhaDeCancelamento ? "aguardando_cancelamento" : "aguardando_liberacao_parceiro",
      )
        .then((value) => {
          if (value === "queued") {
            log(`[${cid}] Consulta preservada na fila enquanto o serviço é recuperado.`);
            return true;
          }
          runtimeState.totalProcessed += 1;
          runtimeState.totalFailed += 1;
          log(`[${cid}] Consulta finalizada tecnicamente como ${value}.`);
          return false;
        })
        .catch((e) => {
          logErro(`[${cid}] Falha ao devolver consulta para a fila`, e);
          return false;
        });
      await reportAutomationError({
        correlationId,
        simulationId: consulta.id,
        initiatingUserId: consulta.profile_id_solicitante,
        environment: env.automationEnvironment,
        step: estado.lastSuccessfulStep ?? "service-recovery",
        lastSuccessfulStep: estado.lastSuccessfulStep,
        error: err,
        durationMs: Date.now() - estado.startedAt,
        metadata: { consultationReturnedToQueue: returnedToQueue, simulationSubmitted: false },
        artifacts,
      });
    } else {
      const artifacts = await captureSafeErrorArtifacts(page, simulacaoEnviada);
      const persisted = await marcarErro(consulta, erroTecnico, {
        retryable: false,
        providerSubmissionState: simulacaoEnviada ? "submitted" : "not_submitted",
      })
        .then(() => true)
        .catch((e) => {
          logErro(`[${cid}] Falha ao gravar erro no Supabase`, e);
          return false;
        });
      runtimeState.totalProcessed += 1;
      runtimeState.totalFailed += 1;
      await reportAutomationError({
        correlationId,
        simulationId: consulta.id,
        initiatingUserId: consulta.profile_id_solicitante,
        environment: env.automationEnvironment,
        step: estado.lastSuccessfulStep ?? "unknown",
        lastSuccessfulStep: estado.lastSuccessfulStep,
        error: err,
        durationMs: Date.now() - estado.startedAt,
        metadata: { consultationStatusPersisted: persisted, simulationSubmitted: simulacaoEnviada },
        artifacts,
      });
    }
  } finally {
    // Uma falha de preenchimento pode acontecer enquanto a aba paralela ainda
    // termina o snapshot. Aguarda seu fechamento antes de liberar a sessao.
    await Promise.allSettled(Array.from(snapshotsEmAndamento));
    for (const tracking of cancelamentosAgendados) {
      if (!tracking.clicked || !tracking.submittedAt || tracking.confirmed) {
        continue;
      }
      await confirmarSubmissaoParaCancelamento(tracking.id, tracking.submittedAt)
        .then(() => {
          tracking.confirmed = true;
        })
        .catch((error) =>
          registrarFalhaFilaCancelamento(
            "Submissão enviada permaneceu sem confirmação na fila de cancelamentos",
            error,
          ),
        );
    }
    for (const tracking of cancelamentosAgendados) {
      if (!tracking.proposalId) continue;
      await vincularPropostaAoCancelamento(tracking.id, tracking.proposalId).catch((error) =>
        registrarFalhaFilaCancelamento(
          "Identificador exato permaneceu sem vínculo na fila de cancelamentos",
          error,
        ),
      );
    }
    await page?.close().catch(() => {});
    estado.page = null;
    log(`[${cid}] Aba fechada`);
  }
}

/** Envolve processarConsulta com um limite de tempo próprio, sem afetar outras consultas em paralelo. */
async function processarConsultaComTimeout(
  context: BrowserContext,
  consulta: ConsultaCreditoRow,
  persistirSessao: () => Promise<void>,
): Promise<void> {
  const correlationId = ensureCorrelationId(consulta.correlation_id);
  const cid = correlationId;
  const estado: EstadoConsulta = {
    finalizado: false,
    persistindoResultado: false,
    page: null,
    lastSuccessfulStep: "claimed",
    startedAt: Date.now(),
    simulationSubmitted: false,
    currentStep: "abrindo",
    leaseLost: false,
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatInFlight = false;
  let heartbeatFailures = 0;
  let timeoutAtingido = false;
  const heartbeatTimer = setInterval(() => {
    if (heartbeatInFlight || estado.finalizado || estado.leaseLost) return;
    heartbeatInFlight = true;
    void renovarLease(
      consulta,
      estado.currentStep,
      estado.simulationSubmitted ? "submitted" : undefined,
    )
      .then(() => {
        heartbeatFailures = 0;
      })
      .catch(async (error) => {
        heartbeatFailures += 1;
        registrarFalhaFila(
          `[${cid}] Falha no heartbeat da consulta (${heartbeatFailures}/3)`,
          error,
        );
        if (error instanceof ConsultaLeaseLostError || heartbeatFailures >= 3) {
          estado.leaseLost = true;
          await estado.page?.close().catch(() => {});
        }
      })
      .finally(() => {
        heartbeatInFlight = false;
      });
  }, env.creditHeartbeatIntervalMs);
  const timeoutPromise = new Promise<void>((resolve) => {
    timer = setTimeout(async () => {
      if (estado.finalizado) return;
      if (estado.persistindoResultado) {
        log(
          `[${cid}] Resultado já recebido no tempo limite; aguardando apenas a gravação resiliente no Supabase.`,
        );
        return;
      }
      timeoutAtingido = true;
      estado.finalizado = true;
      logErro(`[${cid}] Tempo limite de ${env.consultaTimeoutMs}ms excedido`);
      const timeoutError = new Error(
        `Tempo limite de ${Math.round(env.consultaTimeoutMs / 1000)}s excedido ao consultar.`,
      );
      const artifacts = await Promise.race([
        captureSafeErrorArtifacts(estado.page, estado.simulationSubmitted),
        new Promise<Awaited<ReturnType<typeof captureSafeErrorArtifacts>>>((resolve) =>
          setTimeout(
            () => resolve({ screenshotSkippedReason: "Captura excedeu o prazo seguro." }),
            2_000,
          ),
        ),
      ]);
      // Interrompe de verdade a aba desta consulta. Antes, o trabalho continuava em
      // segundo plano e um retry podia enviar a mesma simulação duas vezes.
      await estado.page?.close().catch(() => {});
      const disposition = await marcarErro(consulta, timeoutError.message, {
        retryable: !estado.simulationSubmitted,
        providerSubmissionState: estado.simulationSubmitted ? "submitted" : "not_submitted",
      }).catch((e) => {
        logErro(`[${cid}] Falha ao gravar o estado de timeout no Supabase`, e);
        return "lease_lost" as const;
      });
      if (disposition === "technical_failure" || disposition === "requires_verification") {
        runtimeState.totalProcessed += 1;
        runtimeState.totalFailed += 1;
      }
      await reportAutomationError({
        correlationId,
        simulationId: consulta.id,
        initiatingUserId: consulta.profile_id_solicitante,
        environment: env.automationEnvironment,
        step: "timeout",
        lastSuccessfulStep: estado.lastSuccessfulStep,
        error: timeoutError,
        durationMs: Date.now() - estado.startedAt,
        artifacts,
      });
      resolve();
    }, env.consultaTimeoutMs);
  });

  const trabalho = processarConsulta(context, consulta, estado, persistirSessao);

  try {
    await Promise.race([trabalho, timeoutPromise]);
  } finally {
    clearTimeout(timer);
    clearInterval(heartbeatTimer);
  }
  if (timeoutAtingido) {
    // Fechar a aba faz as operações Playwright pendentes rejeitarem rapidamente. O
    // teto abaixo evita reter para sempre uma vaga por uma dependência externa ruim.
    await Promise.race([
      trabalho,
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ]).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Bootstrap do navegador — UMA única instância/contexto persistente para todo o
// worker; cada consulta abre sua própria aba dentro dele (nunca outro contexto).
//
// Dois modos, escolhidos por env.storageStatePath:
//
// 1) Perfil persistente (padrão, uso local/Windows): ATENÇÃO — este é um perfil
//    DEDICADO à automação (CREDPAGO_PROFILE_DIR), separado do Chrome pessoal do
//    usuário. NÃO abra essa mesma pasta manualmente em outra janela do Chrome
//    enquanto o worker estiver rodando: o Chrome trava o perfil com um lock de
//    processo único (mesmo headless) e um segundo processo usando a mesma pasta
//    falha ao iniciar (ou invalida a sessão do outro). Rode só um worker por vez.
//
// 2) Sessão portátil (uso em servidor/Linux, ex.: VPS): browser "normal" +
//    contexto novo carregado a partir de um storageState exportado por
//    exportSession.ts. Não usa perfil em disco — só cookies/localStorage.
// ---------------------------------------------------------------------------

interface ContextoAberto {
  context: BrowserContext;
  browser: Browser | null; // null no modo perfil persistente (context.close() já basta)
  persistirSessao: () => Promise<void>;
}

async function abrirContexto(): Promise<ContextoAberto> {
  if (env.storageStatePath) {
    log(`Usando sessão portátil: ${env.storageStatePath}`);
    const browser = await chromium.launch({ headless: env.headless });
    const context = await browser.newContext({
      storageState: env.storageStatePath,
      viewport: { width: 1366, height: 900 },
    });
    runtimeState.browser = "ok";
    return {
      context,
      browser,
      persistirSessao: async () => {
        await context.storageState({ path: env.storageStatePath }).catch((e) => {
          logErro("Falha ao salvar sessão atualizada", e);
        });
      },
    };
  }

  try {
    const context = await chromium.launchPersistentContext(env.profileDir, {
      headless: env.headless,
      viewport: { width: 1366, height: 900 },
    });
    runtimeState.browser = "ok";
    return { context, browser: null, persistirSessao: async () => {} };
  } catch (err) {
    runtimeState.browser = "unavailable";
    const msg = err instanceof Error ? err.message : String(err);
    if (/lock|already in use|singleton|profile.*use/i.test(msg)) {
      throw new Error(
        `Não foi possível abrir o perfil do Chrome em ${env.profileDir} — ele já está em uso por outro processo ` +
          `(outra execução do worker, ou uma janela do Chrome aberta manualmente nessa mesma pasta). ` +
          `Feche o outro processo/janela e rode o worker de novo. Detalhe técnico: ${msg}`,
      );
    }
    throw err;
  }
}

async function fecharContexto(contextoAberto: ContextoAberto): Promise<void> {
  await contextoAberto.persistirSessao();
  await contextoAberto.context.close().catch(() => {});
  if (contextoAberto.browser) await contextoAberto.browser.close().catch(() => {});
}

async function validarSuperficieCancelamento(
  context: BrowserContext,
  persistirSessao: () => Promise<void>,
): Promise<boolean> {
  if (!env.loftCancellationEnabled) return !env.loftCancellationRequired;
  if (Date.now() < proximaValidacaoCancelamentoEm) {
    return runtimeState.cancellationExecution === "ok";
  }

  if (env.loftCancellationMode === "api") {
    try {
      if (!loftCancellationClient) throw new Error("Cliente OAuth da Loft não configurado.");
      await loftCancellationClient.validateAuthentication();
      runtimeState.cancellationExecution = "ok";
      proximaValidacaoCancelamentoEm = Date.now() + env.authCheckIntervalMs;
      return true;
    } catch (error) {
      const firstFailure = runtimeState.cancellationExecution !== "unavailable";
      runtimeState.cancellationExecution = "unavailable";
      proximaValidacaoCancelamentoEm = Date.now() + env.authRetryIntervalMs;
      if (firstFailure) logErro("OAuth do cancelamento Loft não está pronto", error);
      return false;
    }
  }

  let page: Page | null = null;
  try {
    runtimeState.cancellationExecution = "checking";
    runtimeState.cancellationCheckStartedAt = new Date().toISOString();
    const validacao = (async () => {
      page = await context.newPage();
      await navegarParaPortal(page);
      await ensureLoggedIn("CANCEL", page, persistirSessao);
      await probeLoftProposalCancellationPortal(page, env.loftCancellationRequestTimeoutMs);
    })();
    await runWithRuntimeWatchdog(validacao, {
      timeoutMs: env.loftCancellationValidationTimeoutMs,
      message:
        `A validação da superfície de cancelamento excedeu ` +
        `${Math.round(env.loftCancellationValidationTimeoutMs / 1000)}s e foi abortada.`,
      abort: () => page?.close(),
    });
    await persistirSessao();
    ultimaAtividadeEm = Date.now();
    runtimeState.cancellationExecution = "ok";
    proximaValidacaoCancelamentoEm = Date.now() + env.authCheckIntervalMs;
    log("Superfície de cancelamento da Loft validada sem alterar propostas.");
    return true;
  } catch (error) {
    const firstFailure = runtimeState.cancellationExecution !== "unavailable";
    runtimeState.cancellationExecution = "unavailable";
    proximaValidacaoCancelamentoEm = Date.now() + env.authRetryIntervalMs;
    if (firstFailure) {
      logErro("A lista de propostas da Loft não está pronta para cancelamentos", error);
    }
    return false;
  } finally {
    runtimeState.cancellationCheckStartedAt = null;
    await page?.close().catch(() => {});
  }
}

/**
 * Servidor HTTP mínimo só para health check (ex.: Docker healthcheck, monitoramento
 * externo). Não expõe nenhuma rota de negócio, secret ou detalhe interno.
 */
function avaliarProntidaoRuntime(agora = Date.now()) {
  const authCheckAgeMs = runtimeState.authCheckStartedAt
    ? agora - Date.parse(runtimeState.authCheckStartedAt)
    : 0;
  const cancellationCheckAgeMs = runtimeState.cancellationCheckStartedAt
    ? agora - Date.parse(runtimeState.cancellationCheckStartedAt)
    : 0;
  const cancellationOperationAgeMs = runtimeState.cancellationOperationStartedAt
    ? agora - Date.parse(runtimeState.cancellationOperationStartedAt)
    : 0;
  const loopAgeMs = runtimeState.lastLoopAt ? agora - Date.parse(runtimeState.lastLoopAt) : 0;
  const authTravada = authCheckAgeMs > env.authValidationTimeoutMs + 15_000;
  const cancellationCheckTravada =
    cancellationCheckAgeMs > env.loftCancellationValidationTimeoutMs + 15_000;
  const cancellationOperationTravada =
    cancellationOperationAgeMs > env.loftCancellationOperationTimeoutMs + 15_000;
  const loopTravado =
    loopAgeMs >
    Math.max(
      env.authValidationTimeoutMs + 30_000,
      env.loftCancellationValidationTimeoutMs + 30_000,
      env.loftCancellationOperationTimeoutMs + 30_000,
      env.pollIntervalMs * 12,
    );
  const healthy =
    !authTravada &&
    !cancellationCheckTravada &&
    !cancellationOperationTravada &&
    !loopTravado &&
    runtimeState.browser !== "unavailable";
  const cancellationReady =
    !env.loftCancellationRequired ||
    (env.loftCancellationEnabled &&
      runtimeState.cancellationQueue === "ok" &&
      runtimeState.cancellationExecution === "ok");
  const ready =
    healthy &&
    runtimeState.auth === "ok" &&
    runtimeState.queue === "ok" &&
    runtimeState.browser === "ok" &&
    cancellationReady;
  return {
    authTravada,
    cancellationCheckTravada,
    cancellationOperationTravada,
    loopTravado,
    healthy,
    cancellationReady,
    ready,
  };
}

function iniciarServidorHealth(): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      const {
        healthy,
        cancellationCheckTravada,
        cancellationOperationTravada,
        cancellationReady,
        ready,
      } = avaliarProntidaoRuntime();

      res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: healthy ? "ok" : "stalled",
          ready,
          auth: runtimeState.auth,
          queue: runtimeState.queue,
          lastAuthCheckAt: runtimeState.lastAuthCheckAt,
          lastAuthSuccessAt: runtimeState.lastAuthSuccessAt,
          lastLoopAt: runtimeState.lastLoopAt,
          consecutiveAuthFailures: runtimeState.consecutiveAuthFailures,
          browserRestarts: runtimeState.browserRestarts,
          lastQueueSuccessAt: runtimeState.lastQueueSuccessAt,
          lastQueueErrorAt: runtimeState.lastQueueErrorAt,
          consecutiveQueueFailures: runtimeState.consecutiveQueueFailures,
          browser: runtimeState.browser,
          activeConsultations: runtimeState.activeConsultations,
          totalProcessed: runtimeState.totalProcessed,
          totalFailed: runtimeState.totalFailed,
          lastSuccessfulSimulationAt: runtimeState.lastSuccessfulSimulationAt,
          averageDurationMs: runtimeState.averageDurationMs,
          queueDepth: runtimeState.queueDepth,
          retryingConsultations: runtimeState.retryingConsultations,
          requiresVerification: runtimeState.requiresVerification,
          expiredLeases: runtimeState.expiredLeases,
          oldestQueueAgeSeconds: runtimeState.oldestQueueAgeSeconds,
          providerConsecutiveFailures: runtimeState.providerConsecutiveFailures,
          circuitOpen: runtimeState.circuitOpen,
          circuitOpenUntil: runtimeState.circuitOpenUntil,
          cancellationEnabled: env.loftCancellationEnabled,
          cancellationRequired: env.loftCancellationRequired,
          cancellationMode: env.loftCancellationMode,
          cancellationQueue: runtimeState.cancellationQueue,
          cancellationExecution: runtimeState.cancellationExecution,
          cancellationCheckStartedAt: runtimeState.cancellationCheckStartedAt,
          cancellationCheckStalled: cancellationCheckTravada,
          cancellationOperationStartedAt: runtimeState.cancellationOperationStartedAt,
          cancellationOperationStalled: cancellationOperationTravada,
          cancellationReady,
          lastCancellationQueueSuccessAt: runtimeState.lastCancellationQueueSuccessAt,
          lastCancellationQueueErrorAt: runtimeState.lastCancellationQueueErrorAt,
          consecutiveCancellationQueueFailures: runtimeState.consecutiveCancellationQueueFailures,
          activeCancellation: runtimeState.activeCancellation,
          totalCancellations: runtimeState.totalCancellations,
          totalCancellationFailures: runtimeState.totalCancellationFailures,
          lastSuccessfulCancellationAt: runtimeState.lastSuccessfulCancellationAt,
          configuredConcurrency: env.requestedMaxConcurrentConsultas,
          effectiveConcurrency: env.maxConcurrentConsultas,
          automationVersion: env.automationVersion,
        }),
      );
      return;
    }
    if (req.method === "GET" && req.url === "/ready") {
      const { cancellationCheckTravada, cancellationOperationTravada, cancellationReady, ready } =
        avaliarProntidaoRuntime();
      res.writeHead(ready ? 200 : 503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: ready ? "ready" : "not_ready",
          auth: runtimeState.auth,
          queue: runtimeState.queue,
          browser: runtimeState.browser,
          cancellationEnabled: env.loftCancellationEnabled,
          cancellationRequired: env.loftCancellationRequired,
          cancellationMode: env.loftCancellationMode,
          cancellationQueue: runtimeState.cancellationQueue,
          cancellationExecution: runtimeState.cancellationExecution,
          cancellationCheckStartedAt: runtimeState.cancellationCheckStartedAt,
          cancellationCheckStalled: cancellationCheckTravada,
          cancellationOperationStartedAt: runtimeState.cancellationOperationStartedAt,
          cancellationOperationStalled: cancellationOperationTravada,
          cancellationReady,
          lastCancellationQueueSuccessAt: runtimeState.lastCancellationQueueSuccessAt,
          lastCancellationQueueErrorAt: runtimeState.lastCancellationQueueErrorAt,
          consecutiveCancellationQueueFailures: runtimeState.consecutiveCancellationQueueFailures,
        }),
      );
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "not_found" }));
  });
  server.listen(env.healthPort, "0.0.0.0", () => {
    log(
      `Servidor de health check ouvindo em 0.0.0.0:${env.healthPort}/health (prontidão em /ready)`,
    );
  });
  return server;
}

async function loop(once: boolean): Promise<void> {
  const origemSessao = env.storageStatePath
    ? `sessão portátil (${env.storageStatePath})`
    : `perfil persistente (${env.profileDir})`;
  log(`Worker CredPago iniciado. Origem da sessão: ${origemSessao}`);
  log(
    `Limite de consultas simultâneas: ${env.maxConcurrentConsultas} | timeout por consulta: ${env.consultaTimeoutMs}ms`,
  );
  if (env.requestedMaxConcurrentConsultas !== env.maxConcurrentConsultas) {
    log(
      `MAX_CONCURRENT_CONSULTAS=${env.requestedMaxConcurrentConsultas} foi reduzido para ${env.maxConcurrentConsultas}: o portal compartilha o estado da análise entre abas da mesma sessão.`,
    );
  }
  log(
    `Autenticação preventiva a cada ${env.authCheckIntervalMs}ms | renovação automática: ${
      env.credpagoLogin ? "configurada" : "não configurada"
    }`,
  );
  log(
    `Cancelamento de propostas após ${Math.round(env.loftCancellationDelayMs / 60000)}min: ${
      env.loftCancellationEnabled
        ? `habilitado via ${env.loftCancellationMode} com preferência de motivo${
            env.loftCancellationRequired ? " e obrigatório para a prontidão" : ""
          }`
        : `desabilitado${env.loftCancellationRequired ? " (o worker permanecerá não pronto)" : ""}`
    }`,
  );
  let lock: AutomationLockHandle | null = null;
  lock = await acquireAutomationLock(
    env.automationLockPath,
    env.storageStatePath ? "portable-session" : "persistent-profile",
  );
  log(`Mutex adquirido em ${lock.path}.`);
  let contextoAberto = await abrirContexto();
  log(`Chrome iniciado em modo ${env.headless ? "headless (invisível)" : "visível"}`);

  const healthServer = once ? null : iniciarServidorHealth();

  const emAndamento = new Map<string, Promise<void>>();
  let cancelamentoEmAndamento: Promise<void> | null = null;
  let desligando = false;

  const finalizarWorker = async () => {
    if (healthServer) await new Promise((resolve) => healthServer.close(resolve));
    if (!env.keepBrowserOpen) {
      await fecharContexto(contextoAberto);
    } else {
      log("AUTOMATION_KEEP_BROWSER_OPEN=true — Chrome permanece aberto.");
    }
    runtimeState.browser = "unavailable";
    await lock?.release();
  };

  const handleSigint = async () => {
    if (desligando) return;
    desligando = true;
    log(
      `Encerrando worker — aguardando ${emAndamento.size} consulta(s) em andamento terminar(em)...`,
    );
    await Promise.allSettled([
      ...Array.from(emAndamento.values()),
      ...(cancelamentoEmAndamento ? [cancelamentoEmAndamento] : []),
    ]);
    await finalizarWorker();
    process.exit(0);
  };
  process.once("SIGINT", handleSigint);
  process.once("SIGTERM", handleSigint);

  // No modo sessão portátil, salva o estado atualizado periodicamente — a CredPago
  // pode rotacionar/renovar cookies durante o uso, e sem isso o worker voltaria a
  // depender só da sessão exportada no dia da migração (que eventualmente expira).
  const persistTimer =
    !once && env.storageStatePath
      ? setInterval(() => void contextoAberto.persistirSessao(), 15 * 60 * 1000)
      : null;

  try {
    for (;;) {
      if (desligando) break;
      runtimeState.lastLoopAt = new Date().toISOString();

      await atualizarMetricasFila().catch((error) =>
        registrarFalhaFila("Falha ao atualizar métricas da fila persistente", error),
      );

      // A sessão da Loft guarda estado mutável da proposta no BrowserContext.
      // Enquanto uma simulação está ativa, nem o probe de autenticação nem a
      // reconciliação/cancelamento podem abrir outra página nesse contexto.
      if (emAndamento.size > 0) {
        await sleep(env.pollIntervalMs);
        continue;
      }

      // Autenticação vem antes da fila de cancelamentos. Se a sessão expirar,
      // a própria rotina de recuperação precisa rodar antes de qualquer acesso
      // à lista de propostas; caso contrário um job ambíguo cria um deadlock.
      const autenticacaoPronta = await validarAutenticacao(
        contextoAberto.context,
        contextoAberto.persistirSessao,
      );
      if (!autenticacaoPronta) {
        const contaBloqueada = runtimeState.auth === "blocked";
        await sinalizarFilaAguardandoServico("aguardando_liberacao_parceiro").catch((error) =>
          registrarFalhaFila("Falha ao sinalizar fila aguardando disponibilidade", error),
        );
        if (once) {
          log("Autenticação indisponível — nenhuma consulta foi retirada da fila.");
          break;
        }

        if (
          emAndamento.size === 0 &&
          !contaBloqueada &&
          runtimeState.consecutiveAuthFailures >= env.authFailuresBeforeBrowserRestart
        ) {
          log(
            `Reiniciando navegador após ${runtimeState.consecutiveAuthFailures} falha(s) consecutiva(s) de autenticação.`,
          );
          try {
            await fecharContexto(contextoAberto);
            loginEmAndamento = null;
            contextoAberto = await abrirContexto();
            runtimeState.browserRestarts += 1;
            runtimeState.consecutiveAuthFailures = 0;
            runtimeState.auth = "checking";
            proximaValidacaoAuthEm = 0;
          } catch (error) {
            runtimeState.auth = "unavailable";
            proximaValidacaoAuthEm = Date.now() + env.authRetryIntervalMs;
            logErro("Falha ao reiniciar o navegador; nova tentativa será feita", error);
          }
        }

        await sleep(env.pollIntervalMs);
        continue;
      }

      // O modo portal usa o mesmo BrowserContext da simulação. Só inicia um
      // cancelamento quando nenhuma consulta está usando a sessão e não retira
      // novas consultas enquanto a tela de propostas estiver em uso.
      let reconciliacaoCancelamentoPendente = false;
      if (env.loftCancellationEnabled && !cancelamentoEmAndamento && emAndamento.size === 0) {
        runtimeState.activeCancellation = true;
        try {
          // A RPC sempre prioriza jobs com ID exato cujo prazo venceu. Chamá-la
          // antes da reconciliação impede que um envio mais novo, ainda sem ID,
          // adie o cancelamento seguro de uma proposta anterior. Quando não há
          // job vencido, o sinal 55000 apenas transfere o controle ao reconciliador.
          let job: LoftCancellationJob | null = null;
          let exigeReconciliacao = false;
          try {
            job = await claimNextLoftCancellation();
          } catch (error) {
            if (!isPendingLoftReconciliationError(error)) throw error;
            exigeReconciliacao = true;
          }

          if (job) {
            runtimeState.activeCancellation = true;
            const task = processLoftCancellation(
              job,
              contextoAberto.context,
              contextoAberto.persistirSessao,
            ).finally(() => {
              if (cancelamentoEmAndamento === task) cancelamentoEmAndamento = null;
              runtimeState.activeCancellation = false;
            });
            cancelamentoEmAndamento = task;
          } else {
            const encontrouReconciliacao = await reconcilePendingLoftCancellation(
              contextoAberto.context,
              contextoAberto.persistirSessao,
            );
            reconciliacaoCancelamentoPendente = exigeReconciliacao || encontrouReconciliacao;
          }
        } catch (error) {
          // Falha fechada: qualquer erro neste bloco impede uma nova proposta
          // até a próxima passagem confirmar a fila e a identidade causal.
          reconciliacaoCancelamentoPendente = true;
          if (error instanceof LoftCancellationQueueError) {
            registrarFalhaFilaCancelamento("Falha ao consultar a fila de cancelamentos", error);
          } else {
            runtimeState.cancellationExecution = "unavailable";
            proximaValidacaoCancelamentoEm = 0;
            logErro("Falha ao reconciliar um cancelamento pendente", error);
          }
        } finally {
          if (!cancelamentoEmAndamento) runtimeState.activeCancellation = false;
        }
      }

      if (cancelamentoEmAndamento) {
        if (once) await Promise.allSettled([cancelamentoEmAndamento]);
        else await sleep(env.pollIntervalMs);
        continue;
      }

      // Enquanto um envio sem ID exato ainda está sendo reconciliado, não cria
      // novas propostas para o mesmo portal. Isso preserva a causalidade sem
      // transformar a espera normal em falha da fila do Supabase.
      if (reconciliacaoCancelamentoPendente) {
        if (once) {
          log("Reconciliação de cancelamento pendente — nenhuma consulta nova foi enviada.");
          break;
        }
        await sleep(env.pollIntervalMs);
        continue;
      }

      const filaCancelamentoOperacional = !env.loftCancellationEnabled
        ? !env.loftCancellationRequired
        : runtimeState.cancellationQueue === "ok";
      if (!filaCancelamentoOperacional) {
        if (once) {
          log("Fila obrigatória de cancelamentos indisponível — nenhuma consulta foi enviada.");
          break;
        }
        await sleep(env.pollIntervalMs);
        continue;
      }

      const superficieCancelamentoPronta = await validarSuperficieCancelamento(
        contextoAberto.context,
        contextoAberto.persistirSessao,
      );
      const cancelamentoOperacional = !env.loftCancellationEnabled
        ? !env.loftCancellationRequired
        : runtimeState.cancellationQueue === "ok" &&
          runtimeState.cancellationExecution === "ok" &&
          superficieCancelamentoPronta;
      if (!cancelamentoOperacional) {
        if (once) {
          log(
            "Superfície obrigatória de cancelamento indisponível — nenhuma consulta foi enviada.",
          );
          break;
        }
        await sleep(env.pollIntervalMs);
        continue;
      }

      const vagas = env.maxConcurrentConsultas - emAndamento.size;
      if (vagas > 0) {
        for (let slot = 0; slot < vagas; slot += 1) {
          if (emAndamento.size >= env.maxConcurrentConsultas) break;
          let consulta: ConsultaCreditoRow | null = null;
          try {
            consulta = await claimNextConsulta();
          } catch (error) {
            registrarFalhaFila("Falha ao reivindicar a próxima consulta no Supabase", error);
            break;
          }
          if (!consulta) break;

          const contextoDaConsulta = contextoAberto;
          const tarefa = processarConsultaComTimeout(
            contextoDaConsulta.context,
            consulta,
            contextoDaConsulta.persistirSessao,
          )
            .catch((e) => logErro(`Falha não tratada na consulta ${consulta.id}`, e))
            .finally(() => {
              emAndamento.delete(consulta.id);
              runtimeState.activeConsultations = emAndamento.size;
            });
          emAndamento.set(consulta.id, tarefa);
          runtimeState.activeConsultations = emAndamento.size;
        }
      }

      if (once) {
        if (emAndamento.size === 0) {
          if (cancelamentoEmAndamento) await Promise.allSettled([cancelamentoEmAndamento]);
          log("Nenhuma consulta pendente encontrada.");
          break;
        }
        // Modo --once: processa tudo que couber no limite de concorrência e espera terminar.
        await Promise.allSettled(Array.from(emAndamento.values()));
        break;
      }

      await new Promise((r) => setTimeout(r, env.pollIntervalMs));
    }
  } finally {
    if (persistTimer) clearInterval(persistTimer);
    process.removeListener("SIGINT", handleSigint);
    process.removeListener("SIGTERM", handleSigint);
    if (!desligando) {
      await Promise.allSettled([
        ...Array.from(emAndamento.values()),
        ...(cancelamentoEmAndamento ? [cancelamentoEmAndamento] : []),
      ]);
      await finalizarWorker();
    }
  }
}

const once = process.argv.includes("--once");
loop(once).catch((err) => {
  logErro("Worker encerrado com erro fatal", err);
  const correlationId = createCorrelationId("SYS");
  void reportAutomationError({
    correlationId,
    environment: env.automationEnvironment,
    service: "credit-worker",
    step: "bootstrap",
    error: err,
    metadata: { fatal: true },
  }).finally(() => process.exit(1));
});
