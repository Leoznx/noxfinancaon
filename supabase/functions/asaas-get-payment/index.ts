import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  asaasFetch,
  corsHeaders,
  jsonResponse,
  mapAsaasStatus,
  normalizedPaymentResponse,
  refetchPixQrCode,
  requireUser,
  sanitizeAsaasResponse,
} from "../_shared/asaas.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST")
    return jsonResponse(req, { ok: false, error: "Metodo nao permitido." }, 405);

  try {
    const { supabase, user } = await requireUser(req);
    const body = await req.json();
    const paymentId = body?.paymentId;
    const consultationId = body?.consultationId || body?.proposalId;

    let query = supabase.from("asaas_payments").select("*");
    if (paymentId) query = query.eq("asaas_payment_id", paymentId);
    else if (consultationId)
      query = query
        .eq("consultation_id", consultationId)
        .order("created_at", { ascending: false })
        .limit(1);
    else return jsonResponse(req, { ok: false, error: "Pagamento nao encontrado." }, 400);

    const { data: payment, error } = await query.maybeSingle();
    if (error) throw error;
    if (!payment) return jsonResponse(req, { ok: false, error: "Pagamento nao encontrado." }, 404);

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    const allowed =
      payment.user_id === user.id ||
      payment.tenant_user_id === user.id ||
      payment.recipient_user_id === user.id ||
      ["admin", "financeiro"].includes(profile?.role);
    if (!allowed) return jsonResponse(req, { ok: false, error: "Acesso nao autorizado." }, 403);

    let raw = payment.raw_response;
    if (payment.asaas_payment_id) {
      raw = await asaasFetch(`/payments/${payment.asaas_payment_id}`);
      const internalStatus = mapAsaasStatus(raw?.status);
      await supabase
        .from("asaas_payments")
        .update({
          status: internalStatus,
          raw_response: sanitizeAsaasResponse(raw),
        })
        .eq("id", payment.id);
      if (payment.consultation_id) {
        await supabase
          .from("consultas_credito")
          .update({
            payment_status: internalStatus,
            payment_data: sanitizeAsaasResponse(raw),
          })
          .eq("id", payment.consultation_id);
      }
      // "Atualizar status" e o fallback manual (botao) pro mesmo caminho que
      // o webhook faz sozinho - se essa cobranca for uma das 12 mensalidades,
      // sincroniza a faturas_inquilino vinculada tambem, senao o botao
      // atualizaria asaas_payments mas a tela continuaria mostrando o status
      // antigo.
      const { data: faturaVinculada } = await supabase
        .from("faturas_inquilino")
        .select("id, pago_em")
        .eq("asaas_payment_id", payment.id)
        .maybeSingle();
      if (faturaVinculada) {
        const updateFatura: Record<string, unknown> = { status: internalStatus };
        if (internalStatus === "paid" && !faturaVinculada.pago_em) {
          updateFatura.pago_em = raw?.paymentDate || raw?.clientPaymentDate || new Date().toISOString();
        }
        const { error: updateFaturaError } = await supabase
          .from("faturas_inquilino")
          .update(updateFatura)
          .eq("id", faturaVinculada.id);
        if (updateFaturaError) throw updateFaturaError;

        if (internalStatus === "paid") {
          const { error: releaseError } = await supabase.rpc("release_commissions_for_invoice", {
            p_invoice_id: faturaVinculada.id,
            p_event_id: `invoice:${faturaVinculada.id}:first-paid`,
          });
          if (releaseError) throw releaseError;
        }
      }
      payment.status = internalStatus;
      payment.raw_response = sanitizeAsaasResponse(raw);
    }

    // "Atualizar status" nunca cria outra cobranca - so consulta a existente.
    // Se for Pix e o QR Code/copia-e-cola ainda nao foram salvos (falha
    // transitoria anterior), tenta buscar de novo aqui tambem.
    const finalPayment =
      payment.payment_method === "pix" ? await refetchPixQrCode(supabase, payment) : payment;

    return jsonResponse(req, normalizedPaymentResponse(raw, finalPayment));
  } catch (error) {
    console.error("[asaas-get-payment] erro", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(
      req,
      { ok: false, error: "Nao foi possivel consultar o pagamento agora." },
      500,
    );
  }
});
