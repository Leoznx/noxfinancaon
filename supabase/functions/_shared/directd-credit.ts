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

export const DIRECTD_DECISION_RULE = "score_descricao_compromisso_v1";

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
  if (score !== null && score >= 0 && score < 540) return "Alto índice de inadimplência";
  if (score !== null && score >= 540 && score < 651) return "Médio índice de inadimplência";
  if (score !== null && score >= 651 && score <= 1000) {
    return "Baixo índice de inadimplência";
  }
  return providerBand || "Faixa não informada";
}

export function subjectForDocument(
  response: DirectDScoreResponse,
  documentLength: number,
): DirectDScoreSubject | null {
  if (documentLength === 11) return response.retorno?.pessoaFisica ?? null;
  if (documentLength === 14) return response.retorno?.pessoaJuridica ?? null;
  return null;
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

  if (score !== null && commitmentPaymentPercentage !== null) {
    if (score >= 651 && commitmentPaymentPercentage >= 80) {
      return {
        decision: "aprovado",
        faixaScore,
        score,
        commitmentPaymentDescription,
        commitmentPaymentPercentage,
        message: "Crédito aprovado pela análise conjunta de score e compromisso de pagamento.",
      };
    }

    if (score >= 540 && commitmentPaymentPercentage >= 60) {
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

    return {
      decision: "recusado",
      faixaScore,
      score,
      commitmentPaymentDescription,
      commitmentPaymentPercentage,
      message: "Crédito reprovado pela análise conjunta de score e compromisso de pagamento.",
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
