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

export const DIRECTD_DECISION_RULE = "score_descricao_compromisso_v3";

const MINIMUM_APPROVAL_SCORE = 600;
const MINIMUM_REVIEW_SCORE = 541;
const AUTOMATIC_REJECTION_SCORE_CUTOFF = 540;
const MINIMUM_COMMITMENT_PAYMENT_PERCENTAGE = 48;

export function extractCommitmentPaymentPercentage(value: unknown): number | null {
  if (typeof value !== "string") return null;

  const percentages = Array.from(value.matchAll(/(?:^|[^\d])(\d{1,3}(?:[.,]\d+)?)\s*%/g), (match) =>
    Number(match[1].replace(",", ".")),
  ).filter((percentage) => Number.isFinite(percentage) && percentage >= 0 && percentage <= 100);

  // Quando o provedor descreve uma faixa, o limite inferior é a evidência
  // conservadora para comparar com o mínimo comercial da NOX.
  return percentages.length > 0 ? Math.min(...percentages) : null;
}

function normalizeProviderText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .trim();
}

/**
 * Identifica descrições equivalentes ao alerta da DirectD sobre atrasos ou
 * pendências financeiras. Negativas explícitas não são tratadas como alerta.
 */
export function hasAdversePaymentHistory(value: unknown): boolean {
  const normalized = normalizeProviderText(value);
  if (!normalized) return false;

  const paymentIssue =
    "(?:atrasos?(?: [a-z0-9]+){0,3} (?:de|nos?) pagamentos?|pendencias? financeiras?)";
  const explicitDenial = new RegExp(
    `\\b(?:nao|sem)(?: [a-z0-9]+){0,5} ${paymentIssue}\\b`,
    "g",
  );
  const affirmativeCandidate = normalized.replace(explicitDenial, " ");

  const affirmativeContext = new RegExp(
    `\\b(?:apresenta(?: ou apresentou)?|apresentou|possui|teve|tem|registra(?:do)?|constam?)(?: [a-z0-9]+){0,12} ${paymentIssue}\\b`,
  );
  const qualifiedIssue = new RegExp(
    `\\b(?:alguns?|diversos?|recorrentes?|frequentes?) ${paymentIssue}\\b`,
  );
  const identifiedIssue = new RegExp(
    `\\b${paymentIssue}(?: [a-z0-9]+){0,4} (?:identificad[ao]s?|constatad[ao]s?|registrad[ao]s?)\\b`,
  );

  return (
    affirmativeContext.test(affirmativeCandidate) ||
    qualifiedIssue.test(affirmativeCandidate) ||
    identifiedIssue.test(affirmativeCandidate)
  );
}

function scoreBandFor(score: number | null, providerBand: string): string {
  if (score !== null && score >= 0 && score < MINIMUM_REVIEW_SCORE) {
    return "Alto índice de inadimplência";
  }
  if (score !== null && score >= MINIMUM_REVIEW_SCORE && score < MINIMUM_APPROVAL_SCORE) {
    return "Médio índice de inadimplência";
  }
  if (score !== null && score >= MINIMUM_APPROVAL_SCORE && score <= 1000) {
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
 * recebem aprovação automática; a descrição adversa explícita é a única
 * reprovação que não depende de percentual legível.
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
        "Crédito reprovado porque o histórico de compromisso de pagamento indica atrasos ou pendências financeiras.",
    };
  }

  if (score !== null && commitmentPaymentPercentage !== null) {
    if (
      score >= MINIMUM_APPROVAL_SCORE &&
      commitmentPaymentPercentage >= MINIMUM_COMMITMENT_PAYMENT_PERCENTAGE
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
      score >= MINIMUM_REVIEW_SCORE &&
      commitmentPaymentPercentage >= MINIMUM_COMMITMENT_PAYMENT_PERCENTAGE
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
      commitmentPaymentPercentage < MINIMUM_COMMITMENT_PAYMENT_PERCENTAGE
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
        "A análise oficial precisa de conferência complementar porque os critérios de score e compromisso de pagamento não convergiram.",
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
