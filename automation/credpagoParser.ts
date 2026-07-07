import type { Page } from "playwright";
import type { ResultadoParse, ResultadoStatus } from "./types";

// Ordem importa: "recusado" (inclui negações como "não aprovado") é checado antes de
// "aprovado" para não gerar falso-positivo quando o texto for algo como "locatício não aprovado".
const PADROES: { status: Exclude<ResultadoStatus, "erro">; regex: RegExp }[] = [
  {
    status: "recusado",
    regex: /(cr[ée]dito\s+)?(recusad[oa]|reprovad[oa]|negad[oa]|n[ãa]o\s+(foi\s+)?aprovad[oa])/i,
  },
  // A CredPago usa "Crédito pendente de análise" (não "em análise") — aceita as duas formas.
  { status: "em_analise", regex: /(pendente\s+de\s+an[aá]lise|em\s+an[aá]lise|an[aá]lise\s+pendente)/i },
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
const POLL_INTERVAL_MS = 1000;

/**
 * Aguarda o resultado da simulação aparecer na página e o identifica.
 * A CredPago pode atualizar o conteúdo via SPA ou navegar para uma nova URL
 * (ex.: /imobiliaria/proposta/{id}) após o clique em "Simular Crédito" — por isso
 * lemos o texto da página em polling, em vez de esperar um tempo fixo único.
 * Nunca inventa uma resposta: se nenhum padrão bater dentro do timeout, retorna
 * status "erro" com o texto capturado para diagnóstico manual.
 */
export async function parseResultado(page: Page): Promise<ResultadoParse> {
  const inicio = Date.now();
  let bodyText = "";

  while (Date.now() - inicio < TIMEOUT_MS) {
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
          clienteNome: nome,
          clienteDocumento: documento,
          rawSummary: buildSummary(page, bodyText),
        };
      }
    }

    await page.waitForTimeout(POLL_INTERVAL_MS);
  }

  return {
    status: "erro",
    mensagem:
      "Não foi possível identificar o resultado da simulação dentro do tempo esperado. Verifique manualmente e tente novamente.",
    clienteNome: null,
    clienteDocumento: null,
    rawSummary: buildSummary(page, bodyText),
  };
}

function buildSummary(page: Page, bodyText: string): Record<string, unknown> {
  return {
    url: page.url(),
    textoCapturado: bodyText.slice(0, 4000),
    capturadoEm: new Date().toISOString(),
  };
}

/**
 * Extrai "Cliente: NOME" e "CPF/CNPJ: 000.000.000-00" do texto da página de resultado
 * da CredPago (ex.: "... Cliente: RONALDO DA SILVA CPF: 827.938.089-20 ..."). Retorna
 * null nos campos que não encontrar — nunca inventa nome/documento.
 *
 * O regex do nome exige pelo menos duas palavras só com letras (nome + sobrenome).
 * Isso é necessário porque em telas onde a CredPago não exibe nome (ex.: algumas
 * páginas de recusado têm só "Cliente: CPF: 000.000.000-00", sem nome entre os
 * dois rótulos), um regex genérico "tudo até o próximo CPF:" acaba capturando o
 * próprio texto "CPF: 000.000.000-00" como se fosse o nome.
 */
function extrairClienteInfo(texto: string): { nome: string | null; documento: string | null } {
  const nomeMatch = texto.match(/Cliente:\s*([A-ZÀ-Ý][A-ZÀ-Ýa-zà-ÿ]*(?:\s+[A-ZÀ-Ýa-zà-ÿ]+)+)\s*(?=CPF\s*:|CNPJ\s*:|\n|$)/);
  const docMatch = texto.match(/(?:CPF|CNPJ)\s*:\s*([\d./-]{11,20})/i);
  return {
    nome: nomeMatch ? nomeMatch[1].replace(/\s+/g, " ").trim() : null,
    documento: docMatch ? docMatch[1].replace(/\D/g, "") : null,
  };
}
