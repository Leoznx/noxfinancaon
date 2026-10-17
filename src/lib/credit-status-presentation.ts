export type CreditStatusPresentation =
  | "aprovado"
  | "recusado"
  | "em_analise"
  | "falta_documentos"
  | "erro"
  | "requer_verificacao"
  | "processando"
  | "pendente";

export type CreditStatusPresentationRow = {
  status?: string | null;
  resultado?: string | null;
  substatus?: string | null;
};

function normalizeStatus(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Resolve somente o estado apresentado ao usuário. `resultado` continua sendo
 * reservado para decisões reais da Loft; fila, indisponibilidade, timeout e
 * verificação são exibidos como "Em análise" sem alterar o registro persistido.
 */
export function resolveCreditStatusPresentation(
  row: CreditStatusPresentationRow,
): CreditStatusPresentation {
  const status = normalizeStatus(row.status);
  const resultado = normalizeStatus(row.resultado);
  const substatus = normalizeStatus(row.substatus);

  if (["pendente", "processando", "erro", "requer_verificacao"].includes(resultado)) {
    return "em_analise";
  }

  const decision = ["aprovado", "recusado", "reprovado", "em_analise"].includes(resultado)
    ? resultado
    : status;

  if (decision === "em_analise" && substatus === "falta_documentos") {
    return "falta_documentos";
  }
  if (decision === "aprovado") return "aprovado";
  if (decision === "recusado" || decision === "reprovado") return "recusado";
  if (decision === "em_analise") return "em_analise";

  if (!status || ["pendente", "processando", "erro", "requer_verificacao"].includes(status)) {
    return "em_analise";
  }

  // Etapas posteriores da proposta só existem depois de uma aprovação. Mantém
  // compatibilidade com registros legados que não preencheram `resultado`.
  return "aprovado";
}
