import { HttpError } from "./asaas.ts";
import { hasDirectBillingOwnership, hasGlobalBillingRole } from "./billing-state.ts";

async function internalRole(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("get_internal_role", { _uid: userId });
  if (error) {
    console.error("[billing-auth] falha ao consultar cargo interno", {
      userId,
      message: error.message,
    });
    return null;
  }
  return data || null;
}
export async function assertHasGlobalBillingRole(supabase: any, userId: string) {
  if (!userId) throw new HttpError(403, "Acesso nao autorizado.");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  const staffRole = await internalRole(supabase, userId);
  if (hasGlobalBillingRole(profile?.role, staffRole)) return;
  throw new HttpError(
    403,
    "Somente administradores e o financeiro podem cancelar a recorrencia.",
  );
}

/**
 * Edge Functions use the service key after validating the JWT, therefore RLS
 * is not an authorization boundary. Every financial mutation must call this
 * helper with the concrete consultation it is about to mutate.
 */
export async function assertCanManageConsultationBilling(
  supabase: any,
  userId: string,
  consultation: any,
) {
  if (!userId || !consultation?.id) throw new HttpError(403, "Acesso nao autorizado.");
  if (hasDirectBillingOwnership(consultation, userId)) return;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", userId)
    .maybeSingle();
  const staffRole = await internalRole(supabase, userId);
  if (hasGlobalBillingRole(profile?.role, staffRole)) return;

  if (consultation.profile_id_solicitante) {
    const { data: agencyProfileId } = await supabase.rpc(
      "imobiliaria_profile_id_do_corretor",
      { p_profile_id_corretor: consultation.profile_id_solicitante },
    );
    if (agencyProfileId === userId) return;
  }

  throw new HttpError(403, "Acesso nao autorizado.");
}

export async function assertContractAcceptsBilling(supabase: any, consultation: any) {
  if (consultation?.policy_status === "cancelled") {
    throw new HttpError(409, "Contrato cancelado nao permite nova cobranca.");
  }
  const { data: latestPolicy, error } = await supabase
    .from("apolices")
    .select("status")
    .eq("consulta_id", consultation.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (["cancelada", "cancelled", "canceled"].includes(
    String(latestPolicy?.status || "").toLowerCase(),
  )) {
    throw new HttpError(409, "Contrato cancelado nao permite nova cobranca.");
  }
}

export async function assertCanManageInvoiceOrBatch(
  supabase: any,
  userId: string,
  target: { invoice?: any; batch?: any },
) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  const staffRole = await internalRole(supabase, userId);
  if (hasGlobalBillingRole(profile?.role, staffRole)) return;

  if (target.batch) {
    if (target.batch.agency_user_id === userId) return;
    throw new HttpError(403, "Cobranca nao pertence ao usuario.");
  }

  const invoice = target.invoice;
  if (!invoice) throw new HttpError(404, "Cobranca nao encontrada.");

  const { data: consultation } = await supabase
    .from("consultas_credito")
    .select("id, profile_id_solicitante, tenant_user_id, billing_responsible_user_id, payment_type, billing_responsible_role")
    .eq("id", invoice.consulta_id)
    .maybeSingle();
  if (consultation) {
    await assertCanManageConsultationBilling(supabase, userId, consultation);
    return;
  }
  throw new HttpError(403, "Cobranca nao pertence ao usuario.");
}
