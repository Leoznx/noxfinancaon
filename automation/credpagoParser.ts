import type { Page } from "playwright";
import type { ResultadoParse, ResultadoStatus } from "./types";
import { redactSensitiveText, sanitizeUrl } from "./redaction";
import { nomeClienteValido, somenteDigitos } from "./customerIdentity";
import { extractLoftProposalId } from "./loftCancellation";

// Ordem importa: "recusado" (inclui negações como "não aprovado") é checado antes de
// "aprovado" para não gerar falso-positivo quando o texto for algo como "locatício não aprovado".
const PADROES: { status: Exclude<ResultadoStatus, "erro">; regex: RegExp }[] = [
  {
    status: "recusado",
    regex: /(cr[ée]dito\s+)?(recusad[oa]|reprovad[oa]|negad[oa]|n[ãa]o\s+(foi\s+)?aprovad[oa])/i,
  },
  // A CredPago usa "Crédito pendente de análise" (não "em análise") — aceita as duas formas.
  {
    status: "em_analise",
    regex:
      /(pendente\s+de\s+an[aá]lise|em\s+an[aá]lise|an[aá]lise\s+pendente|an[aá]lise\s+complementar\s+necess[aá]ria)/i,
  },
  { status: "aprovado", regex: /(valor\s+locat[ií]cio\s+)?(cr[ée]dito\s+)?aprovad[oa]/i },
];

// Mensagem curta e limpa por status — nunca o texto bruto da página (que mistura
// menu, título e outros blocos vizinhos e fica ilegível para o corretor).
const MENSAGEM_POR_STATUS: Record<Exclude<ResultadoStatus, "erro">, string> = {
  aprovado: "Crédito aprovado.",
  recusado: "Crédito recusado.",
  em_analise: "Crédito em análise.",
};

const TIMEOUT_MS = 30000;
const PROCESSING_TIMEOUT_MS = 150000;
const POLL_INTERVAL_MS = 1000;
const PROCESSING_REGEX =
  /(estamos\s+fazendo\s+a\s+an[aá]lise\s+de\s+cr[ée]dito|an[aá]lise\s+de\s+cr[ée]dito\s+em\s+andamento|analisando\s+cr[ée]dito|consultando\s+hist[oó]rico[^\n]{0,80}(?:pagamento|cliente)|aguarde[^\n]{0,80}an[aá]lise\s+de\s+cr[ée]dito)/i;
const IDLE_FORM_REGEX = /(fazer\s+an[aá]lise|simular\s+cr[ée]dito)/i;
const PROVIDER_INTERNAL_ERROR_REGEX =
  /(ocorreu\s+um\s+erro\s+interno|erro\s+interno[^\n]{0,100}tente\s+novamente|tente\s+novamente\s+mais\s+tarde)/i;
/**
 * Se a página ficar com o texto EXATAMENTE igual por esse tempo depois do clique em
 * de envio (nem um spinner, nem uma navegação, nada), assumimos que o clique
 * não registrou e tentamos de novo — foi a causa raiz observada em produção (consulta
 * ficou 30s travada na tela do formulário, com a ação de análise ainda visível).
 */
const RETRY_APOS_MS = 7000;
const MAX_RECLIQUES = 2;
const PROVIDER_RESET_STABLE_MS = 3000;

export interface ParseResultadoOpts {
  /** Chamado quando a página parece travada (sem nenhuma mudança) após o envio — deve reenviar o clique. */
  onRetryClick?: (tentativa: number) => Promise<void>;
  /** Log opcional de progresso (o worker usa para deixar rastro no console). */
  onLog?: (mensagem: string) => void;
  /** Limites substituíveis apenas para testes e ajustes operacionais controlados. */
  timeoutMs?: number;
  processingTimeoutMs?: number;
  pollIntervalMs?: number;
  retryAfterMs?: number;
  maxRetryClicks?: number;
  /** Tempo de estabilidade do formulário após uma análise já confirmada. */
  providerResetStableMs?: number;
}

/**
 * Aguarda o resultado da simulação aparecer na página e o identifica.
 * A CredPago pode atualizar o conteúdo via SPA ou navegar para uma nova URL
 * (ex.: /imobiliaria/proposta/{id}) após o clique em "Simular Crédito" — por isso
 * lemos o texto da página em polling, em vez de esperar um tempo fixo único.
 * Nunca inventa uma resposta: se nenhum padrão bater dentro do timeout, retorna
 * status "erro" com o texto capturado para diagnóstico manual.
 */
export async function parseResultado(
  page: Page,
  opts: ParseResultadoOpts = {},
): Promise<ResultadoParse> {
  const inicio = Date.now();
  const timeoutInicial = opts.timeoutMs ?? TIMEOUT_MS;
  const timeoutProcessando = Math.max(
    timeoutInicial,
    opts.processingTimeoutMs ?? PROCESSING_TIMEOUT_MS,
  );
  const pollInterval = opts.pollIntervalMs ?? POLL_INTERVAL_MS;
  const retryAfter = opts.retryAfterMs ?? RETRY_APOS_MS;
  const maxRetryClicks = opts.maxRetryClicks ?? MAX_RECLIQUES;
  const providerResetStableMs = opts.providerResetStableMs ?? PROVIDER_RESET_STABLE_MS;
  let bodyText = "";
  let baseline = await page
    .locator("body")
    .innerText()
    .catch(() => "");
  let processamentoDetectado = PROCESSING_REGEX.test(baseline);
  let deadline = inicio + (processamentoDetectado ? timeoutProcessando : timeoutInicial);
  if (processamentoDetectado) {
    opts.onLog?.(
      `Análise confirmada no portal — aguardando o resultado por até ${Math.round(timeoutProcessando / 1000)}s, sem reenviar a simulação.`,
    );
  }
  let ultimoReclique = Date.now();
  let tentativasReclique = 0;
  let retornoAoFormularioDesde: number | null = null;

  while (Date.now() < deadline) {
    bodyText = await page
      .locator("body")
      .innerText()
      .catch(() => "");

    for (const { status, regex } of PADROES) {
      if (regex.test(bodyText)) {
        const { nome, documento } = extrairClienteInfo(bodyText);
        return {
          status,
          mensagem: MENSAGEM_POR_STATUS[status],
          proposalId: extractLoftProposalId(page.url()) ?? extractLoftProposalId(bodyText),
          clienteNome: nome,
          clienteDocumento: documento,
          rawSummary: buildSummary(page, bodyText),
        };
      }
    }

    // O portal pode iniciar a análise e, alguns segundos depois, voltar ao
    // formulário exibindo esta falha transitória. Resultados de crédito reais têm
    // precedência caso algum aviso antigo ainda permaneça visível na página.
    if (PROVIDER_INTERNAL_ERROR_REGEX.test(bodyText)) {
      return {
        status: "erro",
        mensagem:
          "O parceiro de crédito apresentou uma instabilidade interna. A NOX tentou recuperar a consulta automaticamente.",
        proposalId: extractLoftProposalId(page.url()) ?? extractLoftProposalId(bodyText),
        clienteNome: null,
        clienteDocumento: null,
        rawSummary: buildSummary(page, bodyText, {
          motivoTecnico: "provider_internal_error",
        }),
      };
    }

    // A Loft pode manter esta mensagem estática por mais de 30 segundos enquanto
    // processa a proposta. Isso é progresso real: não repetimos o clique (que pode
    // duplicar/reiniciar a simulação) e estendemos somente esse estado comprovado.
    const processamentoAtivo = PROCESSING_REGEX.test(bodyText);
    if (processamentoAtivo && !processamentoDetectado) {
      processamentoDetectado = true;
      deadline = Math.max(deadline, inicio + timeoutProcessando);
      opts.onLog?.(
        `Análise confirmada no portal — aguardando o resultado por até ${Math.round(timeoutProcessando / 1000)}s, sem reenviar a simulação.`,
      );
    }

    // Depois que o portal confirmou a análise, voltar ao formulário com o botão de
    // envio significa que o fluxo foi abandonado sem resultado (observado quando
    // duas abas da mesma sessão disputavam o estado da SPA). Não esperamos os 150s
    // restantes nem reenviamos automaticamente uma consulta de crédito real.
    const voltouAoFormulario =
      processamentoDetectado && !processamentoAtivo && IDLE_FORM_REGEX.test(bodyText);
    if (voltouAoFormulario) {
      retornoAoFormularioDesde ??= Date.now();
      if (Date.now() - retornoAoFormularioDesde >= providerResetStableMs) {
        opts.onLog?.(
          "O portal voltou ao formulário depois de iniciar a análise; encerrando sem reenviar para evitar duplicidade.",
        );
        return {
          status: "erro",
          mensagem:
            "O parceiro encerrou a análise sem devolver um resultado. Tente novamente; seus dados foram preservados.",
          proposalId: extractLoftProposalId(page.url()) ?? extractLoftProposalId(bodyText),
          clienteNome: null,
          clienteDocumento: null,
          rawSummary: buildSummary(page, bodyText, {
            motivoTecnico: "provider_returned_to_form",
          }),
        };
      }
    } else {
      retornoAoFormularioDesde = null;
    }

    // Nada mudou desde a última "foto" (nem um spinner, nem uma navegação) — sinal
    // mais confiável de que o clique não surtiu efeito. Não reclicamos enquanto algo
    // estiver visivelmente mudando (ex.: "Sua análise está pronta!"), só quando a
    // página está totalmente parada — evita clicar duas vezes numa simulação real.
    const semMudancaNenhuma = bodyText === baseline;
    const tempoTravado = Date.now() - ultimoReclique;
    if (
      !processamentoAtivo &&
      semMudancaNenhuma &&
      opts.onRetryClick &&
      tentativasReclique < maxRetryClicks &&
      tempoTravado >= retryAfter
    ) {
      tentativasReclique++;
      opts.onLog?.(
        `Página sem nenhuma mudança após ${Math.round(tempoTravado / 1000)}s — tentativa ${tentativasReclique}/${maxRetryClicks} de reenviar a análise.`,
      );
      await opts.onRetryClick(tentativasReclique).catch(() => {});
      ultimoReclique = Date.now();
      await page.waitForTimeout(500); // dá um instante pro clique surtir efeito antes da próxima "foto"
      baseline = await page
        .locator("body")
        .innerText()
        .catch(() => bodyText);
      continue;
    }

    await page.waitForTimeout(pollInterval);
  }

  return {
    status: "erro",
    mensagem:
      "Não foi possível identificar o resultado da simulação dentro do tempo esperado. Verifique manualmente e tente novamente.",
    proposalId: extractLoftProposalId(page.url()) ?? extractLoftProposalId(bodyText),
    clienteNome: null,
    clienteDocumento: null,
    rawSummary: buildSummary(page, bodyText),
  };
}

function buildSummary(
  page: Page,
  bodyText: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    url: sanitizeUrl(page.url()),
    textoCapturado: redactSensitiveText(bodyText, 4000),
    capturadoEm: new Date().toISOString(),
    ...extra,
  };
}

/**
 * Extrai o nome e o CPF/CNPJ da tela de resultado. O portal já usou os rótulos
 * Cliente, Inquilino, Locatário e Nome do cliente, tanto na mesma linha quanto
 * em linhas separadas. Nunca devolve CPF/rótulo como nome.
 */
export function extrairClienteInfo(texto: string): {
  nome: string | null;
  documento: string | null;
} {
  const linhas = texto
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((linha) => linha.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const compacto = linhas.join(" ");
  const rotuloNome =
    /(?:cliente|inquilino|locat[aá]rio|nome(?:\s+do\s+(?:cliente|inquilino|locat[aá]rio))?)\s*[:-]?\s*/i;
  const candidatos: string[] = [];

  for (const linha of linhas) {
    const rotulo = linha.match(rotuloNome);
    if (!rotulo) continue;
    const depois = linha.slice(rotulo.index! + rotulo[0].length);
    const antesDoDocumento = depois.split(/\b(?:CPF|CNPJ)\b\s*:/i)[0];
    if (antesDoDocumento) candidatos.push(antesDoDocumento);
  }

  const nomeRotulado = compacto.match(
    /(?:cliente|inquilino|locat[aá]rio|nome(?:\s+do\s+(?:cliente|inquilino|locat[aá]rio))?)\s*[:-]\s*([^\n]+?)(?=\s+(?:CPF|CNPJ)\s*:|$)/i,
  );
  if (nomeRotulado) candidatos.unshift(nomeRotulado[1]);

  // Alguns retornos exibem somente “Nome” em uma linha e o valor na seguinte.
  for (let index = 0; index < linhas.length; index += 1) {
    if (!/^nome(?:\s+do\s+(?:cliente|inquilino|locat[aá]rio))?\s*:?$/i.test(linhas[index]))
      continue;
    if (linhas[index + 1]) candidatos.push(linhas[index + 1]);
  }

  // Último fallback: quando o portal coloca o nome imediatamente antes do
  // rótulo CPF/CNPJ, aproveitamos apenas as palavras da mesma linha.
  const indiceDocumento = linhas.findIndex((linha) => /\b(?:CPF|CNPJ)\b\s*:/i.test(linha));
  const linhaComDocumento = indiceDocumento >= 0 ? linhas[indiceDocumento] : null;
  if (linhaComDocumento) {
    const antes = linhaComDocumento
      .split(/\b(?:CPF|CNPJ)\b\s*:/i)[0]
      .replace(/(?:cliente|inquilino|locat[aá]rio|nome)\s*[:-]?\s*/gi, " ")
      .trim();
    if (antes) candidatos.push(antes);
    else if (indiceDocumento > 0) candidatos.push(linhas[indiceDocumento - 1]);
  }

  const nome = candidatos.map(nomeClienteValido).find(Boolean) ?? null;
  const docMatch = compacto.match(/(?:CPF|CNPJ)\s*:\s*([\d./-]{11,20})/i);
  return {
    nome,
    documento: somenteDigitos(docMatch?.[1]),
  };
}
