export type DirectDCreditDecision = "aprovado" | "recusado" | "em_analise";

export const DIRECTD_CREDIT_RULE_VERSION = "score_compromisso_v1";

export interface DirectDScoreSubject {
  score?: number | null;
  faixaScore?: string | null;
  scoreCompromissoPagamento?: number | string | null;
  descricaoCompromissoPagamento?: string | null;
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
  scoreCompromissoPagamento: number | null;
  descricaoCompromissoPagamento: string | null;
  regraDecisao: typeof DIRECTD_CREDIT_RULE_VERSION;
  message: string;
}

function numberInRange(value: unknown, minimum: number, maximum: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= minimum && numeric <= maximum ? numeric : null;
}

function scoreBand(score: number | null, providerBand: string): string {
  if (score !== null && score <= 539) return "Alto índice de inadimplência";
  if (score !== null && score <= 650) return "Médio índice de inadimplência";
  if (score !== null) return "Baixo índice de inadimplência";
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
 * Regra comercial da NOX para o Score QUOD e o compromisso de pagamento.
 * A descrição textual é preservada para auditoria, mas os limites usam o
 * `scoreCompromissoPagamento` numérico retornado pelo provedor.
 */
export function normalizeDirectDResult(
  response: DirectDScoreResponse,
  documentLength: number,
): NormalizedDirectDResult {
  const subject = subjectForDocument(response, documentLength);
  const providerBand = String(subject?.faixaScore ?? "").trim();
  const score = numberInRange(subject?.score, 0, 1000);
  const scoreCompromissoPagamento = numberInRange(
    subject?.scoreCompromissoPagamento,
    0,
    100,
  );
  const descricaoCompromissoPagamento =
    String(subject?.descricaoCompromissoPagamento ?? "").trim() || null;
  const faixaScore = scoreBand(score, providerBand);
  const common = {
    faixaScore,
    score,
    scoreCompromissoPagamento,
    descricaoCompromissoPagamento,
    regraDecisao: DIRECTD_CREDIT_RULE_VERSION,
  } as const;

  if (score !== null && scoreCompromissoPagamento !== null) {
    if (score >= 651 && scoreCompromissoPagamento >= 80) {
      return {
        ...common,
        decision: "aprovado",
        message: "Crédito aprovado pelos critérios de score e compromisso de pagamento.",
      };
    }

    if (score >= 540 && scoreCompromissoPagamento >= 60) {
      return {
        ...common,
        decision: "em_analise",
        message: "Análise pendente. Envie o comprovante de renda para continuar.",
      };
    }

    return {
      ...common,
      decision: "recusado",
      message: "Crédito reprovado pelos critérios de score e compromisso de pagamento.",
    };
  }

  // Uma resposta paga sem um dos dois números não pode ser aprovada ou
  // recusada automaticamente. Ela termina em análise complementar e não gera
  // uma segunda chamada ao provedor.
  return {
    ...common,
    decision: "em_analise",
    message: "A análise oficial precisa de conferência complementar dos dois indicadores.",
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
      score: subject?.score ?? null,
      faixaScore: subject?.faixaScore ?? null,
      scoreCompromissoPagamento: subject?.scoreCompromissoPagamento ?? null,
      descricaoCompromissoPagamento: subject?.descricaoCompromissoPagamento ?? null,
      regraDecisao: DIRECTD_CREDIT_RULE_VERSION,
      motivos: subject?.motivos ?? [],
      indicadoresNegocio: subject?.indicadoresNegocio ?? [],
      observacao: response.retorno?.observacao ?? null,
    },
  };
}
