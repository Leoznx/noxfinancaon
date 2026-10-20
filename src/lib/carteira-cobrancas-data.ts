import { supabase } from "@/integrations/supabase/client";
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

export function loadCarteiraCobrancas(userId: string, isAgency: boolean, force = false) {
  return loadSessionResource(
    keyFor(userId, isAgency),
    async (): Promise<CarteiraCobrancasData> => {
      const [invoiceResult, batchRows, subscriptionResult] = await Promise.all([
        supabase
          .from("faturas_inquilino")
          .select(
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
          )
          .order("numero_parcela", { ascending: true }),
        isAgency ? fetchOwnConsolidatedBatches() : Promise.resolve([]),
        (supabase as any)
          .from("asaas_subscriptions")
          .select(
            "id, consultation_id, asaas_subscription_id, status, card_registration_status, initial_checkout_status, checkout_status, checkout_url, mode, fire_insurance_payment_mode, initial_amount, monthly_amount, created_at",
          )
          .order("created_at", { ascending: false }),
      ]);
      if (invoiceResult.error) throw invoiceResult.error;
      if (subscriptionResult.error) throw subscriptionResult.error;

      const subscriptions = new Map<string, any>();
      for (const subscription of subscriptionResult.data ?? []) {
        if (!subscriptions.has(subscription.consultation_id)) {
          subscriptions.set(subscription.consultation_id, subscription);
        }
      }
      return {
        faturas: (invoiceResult.data ?? []).map((invoice: any) => ({
          ...invoice,
          asaas_subscription: subscriptions.get(invoice.consulta_id) || null,
        })),
        batches: batchRows,
      };
    },
    { force, maxAgeMs: 45_000 },
  );
}
