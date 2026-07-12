import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import http from "node:http";
import { env } from "./env";
import { supabaseAdmin } from "./supabaseAdmin";
import { log, logErro, maskDocumento } from "./logger";
import {
  fillPessoa,
  fillDocumento,
  fillTipoImovel,
  fillCep,
  fillValores,
  submitSimulation,
  isLoginPage,
  isCaptchaPresent,
} from "./credpagoSelectors";
import { parseResultado } from "./credpagoParser";
import type { ConsultaCreditoRow } from "./types";

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
// Login manual compartilhado entre consultas concorrentes.
// Várias abas podem detectar "não logado" ao mesmo tempo (ex.: perfil novo +
// 3 consultas simultâneas) — todas compartilham cookies do mesmo contexto, então
// só uma pergunta de login deve aparecer no terminal; as demais abas só esperam
// essa mesma promise e depois recarregam para herdar a sessão recém-autenticada.
// ---------------------------------------------------------------------------
let loginEmAndamento: Promise<void> | null = null;

async function solicitarLoginManual(): Promise<void> {
  log("Tela de login detectada na CredPago.");
  log("Faça login manualmente na CredPago. Depois pressione Enter para continuar.");
  const rl = readline.createInterface({ input: stdin, output: stdout });
  await rl.question("");
  rl.close();
}

async function ensureLoggedIn(cid: string, page: Page): Promise<void> {
  if (!(await isLoginPage(page))) return;

  if (env.headless) {
    throw new Error(
      "Login necessário, mas o worker está em modo headless. Rode uma vez com HEADLESS=false para logar manualmente.",
    );
  }

  if (!loginEmAndamento) {
    loginEmAndamento = solicitarLoginManual().finally(() => {
      loginEmAndamento = null;
    });
  } else {
    log(`[${cid}] Login já solicitado por outra consulta — aguardando confirmação...`);
  }

  await loginEmAndamento;

  // O login pode ter sido feito em OUTRA aba — recarrega esta para herdar a sessão
  // agora autenticada no contexto compartilhado (cookies são por contexto, não por aba).
  await page.goto(env.credpagoUrl, { waitUntil: "domcontentloaded" }).catch(() => {});

  if (await isLoginPage(page)) {
    throw new Error("Login não confirmado — a página ainda parece ser a tela de login.");
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
      "id, tipo_pessoa, documento, documento_masked, tipo_imovel, cep, valor_aluguel, valor_condominio, valor_taxas, status",
    )
    .eq("status", "pendente")
    .eq("origem", "nox_financa")
    .order("created_at", { ascending: true })
    .limit(limite);
  if (error) throw error;
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
    await supabaseAdmin.from("consultas_credito").update({ automation_step: step }).eq("id", id);
  } catch {
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

  const { error } = await supabaseAdmin.from("consultas_credito").update(payload).eq("id", id);
  if (error) throw error;
}

async function marcarErro(id: string, erroTecnico: string): Promise<void> {
  const mensagemSegura = mensagemSeguraParaErro(erroTecnico);
  await atualizarResultado(id, {
    status: "erro",
    mensagem: mensagemSegura,
    rawSummary: { erroTecnico, capturadoEm: new Date().toISOString() },
  });
}

// ---------------------------------------------------------------------------
// Processamento de uma consulta — sempre com sua PRÓPRIA aba, nunca compartilhada
// com outra consulta em andamento. `estado.finalizado` evita que um resultado
// atrasado sobrescreva um status já gravado pelo timeout (ou vice-versa).
// ---------------------------------------------------------------------------

interface EstadoConsulta {
  finalizado: boolean;
}

async function processarConsulta(
  context: BrowserContext,
  consulta: ConsultaCreditoRow,
  estado: EstadoConsulta,
): Promise<void> {
  const cid = consulta.id.slice(0, 8);
  const doc = consulta.documento_masked || maskDocumento(consulta.documento);
  log(`[${cid}] Consulta recebida (documento ${doc})`);

  const page = await context.newPage();
  try {
    log(`[${cid}] Abrindo CredPago`);
    const sessaoPodeEstarFria = Date.now() - ultimaAtividadeEm > SESSAO_OCIOSA_MS;
    ultimaAtividadeEm = Date.now();
    await page.goto(env.credpagoUrl, { waitUntil: "domcontentloaded" });

    if (sessaoPodeEstarFria) {
      log(
        `[${cid}] Sessão ociosa há mais de ${Math.round(SESSAO_OCIOSA_MS / 60000)}min — recarregando antes de preencher (evita o clique em "Simular Crédito" travar sem erro).`,
      );
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    }

    await ensureLoggedIn(cid, page);

    // O login costuma redirecionar para o dashboard em vez de voltar à página de origem —
    // garante que esta aba termine na tela de simulação antes de preencher os dados.
    if (!page.url().includes("/imobiliaria/proposta")) {
      await page.goto(env.credpagoUrl, { waitUntil: "domcontentloaded" });
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
    await fillValores(page, {
      aluguel: Number(consulta.valor_aluguel) || 0,
      condominio: Number(consulta.valor_condominio) || 0,
      taxas: Number(consulta.valor_taxas) || 0,
    });

    log(`[${cid}] Enviando simulação`);
    await atualizarStep(consulta.id, "enviando");
    await submitSimulation(page);

    log(`[${cid}] Aguardando resultado`);
    await atualizarStep(consulta.id, "aguardando_resultado");
    const resultado = await parseResultado(page, {
      onLog: (msg) => log(`[${cid}] ${msg}`),
      // Causa raiz observada em produção: o clique em "Simular Crédito" às vezes não
      // registra (nada na página muda por dezenas de segundos). Reenviar o mesmo clique
      // resolve sem precisar preencher tudo de novo — só reclicamos quando a página está
      // 100% parada (ver heurística em parseResultado), nunca durante progresso real.
      onRetryClick: () => submitSimulation(page),
    });
    log(`[${cid}] Resultado identificado: ${resultado.status}`);

    if (estado.finalizado) {
      log(
        `[${cid}] Resultado chegou após o tempo limite já ter marcado erro — descartando para não sobrescrever.`,
      );
      return;
    }
    estado.finalizado = true;
    await atualizarResultado(consulta.id, resultado);
    log(`[${cid}] Consulta atualizada -> ${resultado.status}`);
  } catch (err) {
    const erroTecnico = err instanceof Error ? err.message : String(err);
    logErro(`[${cid}] Falha ao processar consulta`, err);
    if (estado.finalizado) {
      log(
        `[${cid}] Erro chegou após o tempo limite já ter finalizado a consulta — ignorando gravação.`,
      );
      return;
    }
    estado.finalizado = true;
    await marcarErro(consulta.id, erroTecnico).catch((e) =>
      logErro(`[${cid}] Falha ao gravar erro no Supabase`, e),
    );
  } finally {
    await page.close().catch(() => {});
    log(`[${cid}] Aba fechada`);
  }
}

/** Envolve processarConsulta com um limite de tempo próprio, sem afetar outras consultas em paralelo. */
async function processarConsultaComTimeout(
  context: BrowserContext,
  consulta: ConsultaCreditoRow,
): Promise<void> {
  const cid = consulta.id.slice(0, 8);
  const estado: EstadoConsulta = { finalizado: false };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<void>((resolve) => {
    timer = setTimeout(async () => {
      if (estado.finalizado) return;
      estado.finalizado = true;
      logErro(`[${cid}] Tempo limite de ${env.consultaTimeoutMs}ms excedido`);
      await marcarErro(
        consulta.id,
        `Tempo limite de ${Math.round(env.consultaTimeoutMs / 1000)}s excedido ao consultar.`,
      ).catch((e) => logErro(`[${cid}] Falha ao gravar erro de timeout no Supabase`, e));
      resolve();
    }, env.consultaTimeoutMs);
  });

  const trabalho = processarConsulta(context, consulta, estado).finally(() => clearTimeout(timer));

  await Promise.race([trabalho, timeoutPromise]);
  // Se o timeout venceu a corrida, ainda deixamos o trabalho de fundo terminar sozinho
  // (ele vai fechar a própria aba no finally) — só evitamos que uma rejeição não tratada
  // derrube o processo do worker.
  trabalho.catch(() => {});
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
    return { context, browser: null, persistirSessao: async () => {} };
  } catch (err) {
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

/**
 * Servidor HTTP mínimo só para health check (ex.: Docker healthcheck, monitoramento
 * externo). Não expõe nenhuma rota de negócio, secret ou detalhe interno.
 */
function iniciarServidorHealth(): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "not_found" }));
  });
  server.listen(env.healthPort, "0.0.0.0", () => {
    log(`Servidor de health check ouvindo em 0.0.0.0:${env.healthPort}/health`);
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
  const { context, browser, persistirSessao } = await abrirContexto();
  log(`Chrome iniciado em modo ${env.headless ? "headless (invisível)" : "visível"}`);

  const healthServer = once ? null : iniciarServidorHealth();

  const emAndamento = new Map<string, Promise<void>>();
  let desligando = false;

  const finalizarWorker = async () => {
    if (healthServer) await new Promise((resolve) => healthServer.close(resolve));
    if (!env.keepBrowserOpen) {
      await persistirSessao();
      await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    } else {
      log("AUTOMATION_KEEP_BROWSER_OPEN=true — Chrome permanece aberto.");
    }
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
      ? setInterval(() => void persistirSessao(), 15 * 60 * 1000)
      : null;

  try {
    for (;;) {
      if (desligando) break;

      const vagas = env.maxConcurrentConsultas - emAndamento.size;
      if (vagas > 0) {
        const pendentes = await fetchConsultasPendentes(vagas);
        for (const consulta of pendentes) {
          if (emAndamento.size >= env.maxConcurrentConsultas) break;

          const reservou = await marcarProcessando(consulta.id);
          if (!reservou) continue; // outra execução pegou essa consulta primeiro

          const tarefa = processarConsultaComTimeout(context, consulta)
            .catch((e) => logErro(`Falha não tratada na consulta ${consulta.id}`, e))
            .finally(() => emAndamento.delete(consulta.id));
          emAndamento.set(consulta.id, tarefa);
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
  process.exit(1);
});
