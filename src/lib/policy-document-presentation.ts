export type PolicyDocumentLike = {
  file_url?: string | null;
  storage_path?: string | null;
  tipo?: string | null;
  document_type?: string | null;
  document_subtype?: string | null;
  contract_signature_id?: string | null;
  replacement_count?: number | null;
};

export type PolicyDocumentStatus =
  | "aguardando_assinatura"
  | "assinado"
  | "disponivel"
  | "enviado"
  | "pendente"
  | "nao_enviado";

const REPLACEABLE_DOCUMENT_TYPES = new Set([
  "contrato_locacao",
  "vistoria_imovel",
  "comprovante_residencia",
  "comprovante_residencia_imovel",
  "documento_foto",
  "documento_inquilino",
]);

const SENT_DOCUMENT_TYPES = new Set([
  "comprovante_residencia",
  "comprovante_residencia_imovel",
  "documento_foto",
  "documento_inquilino",
]);

export function policyDocumentHasFile(document: PolicyDocumentLike) {
  return Boolean(document.file_url || document.storage_path);
}

export function isSignedPolicyDocument(document: PolicyDocumentLike) {
  return ["contratos-assinados", "assinado_manual"].includes(
    String(document.document_subtype || "").toLowerCase(),
  );
}

export function policyDocumentLabel(document: PolicyDocumentLike) {
  if (document.contract_signature_id) return "Apólice - NOX";
  return null;
}

export function policyDocumentStatus(
  document: PolicyDocumentLike,
  signatureComplete = false,
): PolicyDocumentStatus {
  const hasFile = policyDocumentHasFile(document);
  if (!hasFile) {
    return ["pendente_envio", "pendente_assinatura"].includes(
      String(document.document_subtype || "").toLowerCase(),
    )
      ? "pendente"
      : "nao_enviado";
  }

  if (document.contract_signature_id) {
    return signatureComplete || isSignedPolicyDocument(document)
      ? "assinado"
      : "aguardando_assinatura";
  }

  if (["contrato_locacao", "vistoria_imovel"].includes(document.document_type || "")) {
    return "disponivel";
  }
  if (["contrato", "vistoria", "apolice"].includes(document.tipo || "")) {
    return "disponivel";
  }

  if (SENT_DOCUMENT_TYPES.has(document.document_type || "")) return "enviado";
  return "enviado";
}

export function canReplacePolicyDocumentOnce(
  document: PolicyDocumentLike,
  signatureComplete = false,
) {
  if (!policyDocumentHasFile(document) || Number(document.replacement_count || 0) >= 1) {
    return false;
  }
  if (document.contract_signature_id) {
    return !signatureComplete && !isSignedPolicyDocument(document);
  }
  return REPLACEABLE_DOCUMENT_TYPES.has(document.document_type || "");
}

export function policyDocumentReplacementPrefix(document: PolicyDocumentLike) {
  return document.contract_signature_id
    ? "apolice_nox"
    : document.document_type || "documento";
}

export function policyDocumentReplacementButtonLabel(document: PolicyDocumentLike) {
  if (document.contract_signature_id) return "Anexar Apólice assinada";
  if (
    document.document_type === "contrato_locacao" &&
    document.document_subtype === "pendente_assinatura"
  ) {
    return "Anexar contrato pronto";
  }
  return "Substituir arquivo";
}
