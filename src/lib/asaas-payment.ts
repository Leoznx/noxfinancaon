export type AsaasPaymentMethod = "pix" | "boleto" | "credit_card";

export type NormalizedAsaasPayment = {
  success: boolean;
  paymentId: string | null;
  externalReference: string | null;
  status: string;
  paymentMethod: AsaasPaymentMethod;
  amount: number;
  dueDate: string | null;
  invoiceUrl?: string | null;
  pix?: {
    qrCode: string;
    qrCodeBase64: string;
    expiresAt: string | null;
  } | null;
  boleto?: {
    barcode: string;
    pdfUrl: string;
    dueDate: string | null;
  } | null;
  recipient?: {
    responsible: "agency" | "tenant" | null;
    type: "user" | "tenant" | null;
    emailMasked: string | null;
    phoneMasked: string | null;
  } | null;
};

type EdgeFunctionErrorPayload = {
  error?: unknown;
  message?: unknown;
};

/**
 * Extrai a mensagem enviada pela Edge Function. O cliente do Supabase usa uma
 * mensagem generica para respostas HTTP 4xx/5xx, mas preserva o Response real
 * em `context`; sem esta leitura o usuario nao descobre o que precisa corrigir.
 */
export async function getEdgeFunctionErrorMessage(
  error: unknown,
  fallback: string,
): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context;

  if (context instanceof Response) {
    try {
      const payload = (await context.clone().json()) as EdgeFunctionErrorPayload;
      const detail = payload.error ?? payload.message;
      if (typeof detail === "string" && detail.trim()) return detail.trim();
    } catch {
      // A resposta pode nao ser JSON; nesse caso usamos a mensagem original.
    }
  }

  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return fallback;
}

/**
 * Igual a `getEdgeFunctionErrorMessage`, mas devolve tambem o corpo JSON da
 * resposta. O 409 de valor divergente traz `expectedAmount`, e sem ele a tela
 * nao tem como explicar quanto o backend espera cobrar.
 */
export async function getEdgeFunctionErrorDetails(
  error: unknown,
  fallback: string,
): Promise<{ message: string; payload: Record<string, unknown> | null; status: number | null }> {
  const context = (error as { context?: unknown } | null)?.context;
  let payload: Record<string, unknown> | null = null;
  let status: number | null = null;

  if (context instanceof Response) {
    status = context.status;
    try {
      payload = (await context.clone().json()) as Record<string, unknown>;
    } catch {
      payload = null;
    }
  }

  const detail = payload?.error ?? payload?.message;
  if (typeof detail === "string" && detail.trim()) {
    return { message: detail.trim(), payload, status };
  }
  if (error instanceof Error && error.message.trim()) {
    return { message: error.message.trim(), payload, status };
  }
  return { message: fallback, payload, status };
}

export function statusPagamentoLabel(status?: string | null) {
  const labels: Record<string, string> = {
    pending: "Aguardando pagamento",
    risk_analysis: "Em analise",
    approved: "Aprovado",
    // confirmed/paid/paid_via_consolidated aparecem todos como "Pago" pro
    // usuario - a distincao interna (PAYMENT_CONFIRMED vs PAYMENT_RECEIVED vs
    // quitado via boleto consolidado) fica preservada na coluna status, so a
    // rotulagem visual e unificada.
    confirmed: "Pago",
    paid: "Pago",
    paid_via_consolidated: "Pago por boleto consolidado",
    refused: "Cartao recusado",
    overdue: "Vencida",
    cancelled: "Cancelada",
    refunded: "Estornada",
    partially_refunded: "Estornada parcialmente",
    refund_processing: "Estorno em processamento",
    refund_denied: "Estorno negado",
    chargeback: "Chargeback solicitado",
    chargeback_dispute: "Chargeback em disputa",
  };
  return labels[status || ""] || "Aguardando pagamento";
}

export function isPagamentoConcluido(status?: string | null) {
  return status === "confirmed" || status === "paid" || status === "paid_via_consolidated";
}

export const MESES_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export type ParcelaPreview = {
  installmentNumber: number;
  dueDate: string;
  referenceMonth: number;
  referenceYear: number;
};

// So para pre-visualizacao no frontend antes de confirmar - o backend
// (asaas-create-installment-plan) recalcula tudo de novo, e' a fonte de
// verdade. Mesma logica de generateInstallmentSchedule do
// supabase/functions/_shared/asaas.ts (duplicada porque Edge Functions Deno
// e o bundle do navegador nao compartilham modulo).
export function generateInstallmentSchedulePreview(params: {
  firstDueDate: string; // yyyy-mm-dd
  count: number;
}): ParcelaPreview[] {
  const [y0, m0, d0] = params.firstDueDate.split("-").map(Number);
  const items: ParcelaPreview[] = [];
  for (let i = 0; i < params.count; i++) {
    const offsetIndex = m0 - 1 + i;
    const year = y0 + Math.floor(offsetIndex / 12);
    const month = (offsetIndex % 12) + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const day = Math.min(d0, lastDay);
    items.push({
      installmentNumber: i + 1,
      dueDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      referenceMonth: month,
      referenceYear: year,
    });
  }
  return items;
}

export function formatDateBr(isoDate: string) {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

export function addBusinessDaysPreview(days: number) {
  const date = new Date();
  let added = 0;
  while (added < days) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return date.toISOString().slice(0, 10);
}
