import { jsonResponse, supabaseAdmin } from "../_shared/asaas.ts";
import { hashWebhookPayload } from "../_shared/d4sign.ts";

function safeEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a[index] ^ b[index];
  return result === 0;
}

function messageIds(payload: Record<string, unknown>) {
  const values = [
    payload.messageId,
    payload.zaapId,
    payload.id,
    ...(Array.isArray(payload.ids) ? payload.ids : []),
  ];
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  );
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(request, { ok: false, error: "method_not_allowed" }, 405);
  }
  const expectedSecret = Deno.env.get("ZAPI_WEBHOOK_SECRET")?.trim() || "";
  const receivedSecret = new URL(request.url).searchParams.get("secret") || "";
  if (!expectedSecret || !safeEqual(receivedSecret, expectedSecret)) {
    return jsonResponse(request, { ok: false, error: "unauthorized" }, 401);
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return jsonResponse(request, { ok: false, error: "invalid_payload" }, 400);
  }
  const ids = messageIds(payload as Record<string, unknown>);
  if (!ids.length) {
    return jsonResponse(request, { ok: true, ignored: true, reason: "missing_message_id" });
  }

  const supabase = supabaseAdmin();
  const { data: sentEvents } = await supabase
    .from("contract_signature_events")
    .select("contract_signature_id, payload")
    .eq("event_type", "zapi_message_sent")
    .order("created_at", { ascending: false })
    .limit(200);
  const matched = (sentEvents || []).find((event) =>
    ids.includes(String(event?.payload?.provider_message_id || ""))
  );
  if (!matched?.contract_signature_id) {
    return jsonResponse(request, { ok: true, ignored: true, reason: "message_not_tracked" });
  }

  const status = String((payload as Record<string, unknown>).status || "")
    .trim()
    .toUpperCase();
  const error = String((payload as Record<string, unknown>).error || "").trim();
  const payloadHash = await hashWebhookPayload(payload);
  await supabase.from("contract_signature_events").upsert(
    {
      contract_signature_id: matched.contract_signature_id,
      event_key: `zapi:status:${ids[0]}:${status || "DELIVERY"}:${payloadHash}`,
      event_type: status ? `zapi_${status.toLowerCase()}` : "zapi_delivery",
      message: error || (status ? `WhatsApp: ${status}` : "Retorno de envio da Z-API."),
      payload,
    },
    { onConflict: "event_key", ignoreDuplicates: true },
  );
  if (error) {
    await supabase
      .from("contract_notification_deliveries")
      .update({ status: "failed", last_error: `zapi_delivery:${error}`.slice(0, 500) })
      .eq("contract_signature_id", matched.contract_signature_id)
      .eq("channel", "whatsapp")
      .eq("notification_type", "insurance_active");
  }

  return jsonResponse(request, {
    ok: true,
    tracked: true,
    status: status || null,
  });
});
