import { supabase } from "@/integrations/supabase/client";
import { getEdgeFunctionErrorMessage } from "@/lib/asaas-payment";
import type { PaymentDueDay } from "@/lib/payment-due-date";

export type ReconfigurablePaymentMethod = "boleto" | "pix" | "credit_card";

export const RECONFIGURABLE_PAYMENT_METHODS = [
  "boleto",
  "pix",
  "credit_card",
] as const satisfies readonly ReconfigurablePaymentMethod[];

export function reconfigurablePaymentMethodLabel(method: ReconfigurablePaymentMethod) {
  if (method === "pix") return "Pix";
  if (method === "credit_card") return "Cartão de crédito";
  return "Boleto";
}

export type InvoiceReconfigurationResult = {
  invoice?: {
    id?: string | null;
    paymentMethod?: string | null;
    dueDate?: string | null;
    paymentUrl?: string | null;
    obsoleteChargesCancelled?: number;
  } | null;
};

export const RECONFIGURABLE_INVOICE_STATUSES = new Set([
  "pending",
  "created",
  "waiting_payment",
  "risk_analysis",
  "approved",
  "overdue",
  "pendente",
  "vencido",
  "atrasado",
]);

export function canReconfigureInvoice(params: {
  invoiceId?: string | null;
  status?: string | null;
  method?: string | null;
}) {
  return Boolean(
    params.invoiceId &&
    RECONFIGURABLE_INVOICE_STATUSES.has(String(params.status || "").toLowerCase()) &&
    RECONFIGURABLE_PAYMENT_METHODS.includes(
      String(params.method || "").toLowerCase() as ReconfigurablePaymentMethod,
    ),
  );
}

export async function reconfigureInvoice(params: {
  invoiceId: string;
  paymentMethod: ReconfigurablePaymentMethod;
  billingDueDay: PaymentDueDay;
}) {
  const requestId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `billing-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  const { data, error } = await supabase.functions.invoke<InvoiceReconfigurationResult>(
    "asaas-manage-payment",
    {
      body: {
        invoiceId: params.invoiceId,
        action: "reissue",
        paymentMethod: params.paymentMethod,
        billingDueDay: params.billingDueDay,
        requestId,
      },
    },
  );
  if (error) {
    throw new Error(
      await getEdgeFunctionErrorMessage(error, "Não foi possível alterar esta cobrança."),
    );
  }
  return data;
}
