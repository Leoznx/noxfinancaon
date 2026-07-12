import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, jsonResponse, requireUser } from "../_shared/asaas.ts";
import { ensureAsaasCustomer } from "../_shared/asaas-customer.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST")
    return jsonResponse(req, { ok: false, error: "Metodo nao permitido." }, 405);

  try {
    const { supabase, user } = await requireUser(req);
    const body = await req.json();
    const consultationId = body?.consultationId || body?.proposalId;
    if (!consultationId)
      return jsonResponse(req, { ok: false, error: "Proposta nao encontrada." }, 400);

    const { data: consulta, error } = await supabase
      .from("consultas_credito")
      .select("*, inquilinos(*), imoveis(*)")
      .eq("id", consultationId)
      .maybeSingle();
    if (error) throw error;
    if (!consulta) return jsonResponse(req, { ok: false, error: "Proposta nao encontrada." }, 404);

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    const role = profile?.role;
    const allowed =
      consulta.profile_id_solicitante === user.id ||
      consulta.tenant_user_id === user.id ||
      consulta.billing_responsible_user_id === user.id ||
      ["admin", "financeiro", "corretor", "imobiliaria"].includes(role);

    if (!allowed) return jsonResponse(req, { ok: false, error: "Acesso nao autorizado." }, 403);

    const customerId = await ensureAsaasCustomer(supabase, consulta);
    return jsonResponse(req, { ok: true, customerId });
  } catch (error) {
    console.error("[asaas-create-customer] erro", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(
      req,
      { ok: false, error: "Nao foi possivel preparar o cliente para pagamento." },
      500,
    );
  }
});
