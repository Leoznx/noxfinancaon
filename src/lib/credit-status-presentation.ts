export type CreditStatusPresentation =
  | "aprovado"
  | "recusado"
  | "em_analise"
  | "falta_documentos"
  | "erro"
  | "requer_verificacao"
  | "cancelada"
  | "aguardando_autenticacao"
  | "aguardando_servico_externo"
  | "aguardando_resultado"
  | "processando"
  | "pendente";

export type CreditStatusPresentationRow = {
  status?: string | null;
  resultado?: string | null;
  substatus?: string | null;
  technical_status?: string | null;
  automation_step?: string | null;
};

function normalizeStatus(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Resolve somente o estado apresentado ao usuário. `resultado` continua sendo
 * reservado para decisões reais do provedor. Estados operacionais da fila nunca
 * viram "Em análise": cada um é apresentado com o estado real gravado pelo worker.
 */
export function resolveCreditStatusPresentation(
  row: CreditStatusPresentationRow,
): CreditStatusPresentation {
  const status = normalizeStatus(row.status);
  const resultado = normalizeStatus(row.resultado);
  const substatus = normalizeStatus(row.substatus);
  const technicalStatus = normalizeStatus(row.technical_status);
  const automationStep = normalizeStatus(row.automation_step);

  const decision = ["aprovado", "recusado", "reprovado", "em_analise"].includes(resultado)
    ? resultado
    : status;

  if (decision === "em_analise" && substatus === "falta_documentos") {
    return "falta_documentos";
  }
  if (decision === "aprovado") return "aprovado";
  if (decision === "recusado" || decision === "reprovado") return "recusado";
  if (decision === "em_analise") return "em_analise";

  if (technicalStatus === "cancelled" || status === "cancelada") return "cancelada";
  if (technicalStatus === "requires_verification" || status === "requer_verificacao") {
    return "requer_verificacao";
  }
  if (technicalStatus === "technical_failure" || status === "erro") return "erro";

  if (automationStep === "aguardando_autenticacao") return "aguardando_autenticacao";
  if (automationStep === "aguardando_liberacao_parceiro") {
    return "aguardando_servico_externo";
  }
  if (automationStep === "aguardando_resultado" || technicalStatus === "waiting_provider") {
    return "aguardando_resultado";
  }
  if (
    technicalStatus === "processing" ||
    status === "processando" ||
    ["abrindo", "preenchendo", "enviando"].includes(automationStep)
  ) {
    return "processando";
  }
  if (
    !status ||
    status === "pendente" ||
    ["received", "queued"].includes(technicalStatus) ||
    automationStep === "recuperada_automaticamente"
  ) {
    return "pendente";
  }

  // Etapas posteriores da proposta só existem depois de uma aprovação. Mantém
  // compatibilidade com registros legados que não preencheram `resultado`.
  return "aprovado";
}
