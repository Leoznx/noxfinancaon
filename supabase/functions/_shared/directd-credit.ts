export type DirectDCreditDecision = "aprovado" | "recusado" | "em_analise";

export interface DirectDScoreSubject {
  score?: number | null;
  faixaScore?: string | null;
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
  message: string;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
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
 * Regra comercial fornecida pela NOX para a faixa oficial da QUOD.
 * Faixas desconhecidas nunca recebem aprovação ou recusa automática.
 */
export function normalizeDirectDResult(
  response: DirectDScoreResponse,
  documentLength: number,
): NormalizedDirectDResult {
  const subject = subjectForDocument(response, documentLength);
  const faixaScore = String(subject?.faixaScore ?? "").trim();
  const normalized = normalizeText(faixaScore);
  const rawScore = subject?.score;
  const score =
    rawScore === null || rawScore === undefined
      ? null
      : Number.isFinite(Number(rawScore))
        ? Number(rawScore)
        : null;

  // O score numérico é a fonte da decisão comercial da NOX. Ele vem antes do
  // texto do provedor porque a descrição da faixa pode divergir dos limites
  // vigentes. Os intervalos são contínuos para que 540 e 651 não fiquem sem
  // uma decisão.
  if (score !== null && score >= 0 && score <= 540) {
    return {
      decision: "recusado",
      faixaScore: "Alto índice de inadimplência",
      score,
      message: "Crédito reprovado pela análise oficial de risco.",
    };
  }
  if (score !== null && score >= 541 && score <= 650) {
    return {
      decision: "em_analise",
      faixaScore: "Médio índice de inadimplência",
      score,
      message: "Análise pendente. Envie o comprovante de renda para continuar.",
    };
  }
  if (score !== null && score >= 651 && score <= 1000) {
    return {
      decision: "aprovado",
      faixaScore: "Baixo índice de inadimplência",
      score,
      message: "Crédito aprovado pela análise oficial de risco.",
    };
  }

  // O texto só é usado como fallback quando o provedor não devolve um score
  // numérico utilizável.
  if (
    normalized.includes("alto") &&
    (normalized.includes("inadimpl") || normalized.includes("risco"))
  ) {
    return {
      decision: "recusado",
      faixaScore,
      score,
      message: "Crédito reprovado pela análise oficial de risco.",
    };
  }
  if (
    normalized.includes("medio") &&
    (normalized.includes("inadimpl") || normalized.includes("risco"))
  ) {
    return {
      decision: "em_analise",
      faixaScore,
      score,
      message: "Análise pendente. Envie o comprovante de renda para continuar.",
    };
  }
  if (
    normalized.includes("baixo") &&
    (normalized.includes("inadimpl") || normalized.includes("risco"))
  ) {
    return {
      decision: "aprovado",
      faixaScore,
      score,
      message: "Crédito aprovado pela análise oficial de risco.",
    };
  }

  // Uma resposta HTTP 200 já consumiu a consulta. Sem faixa/score conclusivo,
  // o estado correto é análise complementar — nunca uma fila sem fim e nunca
  // um novo envio automático que poderia cobrar novamente.
  return {
    decision: "em_analise",
    faixaScore: faixaScore || "Faixa não informada",
    score,
    message: "A análise oficial precisa de conferência complementar.",
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
      motivos: subject?.motivos ?? [],
      indicadoresNegocio: subject?.indicadoresNegocio ?? [],
      observacao: response.retorno?.observacao ?? null,
    },
  };
}
