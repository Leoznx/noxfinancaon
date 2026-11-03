import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, jsonResponse, supabaseAdmin } from "../_shared/asaas.ts";
import { dispatchD4SignContract } from "../_shared/d4sign.ts";
import { hasOversizedBody, safeEqualSecret } from "../_shared/http-security.ts";

type RetryBody = {
  limit?: number;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonResponse(req, { ok: false, error: "Método não permitido." }, 405);
  }
  if (hasOversizedBody(req, 8_192)) {
    return jsonResponse(req, { ok: false, error: "Payload muito grande." }, 413);
  }

  const expectedSecret = Deno.env.get("CRON_NOTIFICATIONS_SECRET") || "";
  const providedSecret = req.headers.get("x-cron-secret") || "";
  if (!expectedSecret || !safeEqualSecret(providedSecret, expectedSecret)) {
    return jsonResponse(req, { ok: false, error: "Não autorizado." }, 401);
  }

  const body = (await req.json().catch(() => ({}))) as RetryBody;
  const requestedLimit = Math.trunc(Number(body.limit || 10));
  const limit = Number.isFinite(requestedLimit) ? Math.min(25, Math.max(1, requestedLimit)) : 10;
  const admin = supabaseAdmin();
  const { data: claimed, error: claimError } = await admin.rpc("claim_d4sign_signature_retries", {
    p_limit: limit,
  });
  if (claimError) {
    console.error("[d4sign-retry] falha ao reservar tentativas", {
      message: claimError.message,
    });
    return jsonResponse(req, { ok: false, error: "Falha ao reservar tentativas." }, 500);
  }

  const results: Array<Record<string, unknown>> = [];
  for (const row of claimed || []) {
    const signatureId = String(row.signature_id || "");
    const consultationId = String(row.consultation_id || "");
    if (!signatureId || !consultationId) continue;
    try {
      const result = await dispatchD4SignContract(admin, consultationId, {
        allowPendingPayment: true,
      });
      results.push({ signatureId, consultationId, ...result });

      // Os erros do provedor passam pelo catch de dispatchD4SignContract e
      // reagendam a linha. Saídas antecipadas precisam liberar o lock aqui.
      if (!result.ok && result.status !== "error") {
        await admin
          .from("contract_signatures")
          .update({
            retry_locked_at: null,
            next_retry_at: null,
            error_code: `d4sign_retry_${result.status || "skipped"}`,
            error_message: result.error || "Nova tentativa não aplicável.",
          })
          .eq("id", signatureId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[d4sign-retry] falha inesperada", {
        signatureId,
        consultationId,
        message,
      });
      await admin
        .from("contract_signatures")
        .update({
          retry_locked_at: null,
          error_code: "d4sign_retry_worker_error",
          error_message: message.slice(0, 1000),
          next_retry_at: null,
        })
        .eq("id", signatureId);
      results.push({ signatureId, consultationId, ok: false, error: message });
    }
  }

  return jsonResponse(req, {
    ok: true,
    claimed: claimed?.length || 0,
    sent: results.filter((item) => item.ok === true).length,
    retryScheduled: results.filter((item) => item.ok === false && item.status === "error").length,
    results,
  });
});
