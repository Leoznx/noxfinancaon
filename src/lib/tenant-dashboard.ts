import { supabase } from "@/integrations/supabase/client";
import {
  mergeTenantBillingItems,
  type TenantBillingConsultation,
  type TenantBillingItem,
  type TenantInvoiceSource,
  type TenantPaymentSource,
} from "@/lib/tenant-billing";

export type TenantContractSignature = {
  id: string;
  consultation_id: string;
  policy_id: string | null;
  plan_name: string;
  status: string;
  sent_at: string | null;
  signed_at: string | null;
  activated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TenantConsultation = TenantBillingConsultation & {
  status: string;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  contract_accepted_at: string | null;
  activation_completed_at: string | null;
  activation_status: string | null;
};

export type TenantPolicy = {
  id: string;
  consulta_id: string;
  numero: string;
  status: string;
  vigencia_inicio: string;
  vigencia_fim: string;
  created_at: string;
  updated_at: string;
};

export type TenantDashboardDocument = {
  id: string;
  consulta_id: string | null;
  file_name: string;
  file_url: string;
  file_type: string | null;
  document_type: string | null;
  document_subtype: string | null;
  created_at: string;
  updated_at: string;
};

export type TenantDashboardData = {
  consultation: TenantConsultation | null;
  consultations: TenantConsultation[];
  signature: TenantContractSignature | null;
  policy: TenantPolicy | null;
  documents: TenantDashboardDocument[];
  invoices: TenantBillingItem[];
};

const CONSULTATION_SELECT =
  "id, status, created_at, updated_at, approved_at, contract_accepted_at, activation_completed_at, activation_status, payment_type, insurance_payment_method, imovel:imoveis(endereco, cidade, estado), plano:planos(nome)";

const DOCUMENT_BUCKETS = [
  "contratos-assinados",
  "approval-documents",
  "anexos",
  "documentos-proposta",
];

export const TENANT_OPEN_INVOICE_STATUSES = new Set([
  "pending",
  "overdue",
  "risk_analysis",
  "approved",
]);

export const TENANT_PAID_INVOICE_STATUSES = new Set(["paid", "confirmed", "paid_via_consolidated"]);

export function isTenantInvoiceOpen(status: string | null | undefined) {
  return TENANT_OPEN_INVOICE_STATUSES.has(status || "");
}

export function isTenantInvoicePaid(status: string | null | undefined) {
  return TENANT_PAID_INVOICE_STATUSES.has(status || "");
}

export async function fetchTenantDashboard(
  userId: string,
  email?: string | null,
): Promise<TenantDashboardData> {
  const [byUser, byEmail] = await Promise.all([
    supabase.from("consultas_credito").select(CONSULTATION_SELECT).eq("tenant_user_id", userId),
    email
      ? supabase.from("consultas_credito").select(CONSULTATION_SELECT).ilike("tenant_email", email)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (byUser.error) throw byUser.error;
  if (byEmail.error) throw byEmail.error;

  const consultations = Array.from(
    new Map(
      [...(byUser.data ?? []), ...(byEmail.data ?? [])].map((item: any) => [item.id, item]),
    ).values(),
  )
    .map((item: any) => ({
      ...item,
      imovel: Array.isArray(item.imovel) ? (item.imovel[0] ?? null) : item.imovel,
      plano: Array.isArray(item.plano) ? (item.plano[0] ?? null) : item.plano,
    }))
    .sort(
      (a: any, b: any) =>
        new Date(b.updated_at || b.created_at).getTime() -
        new Date(a.updated_at || a.created_at).getTime(),
    ) as TenantConsultation[];

  const consultationIds = consultations.map((item) => item.id);
  const signatureQuery = (supabase as any)
    .from("contract_signatures")
    .select(
      "id, consultation_id, policy_id, plan_name, status, sent_at, signed_at, activated_at, created_at, updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(1);
  const signatureResult = consultationIds.length
    ? await signatureQuery.in("consultation_id", consultationIds)
    : await signatureQuery.eq("tenant_user_id", userId);
  if (signatureResult.error) throw signatureResult.error;
  const signature = (signatureResult.data?.[0] ?? null) as TenantContractSignature | null;

  const preferredConsultation =
    consultations.find((item) => item.id === signature?.consultation_id) ??
    consultations[0] ??
    null;

  const [policyResult, documentsResult, invoiceResult, paymentResult] = await Promise.all([
    signature?.policy_id
      ? supabase
          .from("apolices")
          .select(
            "id, consulta_id, numero, status, vigencia_inicio, vigencia_fim, created_at, updated_at",
          )
          .eq("id", signature.policy_id)
          .maybeSingle()
      : consultationIds.length
        ? supabase
            .from("apolices")
            .select(
              "id, consulta_id, numero, status, vigencia_inicio, vigencia_fim, created_at, updated_at",
            )
            .in("consulta_id", consultationIds)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    consultationIds.length
      ? supabase
          .from("documentos_proposta")
          .select(
            "id, consulta_id, file_name, file_url, file_type, document_type, document_subtype, created_at, updated_at",
          )
          .in("consulta_id", consultationIds)
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    consultationIds.length
      ? (supabase as any)
          .from("faturas_inquilino")
          .select(
            "id, consulta_id, asaas_payment_id, numero_parcela, installment_total, vencimento, valor, status, pago_em, boleto_url, linha_digitavel",
          )
          .in("consulta_id", consultationIds)
      : Promise.resolve({ data: [], error: null }),
    consultationIds.length
      ? (supabase as any)
          .from("asaas_payments")
          .select(
            "id, consultation_id, asaas_payment_id, payment_method, status, value, due_date, confirmed_at, received_at, pix_qr_code, pix_copy_paste, pix_expires_at, boleto_url, boleto_barcode, external_reference",
          )
          .in("consultation_id", consultationIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (policyResult.error) throw policyResult.error;
  if (documentsResult.error) throw documentsResult.error;
  if (invoiceResult.error) throw invoiceResult.error;
  if (paymentResult.error) throw paymentResult.error;

  const invoices = mergeTenantBillingItems(
    consultations,
    (invoiceResult.data ?? []) as TenantInvoiceSource[],
    (paymentResult.data ?? []) as TenantPaymentSource[],
  );

  return {
    consultation: preferredConsultation,
    consultations,
    signature,
    policy: (policyResult.data ?? null) as TenantPolicy | null,
    documents: (documentsResult.data ?? []) as TenantDashboardDocument[],
    invoices,
  };
}

export async function resolveTenantDashboardDocumentUrl(document: TenantDashboardDocument) {
  if (/^https?:\/\//.test(document.file_url)) return document.file_url;
  const hinted = document.document_subtype;
  const buckets = hinted
    ? [hinted, ...DOCUMENT_BUCKETS.filter((bucket) => bucket !== hinted)]
    : DOCUMENT_BUCKETS;
  for (const bucket of buckets) {
    const { data } = await supabase.storage.from(bucket).createSignedUrl(document.file_url, 300);
    if (data?.signedUrl) return data.signedUrl;
  }
  return null;
}
