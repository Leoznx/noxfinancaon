export type AsaasPaymentMethod = "pix" | "boleto" | "credit_card";

export type CheckoutIntent = "pay_now" | "pay_later";
export type CardSetupMode = "direct" | "checkout";
export type PaymentFlowStatus =
  | "pending"
  | "overdue"
  | "confirmed"
  | "cancelled"
  | "refunded"
  | "awaiting_consolidation";
export type SignatureFlowStatus = "pending" | "sent" | "signed" | "error";
export type PolicyFlowStatus = "draft" | "issued_pending" | "active" | "cancelled";
export type NotificationDeliveryStatus = "queued" | "sent" | "failed" | "skipped";

export type NotificationDelivery = {
  status: NotificationDeliveryStatus;
  sentAt?: string | null;
  error?: string | null;
};

export type PaymentRecipient = {
  responsible: "agency" | "tenant" | null;
  type: "user" | "tenant" | null;
  userId?: string | null;
  tenantId?: string | null;
  name?: string | null;
  emailMasked: string | null;
  phoneMasked: string | null;
};

export type PaymentNotifications = {
  email: NotificationDelivery;
  whatsapp: NotificationDelivery;
};

export type NormalizedAsaasPayment = {
  success: boolean;
  paymentId: string | null;
  localPaymentId?: string | null;
  invoiceId?: string | null;
  externalReference: string | null;
  status: string;
  paymentStatus?: PaymentFlowStatus;
  paymentMethod: AsaasPaymentMethod;
  amount: number;
  dueDate: string | null;
  invoiceUrl?: string | null;
  deferPayment?: boolean;
  signatureStatus?: SignatureFlowStatus;
  policyStatus?: PolicyFlowStatus;
  selectedFireInsuranceMode?: "avista" | "embutido" | null;
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
  recipient?: PaymentRecipient | null;
  notifications?: PaymentNotifications | null;
};

export type NormalizedAsaasSubscription = {
  success: boolean;
  mode: CardSetupMode;
  localSubscriptionId: string;
  subscriptionId: string | null;
  checkoutId: string | null;
  checkoutUrl: string | null;
  initialCheckoutStatus: "pending" | "paid" | "cancelled" | "expired" | "error";
  checkoutStatus: "pending" | "paid" | "cancelled" | "expired" | "error";
  status: "pending" | "active" | "suspended" | "cancelled" | "error";
  cardRegistrationStatus: "not_required" | "awaiting_card" | "registered" | "failed";
  paymentStatus: "pending" | "processing" | "confirmed" | "failed" | "awaiting_initial_payment";
  initialAmount: number;
  monthlyAmount: number;
  nextDueDate: string | null;
  selectedFireInsuranceMode?: "avista" | "embutido" | null;
  initialPayment: {
    paymentId: string | null;
    invoiceId: string | null;
    status: string;
    invoiceUrl: string | null;
    pix?: NormalizedAsaasPayment["pix"];
    boleto?: NormalizedAsaasPayment["boleto"];
  } | null;
  split: {
    required: boolean;
    reason?: string;
    initialPaymentUrl?: string | null;
  };
  recipient?: PaymentRecipient | null;
  notifications?: PaymentNotifications | null;
};

export function checkoutActionsForMethod(method: AsaasPaymentMethod | "") {
  return {
    canPayNow: method === "pix" || method === "boleto" || method === "credit_card",
    canPayLater: method === "pix" || method === "boleto",
  };
}

export function isReissuablePaymentStatus(status: unknown) {
  return ["pending", "processing", "overdue", "risk_analysis", "approved"].includes(
    String(status || "").toLowerCase(),
  );
}

export function shouldCollectCardData(mode: CardSetupMode | null) {
  return mode === "direct";
}

export function hasIncompleteInstallmentPlan(
  invoices: Array<{
    id?: string | null;
    billing_key?: string | null;
    charge_kind?: string | null;
    installment_total?: number | string | null;
    payment_method?: string | null;
    components?: { contractMonths?: number | string | null } | null;
  }>,
) {
  const initial = invoices.find(
    (invoice) =>
      invoice.charge_kind === "initial" ||
      String(invoice.billing_key || "").includes(":initial:"),
  );
  if (!initial || (initial.payment_method !== "pix" && initial.payment_method !== "boleto")) {
    return false;
  }
  const expected = Number(initial.installment_total || initial.components?.contractMonths || 0);
  if (expected <= 1) return false;
  const materialized = new Set(
    invoices
      .filter(
        (invoice) =>
          invoice.charge_kind === "initial" ||
          invoice.charge_kind === "monthly" ||
          String(invoice.billing_key || "").includes(":initial:") ||
          String(invoice.billing_key || "").includes(":monthly:"),
      )
      .map((invoice) => invoice.billing_key || invoice.id),
  ).size;
  return materialized < expected;
}

export function paymentLink(resultado: NormalizedAsaasPayment | null | undefined) {
  if (!resultado) return null;
  return resultado.invoiceUrl || resultado.boleto?.pdfUrl || null;
}

export function policyStatusLabel(status?: PolicyFlowStatus | null) {
  const labels: Record<PolicyFlowStatus, string> = {
    draft: "Rascunho",
    issued_pending: "Emitida, aguardando requisitos",
    active: "Ativa",
    cancelled: "Cancelada",
  };
  return status ? labels[status] : "Rascunho";
}

export function signatureStatusLabel(status?: SignatureFlowStatus | null) {
  const labels: Record<SignatureFlowStatus, string> = {
    pending: "Pendente",
    sent: "Enviada",
    signed: "Assinada",
    error: "Falha no envio",
  };
  return status ? labels[status] : "Pendente";
}

export function subscriptionStatusLabel(status?: NormalizedAsaasSubscription["status"] | null) {
  const labels: Record<NormalizedAsaasSubscription["status"], string> = {
    pending: "Pendente",
    active: "Ativa",
    suspended: "Suspensa",
    cancelled: "Cancelada",
    error: "Com erro",
  };
  return status ? labels[status] : "Pendente";
}

export function cardRegistrationStatusLabel(
  status?: NormalizedAsaasSubscription["cardRegistrationStatus"] | null,
) {
  const labels: Record<NormalizedAsaasSubscription["cardRegistrationStatus"], string> = {
    not_required: "Cartão processado diretamente",
    awaiting_card: "Aguardando cadastro do cartão",
    registered: "Cartão cadastrado e autorizado",
    failed: "Cadastro do cartão não concluído",
  };
  return status ? labels[status] : "Aguardando cadastro do cartão";
}

type EdgeFunctionErrorPayload = {
  error?: unknown;
  message?: unknown;
};

function edgeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message.trim();
  return "";
}

function hasResponseContext(error: unknown): boolean {
  const context = (error as { context?: unknown } | null)?.context;
  return typeof Response !== "undefined" && context instanceof Response;
}

/**
 * O SDK diferencia uma resposta HTTP recusada de uma desconexao antes da
 * resposta. Essa deteccao evita exibir a mensagem tecnica em ingles ao usuario.
 */
export function isEdgeFunctionNetworkError(error: unknown): boolean {
  if (!error || hasResponseContext(error)) return false;
  const message = edgeErrorMessage(error);
  return /failed to send a request to the edge function|failed to fetch|network request failed|networkerror|load failed|timed?\s*out|aborterror/i.test(
    message,
  );
}

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

  if (isEdgeFunctionNetworkError(error)) return fallback;
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
  if (isEdgeFunctionNetworkError(error)) {
    return { message: fallback, payload, status };
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
  return (
    status === "confirmed" ||
    status === "paid" ||
    status === "received" ||
    status === "received_in_cash" ||
    status === "paid_via_consolidated"
  );
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
