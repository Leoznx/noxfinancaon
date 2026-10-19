import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, HttpError, jsonResponse, requireUser } from "../_shared/asaas.ts";
import { ensureAsaasCustomer } from "../_shared/asaas-customer.ts";
import { assertCanManageConsultationBilling } from "../_shared/billing-auth.ts";

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

    // Substitui o antigo allowlist por role (que concedia a QUALQUER corretor ou
    // imobiliaria) pelo helper que amarra ownership direto + imobiliaria dona do
    // corretor da proposta + roles financeiros globais. Mesma politica usada
    // pelas demais funcoes financeiras.
    await assertCanManageConsultationBilling(supabase, user.id, consulta);

    const customerId = await ensureAsaasCustomer(supabase, consulta);
    return jsonResponse(req, { ok: true, customerId });
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse(req, { ok: false, error: error.message }, error.status);
    }
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
