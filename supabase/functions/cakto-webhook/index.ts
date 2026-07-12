import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Recebe atualizações de pagamento da Cakto (pix/boleto/credit_card) e atualiza
 * public.cakto_payments. Deployado com --no-verify-jwt (ver supabase/config.toml,
 * [functions.cakto-webhook]) porque quem chama é o servidor da Cakto, não um usuário
 * logado — não existe sessão Supabase nesse request.
 *
 * Segurança: a documentação pública da Cakto não deixa claro um header de assinatura
 * HMAC para webhooks, então a autenticidade é garantida pelo segredo que NÓS mesmos
 * escolhemos e embutimos na própria URL registrada no painel da Cakto:
 *   https://<projeto>.supabase.co/functions/v1/cakto-webhook?secret=CAKTO_WEBHOOK_SECRET
 * Só quem conhece esse valor (nós) consegue registrar esse endpoint como destino —
 * então validar o query param já impede chamadas forjadas de terceiros.
 */

type StatusMapeado =
  "pago" | "aguardando_pagamento" | "recusado" | "cancelado" | "estornado" | "chargeback" | "desconhecido";

function mapearStatus(statusBruto: string | undefined | null): StatusMapeado {
  const s = (statusBruto || "").toLowerCase();
  if (s === "paid" || s === "approved") return "pago";
  if (s === "waiting_payment") return "aguardando_pagamento";
  if (s === "refused") return "recusado";
  if (s === "canceled" || s === "cancelled") return "cancelado";
  if (s === "refunded") return "estornado";
  if (s === "chargeback") return "chargeback";
  return "desconhecido";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const jsonResponse = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const webhookSecret = Deno.env.get("CAKTO_WEBHOOK_SECRET") ?? "";

  if (!supabaseUrl || !serviceRoleKey || !webhookSecret) {
    console.error(
      "[cakto-webhook] Variáveis de ambiente ausentes (SUPABASE_URL/SERVICE_ROLE_KEY/CAKTO_WEBHOOK_SECRET).",
    );
    return jsonResponse({ ok: false, error: "Configuração do backend ausente." }, 500);
  }

  // 1) Segredo via query param (mecanismo canônico — ver comentário acima).
  const url = new URL(req.url);
  const secretParam = url.searchParams.get("secret");
  // 2) Defesa extra: se a Cakto também mandar algum header próprio de segredo/assinatura,
  //    aceitamos como alternativa (não documentado publicamente, mas inofensivo checar).
  const secretHeader = req.headers.get("x-webhook-secret") || req.headers.get("x-cakto-secret");

  const autenticado = secretParam === webhookSecret || secretHeader === webhookSecret;
  if (!autenticado) {
    console.error("[cakto-webhook] Tentativa com segredo inválido ou ausente.");
    return jsonResponse({ ok: false, error: "Não autorizado." }, 401);
  }

  // Cobre as duas formas possíveis do payload: campos dentro de "data" (formato
  // documentado) ou soltos na raiz (fallback defensivo, caso algum evento não envelope).
  interface CaktoWebhookFields {
    id?: string;
    refId?: string;
    status?: string;
    paidAt?: string;
  }
  interface CaktoWebhookPayload extends CaktoWebhookFields {
    event?: string;
    data?: CaktoWebhookFields;
  }

  let payload: CaktoWebhookPayload;
  try {
    payload = (await req.json()) as CaktoWebhookPayload;
  } catch {
    return jsonResponse({ ok: false, error: "Corpo da requisição inválido (JSON esperado)." }, 400);
  }

  const evento = payload?.event;
  const dados: CaktoWebhookFields = payload?.data ?? payload;
  const caktoPaymentId: string | null = dados?.id ?? null;
  const caktoRefId: string | null = payload?.refId ?? dados?.refId ?? null;
  const statusBruto: string | undefined = dados?.status;
  const paidAt: string | null = dados?.paidAt ?? null;

  console.log("[cakto-webhook] evento recebido", {
    evento,
    caktoPaymentId,
    caktoRefId,
    statusBruto,
  });

  if (!caktoPaymentId && !caktoRefId) {
    // Provavelmente um "test webhook" do painel da Cakto — responde 200 sem tentar
    // localizar/atualizar nada, pra não falhar o teste de configuração no painel deles.
    return jsonResponse({ ok: true, ignored: true });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let query = supabaseAdmin.from("cakto_payments").select("id, status, paid_at, consultation_id");
  query = caktoPaymentId
    ? query.eq("cakto_payment_id", caktoPaymentId)
    : query.eq("cakto_ref_id", caktoRefId as string);
  const { data: existente, error: findError } = await query.maybeSingle();

  if (findError) {
    console.error("[cakto-webhook] Falha ao buscar pagamento", { error: findError.message });
    return jsonResponse({ ok: false, error: "Falha ao localizar pagamento." }, 500);
  }

  if (!existente) {
    console.error("[cakto-webhook] Pagamento não encontrado para o evento recebido", {
      caktoPaymentId,
      caktoRefId,
    });
    // 200 aqui de propósito: a Cakto reenviaria (com backoff) um webhook que não conseguimos
    // processar, mas se o pagamento simplesmente não existe no nosso banco reenviar não ajuda.
    return jsonResponse({ ok: true, ignored: true, reason: "payment_not_found" });
  }

  const statusMapeado = mapearStatus(statusBruto);
  const updatePayload: Record<string, unknown> = {
    status: statusBruto ?? existente.status,
    webhook_payload: payload,
  };
  if (statusMapeado === "pago" && !existente.paid_at) {
    updatePayload.paid_at = paidAt || new Date().toISOString();
  }

  const { error: updateError } = await supabaseAdmin
    .from("cakto_payments")
    .update(updatePayload)
    .eq("id", existente.id);
  if (updateError) {
    console.error("[cakto-webhook] Falha ao atualizar pagamento", { error: updateError.message });
    return jsonResponse({ ok: false, error: "Falha ao atualizar pagamento." }, 500);
  }

  if (existente.consultation_id) {
    const consultaPayload: Record<string, unknown> = {
      payment_status: statusMapeado,
    };
    if (statusMapeado === "pago") {
      consultaPayload.payment_confirmed_at = paidAt || new Date().toISOString();
    }

    const { error: consultaUpdateError } = await supabaseAdmin
      .from("consultas_credito")
      .update(consultaPayload)
      .eq("id", existente.consultation_id);

    if (consultaUpdateError) {
      console.error("[cakto-webhook] Falha ao atualizar status da proposta", {
        consultationId: existente.consultation_id,
        error: consultaUpdateError.message,
      });
      return jsonResponse({ ok: false, error: "Falha ao atualizar proposta." }, 500);
    }
  }

  console.log("[cakto-webhook] pagamento atualizado", {
    id: existente.id,
    statusBruto,
    statusMapeado,
  });
  return jsonResponse({ ok: true });
});
