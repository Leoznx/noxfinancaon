export type WhatsappBillingMethod = "boleto" | "pix";

export type WhatsappBillingCandidate = {
  actorId: string;
  invoiceId?: string;
  batchId?: string;
  dueDate: string;
};

function normalizedText(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseWhatsappBillingCommand(
  value: string | null | undefined,
): WhatsappBillingMethod | null {
  const text = normalizedText(value);
  if (!text) return null;
  if (/\bpix\b/.test(text)) return "pix";
  if (
    /\bboleto\b/.test(text) ||
    /\bsegunda via\b/.test(text) ||
    /\b2 via\b/.test(text) ||
    /\bcobranca atualizada\b/.test(text)
  ) return "boleto";
  return null;
}

export function receivedWhatsappText(payload: Record<string, unknown>) {
  const text = payload.text;
  if (typeof text === "string") return text.trim();
  if (text && typeof text === "object") {
    const message = (text as Record<string, unknown>).message;
    if (typeof message === "string") return message.trim();
  }
  return "";
}

export function selectWhatsappBillingCandidate(
  candidates: WhatsappBillingCandidate[],
): {
  candidate: WhatsappBillingCandidate | null;
  reason?: "not_found" | "ambiguous_phone";
} {
  if (!candidates.length) return { candidate: null, reason: "not_found" };
  const actorIds = new Set(candidates.map((candidate) => candidate.actorId));
  if (actorIds.size !== 1) {
    return { candidate: null, reason: "ambiguous_phone" };
  }

  const ordered = [...candidates].sort((left, right) => {
    const leftBatch = left.batchId ? 0 : 1;
    const rightBatch = right.batchId ? 0 : 1;
    if (leftBatch !== rightBatch) return leftBatch - rightBatch;
    return left.dueDate.localeCompare(right.dueDate);
  });
  return { candidate: ordered[0] };
}
