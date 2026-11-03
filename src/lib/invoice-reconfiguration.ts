import { supabase } from "@/integrations/supabase/client";
import { getEdgeFunctionErrorMessage } from "@/lib/asaas-payment";
import type { PaymentDueDay } from "@/lib/payment-due-date";

export type ReconfigurablePaymentMethod = "boleto" | "pix";

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
  "processing",
  "risk_analysis",
  "approved",
  "confirmed",
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
      ["boleto", "pix"].includes(String(params.method || "").toLowerCase()),
  );
}

export async function reconfigureInvoice(params: {
  invoiceId: string;
  paymentMethod: ReconfigurablePaymentMethod;
  billingDueDay: PaymentDueDay;
}) {
  const { data, error } = await supabase.functions.invoke<InvoiceReconfigurationResult>(
    "asaas-manage-payment",
    {
      body: {
        invoiceId: params.invoiceId,
        action: "reissue",
        paymentMethod: params.paymentMethod,
        billingDueDay: params.billingDueDay,
      },
    },
  );
  if (error) {
    throw new Error(
      await getEdgeFunctionErrorMessage(
        error,
        "Não foi possível alterar esta cobrança.",
      ),
    );
  }
  return data;
}
