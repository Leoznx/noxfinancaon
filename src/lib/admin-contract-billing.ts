import { supabase } from "@/integrations/supabase/client";
import { getEdgeFunctionErrorMessage } from "@/lib/asaas-payment";

export type ContractBillingStatus =
  | "reconciliation_required"
  | "awaiting_billing"
  | "awaiting_asaas"
  | "overdue"
  | "pending"
  | "paid"
  | "ready";

export interface AdminContractBillingRow {
  consultation_id: string;
  policy_id: string | null;
  contract_number: string | null;
  contract_status: string;
  policy_status: string | null;
  payment_state: string | null;
  signature_status: string | null;
  tenant_name: string | null;
  tenant_document: string | null;
  property_address: string | null;
  contract_period_months: number | null;
  payment_method: string | null;
  payment_responsible: string | null;
  asaas_subscription_id: string | null;
  subscription_status: string | null;
  invoice_count: number;
  pending_count: number;
  overdue_count: number;
  paid_count: number;
  received_cents: number;
  outstanding_cents: number;
  next_due_date: string | null;
  last_synced_at: string | null;
  billing_status: ContractBillingStatus;
}

export interface BillingReconciliationReport {
  ok: boolean;
  checkedPayments: number;
  checkedSubscriptions: number;
  synchronized: number;
  duplicated: number;
  failures: Array<{ type: string; id: string; error: string }>;
}

function missingRpc(error: { code?: string; message?: string } | null | undefined) {
  return (
    ["PGRST202", "42883"].includes(error?.code || "") ||
    /get_admin_contract_billing_overview.*(schema cache|does not exist|not find)/i.test(
      error?.message || "",
    )
  );
}

function latestIso(values: Array<string | null | undefined>) {
  return values.filter(Boolean).sort().at(-1) || null;
}

async function fallbackContractBilling(): Promise<AdminContractBillingRow[]> {
  const [consultations, policies, invoices, payments, subscriptions] = await Promise.all([
    (supabase as any)
      .from("consultas_credito")
      .select(
        "id, policy_status, payment_state, signature_status, tenant_name, tenant_document, property_address, contract_period_months, insurance_payment_method, payment_type, billing_responsible_role",
      )
      .limit(5000),
    (supabase as any)
      .from("apolices")
      .select("id, consulta_id, numero, status, vigencia_inicio, vigencia_fim, created_at")
      .order("created_at", { ascending: false })
      .limit(5000),
    (supabase as any)
      .from("faturas_inquilino")
      .select(
        "id, consulta_id, valor, status, vencimento, asaas_payment_id, consolidated_item_id, provider_event_at",
      )
      .limit(10000),
    (supabase as any)
      .from("asaas_payments")
      .select("id, consultation_id, status, provider_event_at")
      .limit(10000),
    (supabase as any)
      .from("asaas_subscriptions")
      .select(
        "id, consultation_id, asaas_subscription_id, status, payment_status, payment_responsible, next_due_date, provider_event_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(5000),
  ]);
  const firstError = [consultations, policies, invoices, payments, subscriptions].find(
    (result) => result.error,
  )?.error;
  if (firstError) throw firstError;

  const policyByConsultation = new Map<string, any>();
  for (const policy of policies.data || []) {
    if (!policyByConsultation.has(policy.consulta_id)) {
      policyByConsultation.set(policy.consulta_id, policy);
    }
  }
  const subscriptionByConsultation = new Map<string, any>();
  for (const subscription of subscriptions.data || []) {
    if (!subscriptionByConsultation.has(subscription.consultation_id)) {
      subscriptionByConsultation.set(subscription.consultation_id, subscription);
    }
  }
  const invoicesByConsultation = new Map<string, any[]>();
  for (const invoice of invoices.data || []) {
    const current = invoicesByConsultation.get(invoice.consulta_id) || [];
    current.push(invoice);
    invoicesByConsultation.set(invoice.consulta_id, current);
  }
  const paymentsByConsultation = new Map<string, any[]>();
  for (const payment of payments.data || []) {
    const current = paymentsByConsultation.get(payment.consultation_id) || [];
    current.push(payment);
    paymentsByConsultation.set(payment.consultation_id, current);
  }

  const paidStatuses = new Set(["paid", "received", "paid_via_consolidated"]);
  const openStatuses = new Set([
    "pending", "created", "waiting_payment", "processing", "risk_analysis", "approved",
    "confirmed", "overdue", "awaiting_consolidation", "scheduled",
  ]);
  return (consultations.data || [])
    .map((consultation: any): AdminContractBillingRow | null => {
      const policy = policyByConsultation.get(consultation.id) || null;
      const subscription = subscriptionByConsultation.get(consultation.id) || null;
      const contractInvoices = invoicesByConsultation.get(consultation.id) || [];
      const contractPayments = paymentsByConsultation.get(consultation.id) || [];
      const eligible =
        ["issued_pending", "active"].includes(String(consultation.policy_status || "").toLowerCase()) ||
        ["pendente", "pending", "ativa", "ativo", "active"].includes(
          String(policy?.status || "").toLowerCase(),
        ) ||
        contractInvoices.length > 0 ||
        contractPayments.length > 0 ||
        Boolean(subscription);
      if (!eligible) return null;
      const paid = contractInvoices.filter((invoice) =>
        paidStatuses.has(String(invoice.status || "").toLowerCase()),
      );
      const open = contractInvoices.filter((invoice) =>
        openStatuses.has(String(invoice.status || "").toLowerCase()),
      );
      const overdue = open.filter(
        (invoice) => String(invoice.status || "").toLowerCase() === "overdue",
      );
      const awaitingProvider = open.filter(
        (invoice) =>
          String(invoice.status || "").toLowerCase() !== "scheduled" &&
          !invoice.asaas_payment_id &&
          !invoice.consolidated_item_id,
      );
      const billingStatus: ContractBillingStatus =
        !contractInvoices.length && !contractPayments.length && !subscription
          ? "awaiting_billing"
          : awaitingProvider.length
            ? "awaiting_asaas"
            : overdue.length
              ? "overdue"
              : open.length
                ? "pending"
                : paid.length
                  ? "paid"
                  : "ready";
      return {
        consultation_id: consultation.id,
        policy_id: policy?.id || null,
        contract_number: policy?.numero || null,
        contract_status: policy?.status || consultation.policy_status || "pendente",
        policy_status: consultation.policy_status || null,
        payment_state: consultation.payment_state || null,
        signature_status: consultation.signature_status || null,
        tenant_name: consultation.tenant_name || null,
        tenant_document: consultation.tenant_document || null,
        property_address: consultation.property_address || null,
        contract_period_months: consultation.contract_period_months || null,
        payment_method: consultation.insurance_payment_method || null,
        payment_responsible:
          subscription?.payment_responsible ||
          (consultation.payment_type === "imobiliaria" ||
          consultation.billing_responsible_role === "imobiliaria"
            ? "agency"
            : "tenant"),
        asaas_subscription_id: subscription?.asaas_subscription_id || null,
        subscription_status: subscription?.status || null,
        invoice_count: contractInvoices.length,
        pending_count: open.filter((invoice) => String(invoice.status).toLowerCase() !== "overdue").length,
        overdue_count: overdue.length,
        paid_count: paid.length,
        received_cents: paid.reduce((sum, invoice) => sum + Math.round(Number(invoice.valor || 0) * 100), 0),
        outstanding_cents: open.reduce((sum, invoice) => sum + Math.round(Number(invoice.valor || 0) * 100), 0),
        next_due_date:
          open.map((invoice) => invoice.vencimento).filter(Boolean).sort()[0] ||
          subscription?.next_due_date ||
          null,
        last_synced_at: latestIso([
          ...contractInvoices.map((invoice) => invoice.provider_event_at),
          ...contractPayments.map((payment) => payment.provider_event_at),
          subscription?.provider_event_at,
        ]),
        billing_status: billingStatus,
      };
    })
    .filter((row: AdminContractBillingRow | null): row is AdminContractBillingRow => Boolean(row))
    .sort((left: AdminContractBillingRow, right: AdminContractBillingRow) =>
      left.billing_status.localeCompare(right.billing_status),
    );
}

export async function listAdminContractBilling() {
  const { data, error } = await supabase.rpc("get_admin_contract_billing_overview" as any);
  if (error) {
    if (missingRpc(error)) return fallbackContractBilling();
    throw error;
  }
  return ((data as unknown) || []) as AdminContractBillingRow[];
}

export async function reconcileAsaasBilling(consultationId?: string) {
  const { data, error } = await supabase.functions.invoke("asaas-reconcile-billing", {
    body: consultationId ? { consultationId, limit: 100 } : { limit: 60 },
  });
  if (error) {
    const message = await getEdgeFunctionErrorMessage(
      error,
      "Não foi possível conciliar com o Asaas.",
    );
    if (/asaas-reconcile-billing|not found|404|non-2xx/i.test(message)) {
      let query = (supabase as any)
        .from("asaas_payments")
        .select("asaas_payment_id, consultation_id")
        .not("asaas_payment_id", "is", null)
        .in("status", [
          "pending", "created", "waiting_payment", "processing", "risk_analysis",
          "approved", "confirmed", "overdue",
        ])
        .limit(60);
      if (consultationId) query = query.eq("consultation_id", consultationId);
      const paymentRows = await query;
      if (paymentRows.error) throw paymentRows.error;
      let synchronized = 0;
      const failures: BillingReconciliationReport["failures"] = [];
      for (const payment of paymentRows.data || []) {
        const result = await supabase.functions.invoke("asaas-get-payment", {
          body: { paymentId: payment.asaas_payment_id },
        });
        if (result.error) {
          failures.push({ type: "payment", id: payment.asaas_payment_id, error: result.error.message });
        } else synchronized += 1;
      }
      return {
        ok: true,
        checkedPayments: (paymentRows.data || []).length,
        checkedSubscriptions: 0,
        synchronized,
        duplicated: 0,
        failures,
      };
    }
    throw new Error(
      message,
    );
  }
  if (!data?.ok) throw new Error(data?.error || "Não foi possível conciliar com o Asaas.");
  return data as BillingReconciliationReport;
}

export const CONTRACT_BILLING_STATUS_LABELS: Record<ContractBillingStatus, string> = {
  reconciliation_required: "Revisão necessária",
  awaiting_billing: "Aguardando cobrança",
  awaiting_asaas: "Enviando ao Asaas",
  overdue: "Vencido",
  pending: "A receber",
  paid: "Recebido",
  ready: "Em dia",
};
