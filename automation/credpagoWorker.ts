import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
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
  isCaptchaPresent,
  loginWithCredentials,
  detectAuthenticationState,
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

/**
 * Traduz qualquer falha interna (Playwright, rede, timeout) para uma mensagem segura,
 * sem jargão técnico nem menção ao nome do parceiro de crédito — é isso que o corretor
 * vê no NOX FINANÇA quando a automação não consegue concluir a consulta.
 */
function mensagemSeguraParaErro(erroTecnico: string): string {
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

class ConsultaStateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsultaStateConflictError";
  }
}

type AuthRuntimeStatus = "checking" | "ok" | "required" | "unavailable";
type QueueRuntimeStatus = "checking" | "ok" | "unavailable";
type BrowserRuntimeStatus = "checking" | "ok" | "unavailable";

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
  browser: BrowserRuntimeStatus;
  activeConsultations: number;
  totalProcessed: number;
  totalFailed: number;
  lastSuccessfulSimulationAt: string | null;
  averageDurationMs: number | null;
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
  browser: "checking",
  activeConsultations: 0,
  totalProcessed: 0,
  totalFailed: 0,
  lastSuccessfulSimulationAt: null,
  averageDurationMs: null,
};

const recentDurations: number[] = [];

let proximaValidacaoAuthEm = 0;
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
        log("Sessão expirada — renovando automaticamente pelo Login Loft.");
        await loginWithCredentials(
          page,
          env.credpagoLogin,
          env.credpagoPassword,
          env.authLoginTimeoutMs,
        );
        await persistirSessao();
        log("Login Loft renovado e sessão persistida.");
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
            ? `Não foi possível renovar o Login Loft: ${error.message}`
            : "Não foi possível renovar o Login Loft.",
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
const SESSAO_OCIOSA_MS = 3 * 60 * 1000; // 3 minutos

// ---------------------------------------------------------------------------
// Fila / persistência
// ---------------------------------------------------------------------------

async function fetchConsultasPendentes(limite: number): Promise<ConsultaCreditoRow[]> {
  if (limite <= 0) return [];
  const { data, error } = await supabaseAdmin
    .from("consultas_credito")
    .select(
      "id, correlation_id, profile_id_solicitante, created_at, tipo_pessoa, documento, documento_masked, tipo_imovel, cep, valor_aluguel, valor_condominio, valor_taxas, status",
    )
    .eq("status", "pendente")
    .eq("origem", "nox_financa")
    .order("created_at", { ascending: true })
    .limit(limite);
  if (error) throw error;
  registrarSucessoFila();
  return (data as ConsultaCreditoRow[]) || [];
}

/** Atualização condicional (status ainda 'pendente') evita que duas execuções peguem a mesma consulta. */
async function marcarProcessando(id: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("consultas_credito")
    .update({
      status: "processando",
      automation_step: "abrindo",
      automation_started_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pendente")
    .select("id");
  if (error) throw error;
  registrarSucessoFila();
  return Array.isArray(data) && data.length > 0;
}

/**
 * Grava a etapa atual para a barra de progresso do modal "Consultando crédito"
 * no frontend (Realtime já escuta UPDATEs desta tabela). Falha aqui nunca deve
 * derrubar a consulta — é só um indicador visual, não parte do resultado.
 */
async function atualizarStep(
  id: string,
  step: "abrindo" | "preenchendo" | "enviando" | "aguardando_resultado",
): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from("consultas_credito")
      .update({ automation_step: step })
      .eq("id", id)
      .eq("status", "processando");
    if (error) throw error;
    registrarSucessoFila();
  } catch (error) {
    registrarFalhaFila("Falha ao atualizar o progresso visual da consulta", error);
    // indicador visual apenas — nunca deve derrubar a consulta
  }
}

async function atualizarResultado(
  id: string,
  resultado: {
    status: "aprovado" | "recusado" | "em_analise" | "erro";
    mensagem: string;
    rawSummary: unknown;
    clienteNome?: string | null;
    clienteDocumento?: string | null;
  },
): Promise<void> {
  const payload: Record<string, unknown> = {
    status: resultado.status,
    resultado: resultado.status,
    mensagem: resultado.mensagem,
    error_message: resultado.status === "erro" ? resultado.mensagem : null,
    raw_response: resultado.rawSummary as any,
    automacao_origem: "automacao_local",
    automation_step: null,
    automation_finished_at: new Date().toISOString(),
  };

  // A CredPago retorna o nome/documento cadastrado para o CPF/CNPJ consultado — usamos
  // isso para corrigir o nome do cliente na consulta (o formulário da Nova Consulta só
  // coleta o documento, não o nome, então sem isso a lista mostraria o CPF como nome).
  if (resultado.clienteNome) payload.tenant_name = resultado.clienteNome;
  if (resultado.clienteDocumento) {
    payload.documento = resultado.clienteDocumento;
    payload.documento_masked = maskDocumento(resultado.clienteDocumento);
  }

  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= 5; tentativa += 1) {
    try {
      const { data, error } = await supabaseAdmin
        .from("consultas_credito")
        .update(payload)
        .eq("id", id)
        .eq("status", "processando")
        .select("id");
      if (error) throw error;
      if (!data?.length) {
        throw new ConsultaStateConflictError(
          "A consulta não estava mais em processamento ao salvar o resultado.",
        );
      }
      registrarSucessoFila();
      return;
    } catch (error) {
      if (error instanceof ConsultaStateConflictError) throw error;
      ultimoErro = error;
      registrarFalhaFila(
        `Falha ao salvar resultado da consulta (tentativa ${tentativa}/5)`,
        error,
      );
      if (tentativa < 5) await sleep(Math.min(1_000 * 2 ** (tentativa - 1), 8_000));
    }
  }
  throw ultimoErro;
}

async function marcarErro(id: string, erroTecnico: string): Promise<void> {
  const mensagemSegura = mensagemSeguraParaErro(erroTecnico);
  const classified = classifyAutomationError(erroTecnico);
  await atualizarResultado(id, {
    status: "erro",
    mensagem: mensagemSegura,
    rawSummary: {
      erroTecnico: redactSensitiveText(erroTecnico, 2_000),
      categoria: classified.category,
      capturadoEm: new Date().toISOString(),
    },
  });
}

/**
 * Falha de autenticação não é falha de crédito. Preserva a consulta na fila para
 * retomá-la automaticamente depois que a sessão for recuperada, em vez de mostrar
 * erro ao corretor no site ou no aplicativo.
 */
async function recolocarNaFilaAguardandoServico(id: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("consultas_credito")
    .update({
      status: "pendente",
      resultado: null,
      mensagem: null,
      error_message: null,
      automation_started_at: null,
      automation_finished_at: null,
      automation_step: "aguardando_autenticacao",
    })
    .eq("id", id)
    .eq("status", "processando");
  if (error) throw error;
  registrarSucessoFila();
}

/**
 * Se o processo/container cair depois do claim, a linha ficava eternamente em
 * "processando" e nenhum worker voltava a enxergá-la. Este lease temporal devolve
 * somente consultas antigas à fila; consultas ativas ficam protegidas pelo corte.
 */
async function recuperarConsultasTravadas(idsEmAndamento: ReadonlySet<string>): Promise<void> {
  const agora = Date.now();
  if (agora - ultimaRecuperacaoConsultasEm < env.staleRecoveryIntervalMs) return;
  ultimaRecuperacaoConsultasEm = agora;

  const cutoff = new Date(agora - env.staleConsultaMs).toISOString();
  let query = supabaseAdmin
    .from("consultas_credito")
    .update({
      status: "pendente",
      resultado: null,
      mensagem: null,
      error_message: null,
      automation_started_at: null,
      automation_finished_at: null,
      automation_step: "recuperada_automaticamente",
    })
    .eq("status", "processando")
    .eq("origem", "nox_financa")
    .lt("automation_started_at", cutoff);

  // A própria instância conhece suas abas ativas. Isso evita reencaminhar uma
  // resposta lenta enquanto ela está sendo persistida no banco.
  if (idsEmAndamento.size > 0) {
    query = query.not("id", "in", `(${Array.from(idsEmAndamento).join(",")})`);
  }
  const { data, error } = await query.select("id");

  if (error) throw error;
  registrarSucessoFila();
  if (data?.length) {
    log(`${data.length} consulta(s) interrompida(s) recuperada(s) automaticamente para a fila.`);
  }
}

/**
 * Expõe aos clientes que a fila está pausada por autenticação. Sem esta etapa,
 * uma consulta nova permanecia como "pendente" sem qualquer indicação enquanto
 * o worker tentava recuperar a sessão do parceiro.
 */
async function sinalizarFilaAguardandoAutenticacao(): Promise<void> {
  const agora = Date.now();
  if (agora - ultimaSinalizacaoAuthNaFilaEm < env.authRetryIntervalMs) return;
  ultimaSinalizacaoAuthNaFilaEm = agora;

  const { data, error } = await supabaseAdmin
    .from("consultas_credito")
    .update({ automation_step: "aguardando_autenticacao" })
    .eq("status", "pendente")
    .eq("origem", "nox_financa")
    .select("id");

  if (error) throw error;
  registrarSucessoFila();
  if (data?.length) {
    log(`${data.length} consulta(s) aguardando a recuperação da autenticação.`);
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

      if ((await detectAuthenticationState(page!)) !== "authenticated") {
        throw new CredPagoAuthenticationError("A sessão ainda redireciona para o Login Loft.");
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
    runtimeState.auth = isAuthError ? "required" : "unavailable";
    runtimeState.consecutiveAuthFailures += 1;
    proximaValidacaoAuthEm = Date.now() + env.authRetryIntervalMs;
    if (statusAnterior !== runtimeState.auth) {
      logErro(
        isAuthError
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

    // O login costuma redirecionar para o dashboard em vez de voltar à página de origem —
    // garante que esta aba termine na tela de simulação antes de preencher os dados.
    if (!page.url().includes("/imobiliaria/proposta")) {
      await navegarParaPortal(page);
    }

    if (await isCaptchaPresent(page)) {
      throw new Error(
        "A CredPago exibiu um captcha. A automação não tenta resolver captchas — resolva manualmente e reenvie a consulta.",
      );
    }

    log(`[${cid}] Preenchendo dados`);
    await atualizarStep(consulta.id, "preenchendo");
    await fillPessoa(page, consulta.tipo_pessoa || "PF");
    await fillDocumento(page, consulta.documento || "", consulta.tipo_pessoa || "PF");
    await fillTipoImovel(
      page,
      (consulta.tipo_imovel as "Residencial" | "Comercial") || "Residencial",
    );
    await fillCep(page, consulta.cep || "");
    // A CredPago avalia o crédito com base no que é digitado no campo "Aluguel"
    // do formulário dela — por isso a análise deve considerar o compromisso
    // mensal total do inquilino (aluguel + condomínio + taxas), não só o
    // aluguel isolado. Soma tudo e preenche só o campo Aluguel com o total;
    // Condomínio/Taxas ficam vazios lá para não contar o mesmo valor duas vezes
    // (a base do site já guarda os três valores separados normalmente — isso
    // só muda o que é enviado para a CredPago, não o que fica salvo na consulta).
    const valorTotalParaAnaliseCredito =
      (Number(consulta.valor_aluguel) || 0) +
      (Number(consulta.valor_condominio) || 0) +
      (Number(consulta.valor_taxas) || 0);
    await fillValores(page, {
      aluguel: valorTotalParaAnaliseCredito,
      condominio: 0,
      taxas: 0,
    });
    estado.lastSuccessfulStep = "form-filled";

    log(`[${cid}] Enviando simulação`);
    await atualizarStep(consulta.id, "enviando");
    // A partir daqui assumimos que o clique pode ter chegado ao parceiro mesmo se
    // o Playwright perder a conexão durante a resposta. Não reenfileiramos
    // automaticamente esse caso para não criar uma simulação duplicada.
    simulacaoEnviada = true;
    estado.simulationSubmitted = true;
    await submitSimulation(page);
    estado.lastSuccessfulStep = "simulation-submitted";

    log(`[${cid}] Aguardando resultado`);
    await atualizarStep(consulta.id, "aguardando_resultado");
    const resultPage = page;
    const resultado = await parseResultado(page, {
      onLog: (msg) => log(`[${cid}] ${msg}`),
      // Causa raiz observada em produção: o clique em "Simular Crédito" às vezes não
      // registra (nada na página muda por dezenas de segundos). Reenviar o mesmo clique
      // resolve sem precisar preencher tudo de novo — só reclicamos quando a página está
      // 100% parada (ver heurística em parseResultado), nunca durante progresso real.
      onRetryClick: () => submitSimulation(resultPage),
    });
    resultadoObtido = true;
    estado.lastSuccessfulStep = "result-read";
    log(`[${cid}] Resultado identificado: ${resultado.status}`);

    if (estado.finalizado) {
      log(
        `[${cid}] Resultado chegou após o tempo limite já ter marcado erro — descartando para não sobrescrever.`,
      );
      return;
    }
    estado.persistindoResultado = true;
    try {
      await atualizarResultado(consulta.id, resultado);
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
    if (resultado.status !== "erro") runtimeState.lastSuccessfulSimulationAt = new Date().toISOString();
    if (resultado.status === "erro") {
      runtimeState.totalFailed += 1;
      await reportAutomationError({
        correlationId,
        simulationId: consulta.id,
        initiatingUserId: consulta.profile_id_solicitante,
        environment: env.automationEnvironment,
        step: "aguardando_resultado",
        lastSuccessfulStep: estado.lastSuccessfulStep,
        error: new Error(resultado.mensagem),
        durationMs,
        artifacts: await captureSafeErrorArtifacts(page, true),
      });
    }
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
        isTransientPortalError(err));
    estado.finalizado = true;
    if (falhaTemporariaAntesDoEnvio) {
      const falhaDeAutenticacao = err instanceof CredPagoAuthenticationError;
      runtimeState.auth = falhaDeAutenticacao ? "required" : "unavailable";
      runtimeState.lastAuthCheckAt = new Date().toISOString();
      runtimeState.consecutiveAuthFailures += 1;
      proximaValidacaoAuthEm = 0;
      const artifacts = await captureSafeErrorArtifacts(page, false);
      const returnedToQueue = await recolocarNaFilaAguardandoServico(consulta.id)
        .then(() => {
          log(`[${cid}] Consulta preservada na fila enquanto o serviço é recuperado.`);
          return true;
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
      const persisted = await marcarErro(consulta.id, erroTecnico)
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
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  let timeoutAtingido = false;
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
          setTimeout(() => resolve({ screenshotSkippedReason: "Captura excedeu o prazo seguro." }), 2_000),
        ),
      ]);
      // Interrompe de verdade a aba desta consulta. Antes, o trabalho continuava em
      // segundo plano e um retry podia enviar a mesma simulação duas vezes.
      await estado.page?.close().catch(() => {});
      await marcarErro(
        consulta.id,
        timeoutError.message,
      ).catch((e) => logErro(`[${cid}] Falha ao gravar erro de timeout no Supabase`, e));
      runtimeState.totalProcessed += 1;
      runtimeState.totalFailed += 1;
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

  const trabalho = processarConsulta(context, consulta, estado, persistirSessao).finally(() =>
    clearTimeout(timer),
  );

  await Promise.race([trabalho, timeoutPromise]);
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

/**
 * Servidor HTTP mínimo só para health check (ex.: Docker healthcheck, monitoramento
 * externo). Não expõe nenhuma rota de negócio, secret ou detalhe interno.
 */
function iniciarServidorHealth(): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      const agora = Date.now();
      const authCheckAgeMs = runtimeState.authCheckStartedAt
        ? agora - Date.parse(runtimeState.authCheckStartedAt)
        : 0;
      const loopAgeMs = runtimeState.lastLoopAt ? agora - Date.parse(runtimeState.lastLoopAt) : 0;
      const authTravada = authCheckAgeMs > env.authValidationTimeoutMs + 15_000;
      const loopTravado =
        loopAgeMs > Math.max(env.authValidationTimeoutMs + 30_000, env.pollIntervalMs * 12);
      const healthy = !authTravada && !loopTravado && runtimeState.browser !== "unavailable";
      const ready = runtimeState.auth === "ok" && runtimeState.queue === "ok";
      const browserReady = runtimeState.browser === "ok";
      const fullyReady = ready && browserReady;

      res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: healthy ? "ok" : "stalled",
          ready: fullyReady,
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
          automationVersion: env.automationVersion,
        }),
      );
      return;
    }
    if (req.method === "GET" && req.url === "/ready") {
      const ready =
        runtimeState.auth === "ok" && runtimeState.queue === "ok" && runtimeState.browser === "ok";
      res.writeHead(ready ? 200 : 503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: ready ? "ready" : "not_ready",
          auth: runtimeState.auth,
          queue: runtimeState.queue,
          browser: runtimeState.browser,
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
  log(
    `Autenticação preventiva a cada ${env.authCheckIntervalMs}ms | renovação automática: ${
      env.credpagoLogin ? "configurada" : "não configurada"
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
    await Promise.allSettled(Array.from(emAndamento.values()));
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

      await recuperarConsultasTravadas(new Set(emAndamento.keys())).catch((error) =>
        registrarFalhaFila("Falha ao recuperar consultas interrompidas", error),
      );

      const autenticacaoPronta = await validarAutenticacao(
        contextoAberto.context,
        contextoAberto.persistirSessao,
      );
      if (!autenticacaoPronta) {
        await sinalizarFilaAguardandoAutenticacao().catch((error) =>
          registrarFalhaFila("Falha ao sinalizar fila aguardando autenticação", error),
        );
        if (once) {
          log("Autenticação indisponível — nenhuma consulta foi retirada da fila.");
          break;
        }

        if (
          emAndamento.size === 0 &&
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

        await new Promise((r) => setTimeout(r, env.pollIntervalMs));
        continue;
      }

      const vagas = env.maxConcurrentConsultas - emAndamento.size;
      if (vagas > 0) {
        let pendentes: ConsultaCreditoRow[] = [];
        try {
          pendentes = await fetchConsultasPendentes(vagas);
        } catch (error) {
          registrarFalhaFila("Falha ao consultar a fila do Supabase", error);
          if (once) break;
          await sleep(env.pollIntervalMs);
          continue;
        }
        for (const consulta of pendentes) {
          if (emAndamento.size >= env.maxConcurrentConsultas) break;

          let reservou = false;
          try {
            reservou = await marcarProcessando(consulta.id);
          } catch (error) {
            registrarFalhaFila(
              `Falha ao reservar a consulta ${consulta.id.slice(0, 8)} na fila`,
              error,
            );
            break;
          }
          if (!reservou) continue; // outra execução pegou essa consulta primeiro

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
      await Promise.allSettled(Array.from(emAndamento.values()));
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
