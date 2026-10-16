import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { jsonResponse, supabaseAdmin } from "../_shared/asaas.ts";
import { finalizeD4SignContract, hashWebhookPayload, isPaidStatus } from "../_shared/d4sign.ts";
import { cancelContractSubscription } from "../_shared/contract-billing.ts";
import {
  normalizeContractSignatureStatus,
  persistProviderTransition,
  reduceContractSignatureStatus,
} from "../_shared/billing-state.ts";
import { hasOversizedBody } from "../_shared/http-security.ts";

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

function eventTimestamp(payload: any) {
  const candidates = [
    payload?.event_at,
    payload?.eventDate,
    payload?.event_date,
    payload?.date,
    payload?.updated_at,
    payload?.created_at,
  ];
  for (const candidate of candidates) {
    const parsed = Date.parse(String(candidate || ""));
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

async function markSignatureEvent(
  supabase: any,
  eventKey: string,
  status: "processed" | "ignored" | "error",
  errorMessage: string | null = null,
) {
  let nextAttemptAt: string | null = null;
  if (status === "error") {
    const { data } = await supabase
      .from("contract_signature_events")
      .select("attempts")
      .eq("event_key", eventKey)
      .maybeSingle();
    const attempts = Math.max(1, Number(data?.attempts || 1));
    const delay = Math.min(300, 15 * 2 ** Math.min(attempts - 1, 5));
    nextAttemptAt = new Date(Date.now() + delay * 1_000).toISOString();
  }
  await supabase
    .from("contract_signature_events")
    .update({
      status,
      error_message: errorMessage?.slice(0, 1000) || null,
      processed_at: new Date().toISOString(),
      locked_at: null,
      next_attempt_at: nextAttemptAt,
    })
    .eq("event_key", eventKey);
}

serve(async (req) => {
  if (req.method !== "POST")
    return jsonResponse(req, { ok: false, error: "Metodo nao permitido." }, 405);
  if (hasOversizedBody(req))
    return jsonResponse(req, { ok: false, error: "Payload muito grande." }, 413);
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

  const normalizedMessage = message.toLowerCase();
  const finished =
    eventType === "1" ||
    normalizedMessage.includes("finished document") ||
    normalizedMessage.includes("finalizado");
  const cancelled = normalizedMessage.includes("cancel") || eventType === "3";

  const supabase = supabaseAdmin();
  const { data: foundSignature, error } = await supabase
    .from("contract_signatures")
    .select("*")
    .eq("d4sign_document_uuid", documentUuid)
    .maybeSingle();
  const { data: supersededDocument, error: supersededError } = await supabase
    .from("contract_signature_superseded_documents")
    .select("id, state")
    .eq("d4sign_document_uuid", documentUuid)
    .maybeSingle();
  if (supersededError) {
    console.error("[d4sign-webhook] falha ao consultar documento substituido", {
      documentUuid,
      message: supersededError.message,
    });
    return jsonResponse(req, { ok: false, retryable: true, reason: "supersession_lookup_failed" }, 503);
  }

  // O cancelamento solicitado pela troca de prazo nao cancela a proposta. A
  // linha e criada antes da chamada a D4Sign, portanto ate um webhook imediato
  // e reconhecido. Um evento de conclusao que vença a corrida continua sendo
  // processado enquanto o UUID ainda estiver na assinatura principal.
  if (
    supersededDocument &&
    (supersededDocument.state === "cancelled" || cancelled || !foundSignature)
  ) {
    return jsonResponse(req, {
      ok: true,
      ignored: true,
      reason: "document_superseded_by_period_change",
      supersessionState: supersededDocument.state,
    });
  }
  if (error || !foundSignature) {
    console.error("[d4sign-webhook] documento nao reconhecido", { documentUuid, eventType });
    // O provedor pode entregar o evento imediatamente, antes do UPDATE que
    // persiste o UUID local. Um 2xx aqui encerraria a fila e perderia a
    // assinatura; 503 solicita uma redelivery segura e idempotente.
    return jsonResponse(
      req,
      {
        ok: false,
        retryable: true,
        reason: "document_not_found_yet",
      },
      503,
    );
  }
  let signature = foundSignature;

  const payloadHash = await hashWebhookPayload(payload);
  const eventKey = `${documentUuid}:${eventType}:${payloadHash}`;
  const providerEventAt = eventTimestamp(payload);
  const { data: claimRows, error: claimError } = await supabase.rpc(
    "claim_contract_signature_event",
    {
      p_signature_id: signature.id,
      p_event_key: eventKey,
      p_event_type: eventType,
      p_message: message.slice(0, 500),
      p_payload: payload,
      p_event_at: providerEventAt,
    },
  );
  if (claimError) {
    console.error("[d4sign-webhook] falha ao adquirir evento", claimError.message);
    return jsonResponse(req, { ok: false, error: "Falha ao registrar evento." }, 500);
  }
  const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
  if (!claim?.claimed) {
    if (["error", "retry", "processing"].includes(String(claim?.event_status || ""))) {
      return jsonResponse(
        req,
        {
          ok: false,
          retryable: true,
          eventStatus: claim?.event_status,
          error: "Evento aguardando nova tentativa.",
        },
        503,
      );
    }
    return jsonResponse(req, {
      ok: true,
      duplicated: true,
      eventStatus: claim?.event_status || null,
    });
  }
  await supabase
    .from("contract_signatures")
    .update({ last_webhook_at: new Date().toISOString() })
    .eq("id", signature.id);

  if (cancelled) {
    try {
      const cancelTransition = await persistProviderTransition({
        supabase,
        table: "contract_signatures",
        rowId: signature.id,
        current: signature,
        incomingEventAt: providerEventAt,
        reduce: (currentStatus, currentEventAt, incomingEventAt) =>
          reduceContractSignatureStatus(
            currentStatus,
            "cancelled",
            currentEventAt,
            incomingEventAt,
          ),
        buildPatch: ({ current, nextStatus }) =>
          nextStatus === "cancelled"
            ? {
                signature_status: "cancelled",
                error_code: "d4sign_cancelled",
                error_message: message || "Documento cancelado.",
              }
            : {
                signature_status: current.signature_status,
              },
      });
      signature = cancelTransition.row;
      if (cancelTransition.nextStatus !== "cancelled") {
        await markSignatureEvent(supabase, eventKey, "ignored");
        return jsonResponse(req, {
          ok: true,
          ignored: true,
          reason: `signature_already_${normalizeContractSignatureStatus(signature.status)}`,
        });
      }
      const { error: cancelConsultationError } = await supabase
        .from("consultas_credito")
        .update({
          substatus: "assinatura_cancelada",
          signature_status: "cancelled",
          policy_status: "cancelled",
        })
        .eq("id", signature.consultation_id);
      if (cancelConsultationError) throw cancelConsultationError;
      await supabase
        .from("apolices")
        .update({
          status: "cancelada",
          cancelled_at: new Date().toISOString(),
        })
        .eq("consulta_id", signature.consultation_id);

      const recurrence = await cancelContractSubscription(supabase, {
        consultationId: signature.consultation_id,
        reason: "documento_d4sign_cancelado",
      });
      if (!recurrence.cancelled && recurrence.reason !== "subscription_not_found") {
        throw new Error(`subscription_cancellation_${recurrence.reason || "not_confirmed"}`);
      }
      await markSignatureEvent(supabase, eventKey, "processed");
      return jsonResponse(req, { ok: true, cancelled: true });
    } catch (cancelError) {
      const errorMessage = cancelError instanceof Error ? cancelError.message : String(cancelError);
      await supabase
        .from("consultas_credito")
        .update({
          substatus: "assinatura_cancelada_revisao_financeira",
        })
        .eq("id", signature.consultation_id);
      await markSignatureEvent(supabase, eventKey, "error", errorMessage);
      return jsonResponse(
        req,
        {
          ok: false,
          error: "Documento cancelado; a recorrencia requer conciliacao financeira.",
        },
        500,
      );
    }
  }

  if (!finished) {
    await markSignatureEvent(supabase, eventKey, "processed");
    return jsonResponse(req, { ok: true, recorded: true });
  }

  try {
    const signedAt = new Date().toISOString();
    const signedTransition = await persistProviderTransition({
      supabase,
      table: "contract_signatures",
      rowId: signature.id,
      current: signature,
      incomingEventAt: providerEventAt,
      reduce: (currentStatus, currentEventAt, incomingEventAt) =>
        reduceContractSignatureStatus(currentStatus, "signed", currentEventAt, incomingEventAt),
      buildPatch: ({ current, nextStatus }) =>
        ["signed", "active"].includes(nextStatus)
          ? {
              signature_status: "signed",
              signed_at: current.signed_at || signedAt,
              error_code: null,
              error_message: null,
            }
          : {
              signature_status: current.signature_status,
            },
    });
    signature = signedTransition.row;
    const nextStatus = signedTransition.nextStatus;
    if (!["signed", "active"].includes(nextStatus)) {
      await markSignatureEvent(supabase, eventKey, "ignored");
      return jsonResponse(req, { ok: true, ignored: true, reason: "signature_terminal" });
    }
    const { data: consultation, error: consultationError } = await supabase
      .from("consultas_credito")
      .select("payment_status, payment_state")
      .eq("id", signature.consultation_id)
      .single();
    if (consultationError) throw consultationError;

    if (!isPaidStatus(consultation?.payment_state || consultation?.payment_status)) {
      await supabase
        .from("consultas_credito")
        .update({
          status: "aguardando_ativacao",
          substatus: "assinatura_concluida_aguardando_pagamento",
          activation_status: "aguardando_pagamento",
          contract_accepted: true,
          contract_accepted_at: signedAt,
          signature_status: "signed",
          policy_status: "issued_pending",
        })
        .eq("id", signature.consultation_id);
      if (!["signed", "active"].includes(normalizeContractSignatureStatus(signature.status))) {
        await supabase.from("proposta_historico").insert({
          consulta_id: signature.consultation_id,
          tipo_evento: "contrato_d4sign_assinado_aguardando_pagamento",
          descricao:
            "Contrato assinado na D4Sign. Ativacao aguardando confirmacao do primeiro pagamento no Asaas.",
        });
      }
      await markSignatureEvent(supabase, eventKey, "processed");
      return jsonResponse(req, {
        ok: true,
        signed: true,
        activated: false,
        waitingPayment: true,
      });
    }

    const result = await finalizeD4SignContract(supabase, {
      ...signature,
      status: nextStatus === "active" ? "active" : "signed",
      signature_status: "signed",
      signed_at: signature.signed_at || signedAt,
    });
    await markSignatureEvent(supabase, eventKey, "processed");
    return jsonResponse(req, result as Record<string, unknown>);
  } catch (finalizeError) {
    const errorMessage =
      finalizeError instanceof Error ? finalizeError.message : String(finalizeError);
    // A assinatura e um fato concluido. Falha no download/ativacao nao pode
    // rebaixa-la para erro nem provocar novo convite numa retomada.
    await supabase
      .from("contract_signatures")
      .update({
        status:
          normalizeContractSignatureStatus(signature.status) === "active" ? "active" : "signed",
        signature_status: "signed",
        error_code: errorMessage.split(":")[0],
        error_message: errorMessage.slice(0, 1000),
      })
      .eq("id", signature.id)
      .in("status", ["signed", "active"]);
    console.error("[d4sign-webhook] falha ao ativar contrato", {
      signatureId: signature.id,
      documentUuid,
      message: errorMessage,
    });
    await markSignatureEvent(supabase, eventKey, "error", errorMessage);
    return jsonResponse(req, { ok: false, error: "Falha ao ativar o contrato." }, 500);
  }
});
