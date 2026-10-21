import { isPagamentoConcluido } from "@/lib/asaas-payment";
import { loadBillingScope, readBillingRows, type BillingScopeUser } from "@/lib/billing-scope";
import { loadSessionResource, peekSessionResource } from "@/lib/session-resource-cache";
import { loadCarteiraInvoiceRows } from "@/lib/carteira-cobrancas-data";

export type CobrancaAvulsa = {
  id: string;
  consultation_id: string | null;
  asaas_payment_id: string | null;
  payment_method: string | null;
  status: string | null;
  value: number | null;
  due_date: string | null;
  pix_copy_paste: string | null;
  boleto_url: string | null;
  boleto_barcode: string | null;
  invoice_url?: string | null;
  payment_url?: string | null;
  external_reference?: string | null;
  payment_responsible?: "tenant" | "agency" | null;
  recipient_name?: string | null;
  confirmed_at?: string | null;
  received_at?: string | null;
  created_at?: string;
  consulta?: { tenant_name: string | null } | null;
};

const keyFor = (userId: string) => `dashboard-route:${userId}:cobrancas-avulsas`;
export const peekCobrancasAvulsas = (userId: string) =>
  peekSessionResource<CobrancaAvulsa[]>(keyFor(userId));

export function loadCobrancasAvulsas(user: BillingScopeUser, force = false) {
  return loadSessionResource(
    keyFor(user.id),
    async () => {
      const scope = await loadBillingScope(user, force);
      const [payments, invoices] = await Promise.all([
        readBillingRows<CobrancaAvulsa>(
          scope,
          "asaas_payments",
          "id, consultation_id, asaas_payment_id, payment_method, status, value, due_date, pix_copy_paste, boleto_url, boleto_barcode, external_reference, payment_responsible, recipient_name, confirmed_at, received_at, created_at, consulta:consultas_credito!asaas_payments_consultation_id_fkey(tenant_name)",
        ),
        loadCarteiraInvoiceRows(user, force),
      ]);
      const installmentPayments = new Set(
        invoices.map((invoice) => invoice.asaas_payment_id).filter(Boolean),
      );
      return payments
        .filter(
          (payment) =>
            !isPagamentoConcluido(payment.status) && !installmentPayments.has(payment.id),
        )
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    },
    { force, maxAgeMs: 45_000 },
  );
}
