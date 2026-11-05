import type { ZApiButtonAction } from "./zapi.ts";

export const CONTRACT_AUTOMATION_ADMIN_PHONE = "5547999614166";

export type AdminCreditReviewDecision = "aprovado" | "recusado";

export type AdminCreditReviewAction = {
  consultationId: string;
  decision: AdminCreditReviewDecision;
  providerMessageId: string;
  referenceMessageId: string | null;
};

function cleanText(value: unknown, fallback: string) {
  const text = String(value || "")
    .replace(/\s+/gu, " ")
    .trim();
  return text || fallback;
}

function moneyBr(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Não informado";
  return number.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function buildAdminCreditReviewContent(params: {
  consultationId: string;
  tenantName?: string | null;
  rentValue?: number | string | null;
}) {
  const tenantName = cleanText(params.tenantName, "Inquilino não informado");
  const approveId = `nox-review:aprovado:${params.consultationId}`;
  const rejectId = `nox-review:recusado:${params.consultationId}`;
  const buttonActions: ZApiButtonAction[] = [
    { id: rejectId, type: "REPLY", label: "Reprovar" },
    { id: approveId, type: "REPLY", label: "Aprovar" },
  ];
  return {
    title: "NOX Fiança • Avaliação documental",
    message: [
      "Nova documentação enviada para avaliação administrativa.",
      "",
      `Inquilino: *${tenantName}*`,
      `Valor do aluguel: *${moneyBr(params.rentValue)}*`,
      "",
      "Confira os dois relatórios em PDF enviados acima e escolha a decisão.",
    ].join("\n"),
    buttonActions,
  };
}

export function buildRequesterDecisionMessage(params: {
  tenantName?: string | null;
  rentValue?: number | string | null;
  decision: AdminCreditReviewDecision;
}) {
  return [
    `Inquilino: ${cleanText(params.tenantName, "Inquilino não informado")}`,
    `Valor do aluguel: ${moneyBr(params.rentValue)}`,
    `Status: ${params.decision === "aprovado" ? "APROVADO" : "RECUSADO"}`,
  ].join("\n");
}

function objectValue(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function receivedWhatsappButtonId(payload: Record<string, unknown>) {
  const buttonResponse = objectValue(payload.buttonsResponseMessage);
  const listResponse = objectValue(payload.listResponseMessage);
  const quickReply = objectValue(payload.quickReplyButton);
  const candidates = [
    buttonResponse?.buttonId,
    listResponse?.selectedRowId,
    quickReply?.id,
    payload.buttonId,
  ];
  return candidates.map((value) => String(value || "").trim()).find(Boolean) || "";
}

export function parseAdminCreditReviewAction(
  payload: Record<string, unknown>,
): AdminCreditReviewAction | null {
  if (
    String(payload.type || "") !== "ReceivedCallback" ||
    payload.fromMe === true ||
    payload.isGroup === true
  ) {
    return null;
  }
  const buttonId = receivedWhatsappButtonId(payload);
  const match = buttonId.match(
    /^nox-review:(aprovado|recusado):([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  );
  if (!match) return null;
  return {
    decision: match[1].toLowerCase() as AdminCreditReviewDecision,
    consultationId: match[2].toLowerCase(),
    providerMessageId: String(payload.messageId || payload.zaapId || payload.id || "").trim(),
    referenceMessageId: String(payload.referenceMessageId || "").trim() || null,
  };
}

export function safePdfFileName(value: string, fallback: string) {
  const normalized = cleanText(value, fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._ -]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 100)
    .replace(/^-|-$/g, "");
  const base = normalized || fallback;
  return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
}
