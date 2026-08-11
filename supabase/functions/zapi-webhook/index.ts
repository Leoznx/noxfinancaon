import { jsonResponse, supabaseAdmin } from "../_shared/asaas.ts";
import { hashWebhookPayload } from "../_shared/d4sign.ts";
import { normalizeWhatsappPhone, sendZApiText } from "../_shared/zapi.ts";
import {
  parseWhatsappBillingCommand,
  receivedWhatsappText,
  selectWhatsappBillingCandidate,
  type WhatsappBillingCandidate,
} from "../_shared/whatsapp-billing.ts";

const OPEN_STATUSES = [
  "pending",
  "overdue",
  "risk_analysis",
  "approved",
  "created",
  "waiting_payment",
  "active",
  "partial",
];

function safeEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a[index] ^ b[index];
  }
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

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function money(value: unknown) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

async function sendSafeReply(phone: string, message: string) {
  const result = await sendZApiText({ to: phone, message });
  return result.sent
    ? { sent: true }
    : { sent: false, reason: result.reason || "send_failed" };
}

async function handleBillingCommand(
  request: Request,
  payload: Record<string, unknown>,
  method: "boleto" | "pix",
) {
  if (payload.fromMe === true || payload.isGroup === true) {
    return jsonResponse(request, {
      ok: true,
      ignored: true,
      reason: "unsupported_origin",
    });
  }
  const phone = normalizeWhatsappPhone(String(payload.phone || ""));
  if (!phone) {
    return jsonResponse(request, {
      ok: true,
      ignored: true,
      reason: "invalid_phone",
    });
  }

  const admin = supabaseAdmin();
  const { data: settings } = await admin
    .from("billing_automation_settings")
    .select("enabled, dispatch_enabled")
    .eq("id", true)
    .maybeSingle();
  if (settings?.enabled === false || settings?.dispatch_enabled !== true) {
    return jsonResponse(request, {
      ok: true,
      ignored: true,
      reason: "automation_in_simulation",
    });
  }

  const ids = messageIds(payload);
  const providerMessageId = ids[0] ||
    `payload:${await hashWebhookPayload(payload)}`;
  const phoneHash = await sha256(phone);
  const { data: audit, error: auditError } = await admin
    .from("whatsapp_billing_requests")
    .insert({
      provider_message_id: providerMessageId,
      phone_hash: phoneHash,
      requested_method: method,
      status: "received",
    })
    .select("id")
    .maybeSingle();
  if (auditError?.code === "23505") {
    return jsonResponse(request, { ok: true, duplicate: true });
  }
  if (auditError || !audit?.id) {
    return jsonResponse(
      request,
      { ok: false, error: "audit_unavailable" },
      503,
    );
  }

  const [{ data: batches }, { data: invoices }] = await Promise.all([
    admin
      .from("consolidated_invoice_batches")
      .select(
        "id, agency_user_id, due_date, status, profile:profiles!consolidated_invoice_batches_agency_user_id_fkey(telefone)",
      )
      .eq("status", "active"),
    admin
      .from("faturas_inquilino")
      .select(
        "id, recipient_user_id, tenant_user_id, vencimento, status, consolidated_item_id, asaas_payment:asaas_payments(recipient_user_id, recipient_phone)",
      )
      .in("status", OPEN_STATUSES)
      .is("consolidated_item_id", null),
  ]);

  const candidates: WhatsappBillingCandidate[] = [];
  for (const batch of batches ?? []) {
    const profile = Array.isArray(batch.profile)
      ? batch.profile[0]
      : batch.profile;
    if (normalizeWhatsappPhone(profile?.telefone) !== phone) continue;
    candidates.push({
      actorId: batch.agency_user_id,
      batchId: batch.id,
      dueDate: batch.due_date,
    });
  }
  for (const invoice of invoices ?? []) {
    const payment = Array.isArray(invoice.asaas_payment)
      ? invoice.asaas_payment[0]
      : invoice.asaas_payment;
    if (!payment || normalizeWhatsappPhone(payment.recipient_phone) !== phone) {
      continue;
    }
    const actorId = invoice.recipient_user_id || invoice.tenant_user_id ||
      payment.recipient_user_id;
    if (!actorId) continue;
    candidates.push({
      actorId,
      invoiceId: invoice.id,
      dueDate: invoice.vencimento,
    });
  }

  const selection = selectWhatsappBillingCandidate(candidates);
  if (!selection.candidate) {
    const status = selection.reason === "ambiguous_phone"
      ? "ambiguous_phone"
      : "not_found";
    await admin
      .from("whatsapp_billing_requests")
      .update({ status, completed_at: new Date().toISOString() })
      .eq("id", audit.id);
    const message = selection.reason === "ambiguous_phone"
      ? "Por segurança, este número está associado a mais de um cadastro. Acesse sua conta NOX para emitir a cobrança atualizada."
      : "Não localizei uma cobrança em aberto para este número. Confira o telefone do cadastro ou acesse sua conta NOX.";
    const reply = await sendSafeReply(phone, message);
    return jsonResponse(request, { ok: true, handled: true, status, reply });
  }

  const target = selection.candidate;
  await admin
    .from("whatsapp_billing_requests")
    .update({
      status: "processing",
      requested_by: target.actorId,
      invoice_id: target.invoiceId || null,
      batch_id: target.batchId || null,
    })
    .eq("id", audit.id);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const baseUrl = Deno.env.get("SUPABASE_URL") || "";
  const webhookSecret = Deno.env.get("ZAPI_WEBHOOK_SECRET") || "";
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/functions/v1/asaas-reissue-payment`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        "x-zapi-webhook-secret": webhookSecret,
      },
      body: JSON.stringify({
        requestedBy: target.actorId,
        invoiceId: target.invoiceId,
        batchId: target.batchId,
        method,
      }),
    });
  } catch {
    await admin
      .from("whatsapp_billing_requests")
      .update({
        status: "failed",
        error_code: "reissue_unavailable",
        completed_at: new Date().toISOString(),
      })
      .eq("id", audit.id);
    const reply = await sendSafeReply(
      phone,
      "Não foi possível atualizar sua cobrança agora. Tente novamente em alguns minutos.",
    );
    return jsonResponse(request, {
      ok: true,
      handled: true,
      status: "failed",
      reply,
    });
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.success !== true) {
    await admin
      .from("whatsapp_billing_requests")
      .update({
        status: "failed",
        error_code: `reissue_http_${response.status}`,
        completed_at: new Date().toISOString(),
      })
      .eq("id", audit.id);
    const reply = await sendSafeReply(
      phone,
      result?.error ||
        "Não foi possível atualizar sua cobrança agora. Tente novamente em alguns minutos.",
    );
    return jsonResponse(request, {
      ok: true,
      handled: true,
      status: "failed",
      reply,
    });
  }

  const responseMessage = method === "pix"
    ? [
      "Pix atualizado — NOX Fiança",
      `Valor: ${money(result.amount)}`,
      `Vencimento: ${result.dueDate}`,
      `Pix Copia e Cola: ${result.pix?.copyPaste || "consulte no portal NOX"}`,
    ].join("\n")
    : [
      "Boleto atualizado — NOX Fiança",
      `Valor: ${money(result.amount)}`,
      `Vencimento: ${result.dueDate}`,
      `Linha digitável: ${result.boleto?.barcode || "consulte no portal NOX"}`,
      result.boleto?.pdfUrl ? `Boleto: ${result.boleto.pdfUrl}` : "",
    ].filter(Boolean).join("\n");
  const reply = await sendSafeReply(phone, responseMessage);
  await admin
    .from("whatsapp_billing_requests")
    .update({
      status: reply.sent ? "completed" : "failed",
      error_code: reply.sent ? null : reply.reason,
      completed_at: new Date().toISOString(),
    })
    .eq("id", audit.id);
  return jsonResponse(request, {
    ok: true,
    handled: true,
    status: reply.sent ? "completed" : "failed",
  });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(
      request,
      { ok: false, error: "method_not_allowed" },
      405,
    );
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
  const record = payload as Record<string, unknown>;
  const method = parseWhatsappBillingCommand(receivedWhatsappText(record));
  if (String(record.type || "") === "ReceivedCallback" && method) {
    return handleBillingCommand(request, record, method);
  }

  const ids = messageIds(record);
  if (!ids.length) {
    return jsonResponse(request, {
      ok: true,
      ignored: true,
      reason: "missing_message_id",
    });
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
    return jsonResponse(request, {
      ok: true,
      ignored: true,
      reason: "message_not_tracked",
    });
  }

  const status = String(record.status || "").trim().toUpperCase();
  const error = String(record.error || "").trim();
  const payloadHash = await hashWebhookPayload(payload);
  await supabase.from("contract_signature_events").upsert(
    {
      contract_signature_id: matched.contract_signature_id,
      event_key: `zapi:status:${ids[0]}:${status || "DELIVERY"}:${payloadHash}`,
      event_type: status ? `zapi_${status.toLowerCase()}` : "zapi_delivery",
      message: error ||
        (status ? `WhatsApp: ${status}` : "Retorno de envio da Z-API."),
      payload,
    },
    { onConflict: "event_key", ignoreDuplicates: true },
  );
  if (error) {
    await supabase
      .from("contract_notification_deliveries")
      .update({
        status: "failed",
        last_error: `zapi_delivery:${error}`.slice(0, 500),
      })
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
