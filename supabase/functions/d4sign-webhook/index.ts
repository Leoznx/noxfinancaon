import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { jsonResponse, supabaseAdmin } from "../_shared/asaas.ts";
import { finalizeD4SignContract, hashWebhookPayload } from "../_shared/d4sign.ts";

function safeEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a[index] ^ b[index];
  return result === 0;
}

async function readPayload(req: Request) {
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return await req.json();
  const form = await req.formData();
  return Object.fromEntries(Array.from(form.entries()).map(([key, value]) => [key, String(value)]));
}

serve(async (req) => {
  if (req.method !== "POST")
    return jsonResponse(req, { ok: false, error: "Metodo nao permitido." }, 405);
  const expectedSecret = Deno.env.get("D4SIGN_WEBHOOK_SECRET") || "";
  const receivedSecret = new URL(req.url).searchParams.get("secret") || "";
  if (!expectedSecret || !safeEqual(receivedSecret, expectedSecret)) {
    return jsonResponse(req, { ok: false, error: "Nao autorizado." }, 401);
  }

  let payload: any;
  try {
    payload = await readPayload(req);
  } catch {
    return jsonResponse(req, { ok: false, error: "Payload invalido." }, 400);
  }

  const documentUuid = String(
    payload?.uuid || payload?.uuid_document || payload?.document_uuid || "",
  );
  const eventType = String(payload?.type_post || payload?.event || "unknown");
  const message = String(payload?.message || "");
  if (!documentUuid) return jsonResponse(req, { ok: true, ignored: true, reason: "missing_uuid" });

  const supabase = supabaseAdmin();
  const { data: signature, error } = await supabase
    .from("contract_signatures")
    .select("*")
    .eq("d4sign_document_uuid", documentUuid)
    .maybeSingle();
  if (error || !signature) {
    console.error("[d4sign-webhook] documento nao reconhecido", { documentUuid, eventType });
    return jsonResponse(req, { ok: true, ignored: true, reason: "document_not_found" });
  }

  const payloadHash = await hashWebhookPayload(payload);
  await supabase.from("contract_signature_events").upsert(
    {
      contract_signature_id: signature.id,
      event_key: `${documentUuid}:${eventType}:${payloadHash}`,
      event_type: eventType,
      message: message.slice(0, 500),
      payload,
    },
    { onConflict: "event_key", ignoreDuplicates: true },
  );
  await supabase
    .from("contract_signatures")
    .update({ last_webhook_at: new Date().toISOString() })
    .eq("id", signature.id);

  const normalizedMessage = message.toLowerCase();
  const finished =
    eventType === "1" ||
    normalizedMessage.includes("finished document") ||
    normalizedMessage.includes("finalizado");
  const cancelled = normalizedMessage.includes("cancel") || eventType === "3";

  if (cancelled) {
    await supabase
      .from("contract_signatures")
      .update({
        status: "cancelled",
        error_code: "d4sign_cancelled",
        error_message: message || "Documento cancelado.",
      })
      .eq("id", signature.id);
    await supabase
      .from("consultas_credito")
      .update({ substatus: "assinatura_cancelada" })
      .eq("id", signature.consultation_id);
    return jsonResponse(req, { ok: true, cancelled: true });
  }

  if (!finished) return jsonResponse(req, { ok: true, recorded: true });

  try {
    await supabase
      .from("contract_signatures")
      .update({
        status: "signed",
        signed_at: new Date().toISOString(),
        error_code: null,
        error_message: null,
      })
      .eq("id", signature.id);
    const result = await finalizeD4SignContract(supabase, {
      ...signature,
      status: "signed",
      signed_at: new Date().toISOString(),
    });
    return jsonResponse(req, result as Record<string, unknown>);
  } catch (finalizeError) {
    const errorMessage =
      finalizeError instanceof Error ? finalizeError.message : String(finalizeError);
    await supabase
      .from("contract_signatures")
      .update({
        status: "error",
        error_code: errorMessage.split(":")[0],
        error_message: errorMessage.slice(0, 1000),
      })
      .eq("id", signature.id);
    console.error("[d4sign-webhook] falha ao ativar contrato", {
      signatureId: signature.id,
      documentUuid,
      message: errorMessage,
    });
    return jsonResponse(req, { ok: false, error: "Falha ao ativar o contrato." }, 500);
  }
});
