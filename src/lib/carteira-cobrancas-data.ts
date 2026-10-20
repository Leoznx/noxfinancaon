import { loadBillingScope, readBillingRows, type BillingScopeUser } from "@/lib/billing-scope";
import {
  fetchOwnConsolidatedBatches,
  type ConsolidatedBillingBatch,
} from "@/lib/automated-billing";
import { loadSessionResource, peekSessionResource } from "@/lib/session-resource-cache";

export type CarteiraCobrancasData = {
  faturas: any[];
  batches: ConsolidatedBillingBatch[];
};

const keyFor = (userId: string, isAgency: boolean) =>
  `dashboard-route:${userId}:carteira-cobrancas:${isAgency ? "agency" : "other"}`;

export function peekCarteiraCobrancas(userId: string, isAgency: boolean) {
  return peekSessionResource<CarteiraCobrancasData>(keyFor(userId, isAgency));
}

export function loadCarteiraCobrancas(user: BillingScopeUser, force = false) {
  return loadSessionResource(
    keyFor(user.id, user.role === "imobiliaria"),
    async (): Promise<CarteiraCobrancasData> => {
      const scope = await loadBillingScope(user, force);
      const [invoiceRows, batchRows, subscriptionRows] = await Promise.all([
        readBillingRows(
          scope,
          "faturas_inquilino",
          `
            id, consulta_id, status, valor, vencimento, numero_parcela,
            payment_method, payment_responsible, payment_url, boleto_url,
            linha_digitavel, consolidated_item_id, recipient_user_id,
            installment_total, confirmed_at,
            consulta:consultas_credito(
              id, tenant_name,
              inquilino:inquilinos(nome, cpf, cnpj, razao_social),
              imovel:imoveis(endereco, cidade, estado)
            ),
            asaas_payment:asaas_payments(id, asaas_payment_id, payment_method, confirmed_at, received_at),
            notifications:financial_notifications(id)
          `,
        ),
        user.role === "imobiliaria" ? fetchOwnConsolidatedBatches() : Promise.resolve([]),
        readBillingRows(
          scope,
          "asaas_subscriptions",
          "id, consultation_id, asaas_subscription_id, status, card_registration_status, initial_checkout_status, checkout_status, checkout_url, mode, fire_insurance_payment_mode, initial_amount, monthly_amount, created_at",
        ),
      ]);

      const subscriptions = new Map<string, any>();
      for (const subscription of subscriptionRows.sort((a, b) =>
        String(b.created_at).localeCompare(String(a.created_at)),
      )) {
        if (!subscriptions.has(subscription.consultation_id)) {
          subscriptions.set(subscription.consultation_id, subscription);
        }
      }
      return {
        faturas: invoiceRows
          .sort((a, b) => a.numero_parcela - b.numero_parcela)
          .map((invoice: any) => ({
            ...invoice,
            asaas_subscription: subscriptions.get(invoice.consulta_id) || null,
          })),
        batches: batchRows,
      };
    },
    { force, maxAgeMs: 45_000 },
  );
}
