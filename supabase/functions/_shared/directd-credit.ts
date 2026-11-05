export type DirectDCreditDecision = "aprovado" | "recusado" | "em_analise";

export interface DirectDScoreSubject {
  score?: number | null;
  faixaScore?: string | null;
  scoreCompromissoPagamento?: number | null;
  descricaoCompromissoPagamento?: string | null;
  scorePerfil?: number | null;
  descricaoPerfil?: string | null;
  motivos?: string[] | null;
  indicadoresNegocio?: Array<{
    indicador?: string | null;
    status?: string | null;
    risco?: string | null;
    observacao?: string | null;
  }> | null;
}

export interface DirectDScoreResponse {
  metaDados?: {
    consultaNome?: string | null;
    consultaUid?: string | null;
    mensagem?: string | null;
    resultadoId?: number | null;
    resultado?: string | null;
    apiVersao?: string | null;
    assincrono?: boolean | null;
    data?: string | null;
    tempoExecucaoMs?: number | null;
  } | null;
  retorno?: {
    dataConsulta?: string | null;
    documentoConsultado?: string | null;
    pessoaFisica?: DirectDScoreSubject | null;
    pessoaJuridica?: DirectDScoreSubject | null;
    observacao?: string | null;
  } | null;
}

export interface NormalizedDirectDResult {
  decision: DirectDCreditDecision;
  faixaScore: string;
  score: number | null;
  commitmentPaymentDescription: string;
  commitmentPaymentPercentage: number | null;
  message: string;
}

const MIN_APPROVAL_SCORE = 651;
const MIN_PENDING_SCORE = 541;
const AUTOMATIC_REJECTION_SCORE_CUTOFF = 539;
const MIN_COMMITMENT_PAYMENT_PERCENTAGE = 48;

const RETRYABLE_DIRECTD_SCORE_HTTP_STATUSES = new Set([
  400, 401, 403, 404, 408, 429, 500, 502, 503, 504,
]);
const TRANSIENT_DIRECTD_SCORE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export const DIRECTD_DECISION_RULE = "score_descricao_compromisso_v2";

export function extractCommitmentPaymentPercentage(value: unknown): number | null {
  if (typeof value !== "string") return null;

  const percentages = Array.from(value.matchAll(/(?:^|[^\d])(\d{1,3}(?:[.,]\d+)?)\s*%/g), (match) =>
    Number(match[1].replace(",", ".")),
  ).filter((percentage) => Number.isFinite(percentage) && percentage >= 0 && percentage <= 100);

  // Quando o provedor descreve uma faixa, o limite inferior é a evidência
  // conservadora para comparar com o mínimo comercial da NOX.
  return percentages.length > 0 ? Math.min(...percentages) : null;
}

function scoreBandFor(score: number | null, providerBand: string): string {
  if (score !== null && score >= 0 && score < MIN_PENDING_SCORE) {
    return "Alto índice de inadimplência";
  }
  if (score !== null && score >= MIN_PENDING_SCORE && score < MIN_APPROVAL_SCORE) {
    return "Médio índice de inadimplência";
  }
  if (score !== null && score >= MIN_APPROVAL_SCORE && score <= 1000) {
    return "Baixo índice de inadimplência";
  }
  return providerBand || "Faixa não informada";
}

function normalizePaymentDescription(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();
}

function isAdverseTermNegated(description: string, termIndex: number): boolean {
  const prefix = description.slice(Math.max(0, termIndex - 90), termIndex);
  const clauses = prefix.split(/\b(?:mas|porem|contudo|todavia|entretanto)\b|[.!?;,]/);
  const currentClause = clauses[clauses.length - 1] ?? prefix;
  return /\b(?:nao|sem|nunca|nenhum|nenhuma|nem)\b(?:\s+[a-z0-9]+){0,8}\s*$/.test(
    currentClause,
  );
}

/**
 * Detecta relatos equivalentes a atrasos de pagamento ou pendências financeiras.
 * Termos explicitamente negados (por exemplo, "sem atrasos") não são adversos.
 */
export function hasAdversePaymentHistory(value: unknown): boolean {
  if (typeof value !== "string") return false;

  const description = normalizePaymentDescription(value);
  const adverseTerms = [
    /\batras(?:o|os|ou|ado|ados)\b/g,
    /\bpendenc(?:ia|ias)\s+financeir(?:a|as)\b/g,
  ];

  return adverseTerms.some((pattern) =>
    Array.from(description.matchAll(pattern)).some(
      (match) => !isAdverseTermNegated(description, match.index ?? 0),
    ),
  );
}

export function subjectForDocument(
  response: DirectDScoreResponse,
  documentLength: number,
): DirectDScoreSubject | null {
  if (documentLength === 11) return response.retorno?.pessoaFisica ?? null;
  if (documentLength === 14) return response.retorno?.pessoaJuridica ?? null;
  return null;
}

export function hasDirectDScoreSuccessPayload(
  response: DirectDScoreResponse | null,
  documentLength: number,
): boolean {
  if (!response || !subjectForDocument(response, documentLength)) return false;

  const resultId = Number(response.metaDados?.resultadoId);
  const result = String(response.metaDados?.resultado ?? "")
    .trim()
    .toLocaleLowerCase("pt-BR");
  const message = String(response.metaDados?.mensagem ?? "")
    .trim()
    .toLocaleLowerCase("pt-BR");

  return resultId === 1 || result.includes("sucesso") || message.includes("sucesso");
}

/**
 * A Direct Data documenta estes códigos como falha sem resultado. Só repetimos
 * quando a resposta também não contém `consultaUid`, que funciona como recibo
 * de um envio possivelmente processado ou cobrado.
 */
export function canRetryDirectDScoreFailure(
  status: number,
  response: DirectDScoreResponse | null,
): boolean {
  const providerReceipt = String(response?.metaDados?.consultaUid ?? "").trim();
  return RETRYABLE_DIRECTD_SCORE_HTTP_STATUSES.has(status) && !providerReceipt;
}

export function shouldAutomaticallyRetryDirectDScoreFailure(
  status: number,
  response: DirectDScoreResponse | null,
): boolean {
  return (
    TRANSIENT_DIRECTD_SCORE_HTTP_STATUSES.has(status) &&
    canRetryDirectDScoreFailure(status, response)
  );
}

/**
 * Regra comercial conjunta fornecida pela NOX para o Score QUOD e o percentual
 * presente em descricaoCompromissoPagamento. Dados ausentes ou ilegíveis nunca
 * recebem aprovação ou recusa automática.
 */
export function normalizeDirectDResult(
  response: DirectDScoreResponse,
  documentLength: number,
): NormalizedDirectDResult {
  const subject = subjectForDocument(response, documentLength);
  const providerBand = String(subject?.faixaScore ?? "").trim();
  const commitmentPaymentDescription = String(subject?.descricaoCompromissoPagamento ?? "").trim();
  const commitmentPaymentPercentage = extractCommitmentPaymentPercentage(
    commitmentPaymentDescription,
  );
  const rawScore = subject?.score;
  const parsedScore =
    rawScore === null || rawScore === undefined
      ? null
      : Number.isFinite(Number(rawScore))
        ? Number(rawScore)
        : null;
  const score =
    parsedScore !== null && parsedScore >= 0 && parsedScore <= 1000 ? parsedScore : null;
  const faixaScore = scoreBandFor(score, providerBand);

  if (hasAdversePaymentHistory(commitmentPaymentDescription)) {
    return {
      decision: "recusado",
      faixaScore,
      score,
      commitmentPaymentDescription,
      commitmentPaymentPercentage,
      message:
        "Crédito reprovado porque a análise oficial identificou atrasos de pagamento ou pendências financeiras.",
    };
  }

  if (score !== null && commitmentPaymentPercentage !== null) {
    if (
      score >= MIN_APPROVAL_SCORE &&
      commitmentPaymentPercentage >= MIN_COMMITMENT_PAYMENT_PERCENTAGE
    ) {
      return {
        decision: "aprovado",
        faixaScore,
        score,
        commitmentPaymentDescription,
        commitmentPaymentPercentage,
        message: "Crédito aprovado pela análise conjunta de score e compromisso de pagamento.",
      };
    }

    if (
      score >= MIN_PENDING_SCORE &&
      commitmentPaymentPercentage >= MIN_COMMITMENT_PAYMENT_PERCENTAGE
    ) {
      return {
        decision: "em_analise",
        faixaScore,
        score,
        commitmentPaymentDescription,
        commitmentPaymentPercentage,
        message:
          "Análise pendente pela avaliação conjunta de score e compromisso de pagamento. Envie o comprovante de renda para continuar.",
      };
    }

    if (
      score < AUTOMATIC_REJECTION_SCORE_CUTOFF &&
      commitmentPaymentPercentage < MIN_COMMITMENT_PAYMENT_PERCENTAGE
    ) {
      return {
        decision: "recusado",
        faixaScore,
        score,
        commitmentPaymentDescription,
        commitmentPaymentPercentage,
        message: "Crédito reprovado pela análise conjunta de score e compromisso de pagamento.",
      };
    }

    return {
      decision: "em_analise",
      faixaScore,
      score,
      commitmentPaymentDescription,
      commitmentPaymentPercentage,
      message:
        "A análise oficial precisa de conferência complementar porque os critérios tiveram resultados diferentes ou ficaram na faixa manual.",
    };
  }

  // Uma resposta HTTP 200 já consumiu a consulta. Sem os dois critérios,
  // o estado correto é análise complementar — nunca uma fila sem fim e nunca
  // um novo envio automático que poderia cobrar novamente.
  return {
    decision: "em_analise",
    faixaScore,
    score,
    commitmentPaymentDescription,
    commitmentPaymentPercentage,
    message:
      "A análise oficial precisa de conferência complementar porque o score ou o compromisso de pagamento não foi informado.",
  };
}

export function sanitizeDirectDResponse(
  response: DirectDScoreResponse,
  documentLength: number,
): Record<string, unknown> {
  const subject = subjectForDocument(response, documentLength);
  return {
    metaDados: {
      consultaNome: response.metaDados?.consultaNome ?? null,
      consultaUid: response.metaDados?.consultaUid ?? null,
      mensagem: response.metaDados?.mensagem ?? null,
      resultadoId: response.metaDados?.resultadoId ?? null,
      resultado: response.metaDados?.resultado ?? null,
      apiVersao: response.metaDados?.apiVersao ?? null,
      assincrono: response.metaDados?.assincrono ?? null,
      data: response.metaDados?.data ?? null,
      tempoExecucaoMs: response.metaDados?.tempoExecucaoMs ?? null,
    },
    retorno: {
      dataConsulta: response.retorno?.dataConsulta ?? null,
      faixaScore: subject?.faixaScore ?? null,
      regraDecisao: DIRECTD_DECISION_RULE,
      motivos: subject?.motivos ?? [],
      indicadoresNegocio: subject?.indicadoresNegocio ?? [],
      observacao: response.retorno?.observacao ?? null,
    },
  };
}
