import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  AsaasApiError,
  asaasFetch,
  cancelAsaasPayment,
  corsHeaders,
  hashPayload,
  jsonResponse,
  logFinancialNotification,
  sanitizeAsaasResponse,
  sendPaymentEmail,
  sendPaymentSms,
  sendPaymentWhatsapp,
  supabaseAdmin,
  toMoney,
  wasNotificationSent,
} from "../_shared/asaas.ts";
import {
  buildBillingKey,
  checkoutRetryAttempt,
  checkoutRetryStage,
  checkoutStatusFromEvent,
  normalizePaymentStatus,
  paymentStatusFromEvent,
  persistProviderTransition,
  reduceCheckoutStatus,
  reduceConsolidatedBatchStatus,
  reducePaymentStatus,
  reduceSubscriptionStatus,
  recurringSetupAllowsContractActivation,
  shouldApplyConsolidatedEvent,
  shouldDispatchContractAfterPayment,
  subscriptionStatusFromEvent,
} from "../_shared/billing-state.ts";
import { materializeInvoice } from "../_shared/contract-billing.ts";
import { dispatchD4SignContract, finalizeD4SignContract } from "../_shared/d4sign.ts";
import { hasOversizedBody, safeEqualSecret } from "../_shared/http-security.ts";

function checkoutResourceUrl(checkout: any, checkoutId?: string | null) {
  if (checkout?.link || checkout?.url || checkout?.checkoutUrl) {
    return checkout.link || checkout.url || checkout.checkoutUrl;
  }
  if (!checkoutId) return null;
  const base =
    Deno.env.get("ASAAS_CHECKOUT_URL_BASE") || "https://asaas.com/checkoutSession/show?id=";
  return `${base}${encodeURIComponent(checkoutId)}`;
}

async function recurringSetupAllowsActivation(supabase: any, consultationId: string) {
  const { data: consultation, error: consultationError } = await supabase
    .from("consultas_credito")
    .select("card_setup_mode, payment_method")
    .eq("id", consultationId)
    .maybeSingle();
  if (consultationError) throw consultationError;
  const { data: subscription, error: subscriptionError } = await supabase
    .from("asaas_subscriptions")
    .select("mode, status, checkout_status, card_registration_status, asaas_subscription_id")
    .eq("consultation_id", consultationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (subscriptionError) throw subscriptionError;
  return recurringSetupAllowsContractActivation(consultation, subscription);
}

async function dispatchContractWhenBillingIsReady(
  supabase: any,
  consultationId: string,
  paymentStatus: unknown,
) {
  const recurringReady = await recurringSetupAllowsActivation(supabase, consultationId);
  const { data: existingSignature, error: signatureError } = await supabase
    .from("contract_signatures")
    .select("*")
    .eq("consultation_id", consultationId)
    .maybeSingle();
  if (signatureError) throw signatureError;

  if (!shouldDispatchContractAfterPayment({ paymentStatus, recurringReady })) {
    if (
      ["confirmed", "paid"].includes(normalizePaymentStatus(paymentStatus)) &&
      !recurringReady &&
      (existingSignature?.signature_status === "signed" ||
        ["signed", "active"].includes(existingSignature?.status))
    ) {
      const { error } = await supabase
        .from("consultas_credito")
        .update({
          substatus: "assinatura_concluida_aguardando_recorrencia",
          activation_status: "aguardando_pagamento",
        })
        .eq("id", consultationId);
      if (error) throw error;
    }
    return { ok: true, status: "awaiting_billing_requirements" };
  }

  const contractResult =
    existingSignature?.signature_status === "signed" ||
    ["signed", "active"].includes(existingSignature?.status)
      ? await finalizeD4SignContract(supabase, existingSignature)
      : await dispatchD4SignContract(supabase, consultationId, {
          allowPendingPayment: true,
        });

  if (!contractResult.ok) {
    const signatureId =
      "signatureId" in contractResult ? contractResult.signatureId : existingSignature?.id || null;
    const contractError =
      "error" in contractResult
        ? contractResult.error
        : "status" in contractResult
          ? contractResult.status
          : "unknown";
    console.error("[asaas-webhook] falha ao despachar contrato D4Sign", {
      consultationId,
      signatureId,
      error: contractError || "unknown",
    });
  }
  return contractResult;
}

async function hasPendingBillingOperation(supabase: any, externalReference?: string | null) {
  if (!externalReference) return false;
  const { data, error } = await supabase
    .from("billing_operations")
    .select("id, state")
    .eq("idempotency_key", externalReference)
    .maybeSingle();
  if (error) throw error;
  return !!data && ["reserved", "provider_created", "ambiguous", "persisted"].includes(data.state);
}

async function persistConsultationPaymentTransition(
  supabase: any,
  consultationId: string,
  incomingStatus: ReturnType<typeof normalizePaymentStatus>,
  providerEventAt: string,
  buildPatch: (
    current: any,
    nextStatus: string,
    staleEvent: boolean,
  ) => Record<string, unknown> = () => ({}),
) {
  const { data: consultation, error } = await supabase
    .from("consultas_credito")
    .select("*")
    .eq("id", consultationId)
    .maybeSingle();
  if (error || !consultation) throw error || new Error("consultation_not_found");
  return await persistProviderTransition({
    supabase,
    table: "consultas_credito",
    rowId: consultationId,
    current: consultation,
    incomingEventAt: providerEventAt,
    statusColumn: "payment_state",
    eventAtColumn: "payment_provider_event_at",
    reduce: (currentStatus, currentEventAt, incomingEventAt) =>
      reducePaymentStatus(currentStatus as string, incomingStatus, currentEventAt, incomingEventAt),
    buildPatch: ({ current, nextStatus, staleEvent }) => ({
      payment_status: nextStatus,
      ...buildPatch(current, nextStatus, staleEvent),
    }),
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST")
    return jsonResponse(req, { ok: false, error: "Metodo nao permitido." }, 405);
  if (hasOversizedBody(req))
    return jsonResponse(req, { ok: false, error: "Payload muito grande." }, 413);

  const expectedToken = Deno.env.get("ASAAS_WEBHOOK_TOKEN") || "";
  const token = req.headers.get("asaas-access-token") || "";
  if (!expectedToken || !safeEqualSecret(token, expectedToken)) {
    return jsonResponse(req, { ok: false, error: "Nao autorizado." }, 401);
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(req, { ok: false, error: "JSON invalido." }, 400);
  }

  const eventType = String(payload?.event || "");
  const resourceType = eventType.startsWith("CHECKOUT_")
    ? "checkout"
    : eventType.startsWith("SUBSCRIPTION_")
      ? "subscription"
      : "payment";
  const resource =
    resourceType === "checkout"
      ? payload?.checkout || payload?.data || {}
      : resourceType === "subscription"
        ? payload?.subscription || payload?.data || {}
        : payload?.payment || payload?.data || {};
  const payment = resourceType === "payment" ? resource : {};
  const resourceId = resource?.id || null;
  const asaasPaymentId = resourceType === "payment" ? resourceId : null;
  const externalReference = resource?.externalReference || null;
  if (!eventType || (!resourceId && !externalReference)) {
    return jsonResponse(req, { ok: true, ignored: true });
  }

  const supabase = supabaseAdmin();
  const payloadHash = await hashPayload(payload);
  const eventId = String(
    payload?.id || `${eventType}:${resourceId || externalReference}:${payloadHash}`,
  );

  const { data: claimRows, error: claimError } = await supabase.rpc("claim_asaas_webhook_event", {
    p_event_id: eventId,
    p_event_type: eventType,
    p_payment_id: asaasPaymentId,
    p_external_reference: externalReference,
    p_resource_type: resourceType,
    p_resource_id: resourceId,
    p_payload_hash: payloadHash,
    p_payload: sanitizeAsaasResponse(payload),
  });
  if (claimError) {
    console.error("[asaas-webhook] falha ao adquirir evento", {
      eventType,
      resourceId,
      message: claimError.message,
    });
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

  if (resourceType === "checkout") {
    try {
      const result = await handleCheckoutEvent(
        supabase,
        eventType,
        resource,
        resourceId,
        externalReference,
        payload?.dateCreated || resource?.lastUpdated || new Date().toISOString(),
      );
      await markEvent(
        supabase,
        eventId,
        result.ignored ? "ignored" : "processed",
        result.reason || null,
      );
      return jsonResponse(req, { ok: true, ...result });
    } catch (error) {
      await markEvent(
        supabase,
        eventId,
        "error",
        error instanceof Error ? error.message : String(error),
      );
      return jsonResponse(req, { ok: false, error: "Falha ao processar Checkout." }, 500);
    }
  }
  if (resourceType === "subscription") {
    try {
      const result = await handleSubscriptionEvent(
        supabase,
        eventType,
        resource,
        resourceId,
        externalReference,
        payload?.dateCreated || resource?.lastUpdated || new Date().toISOString(),
      );
      await markEvent(
        supabase,
        eventId,
        result.ignored ? "ignored" : "processed",
        result.reason || null,
      );
      return jsonResponse(req, { ok: true, ...result });
    } catch (error) {
      await markEvent(
        supabase,
        eventId,
        "error",
        error instanceof Error ? error.message : String(error),
      );
      return jsonResponse(req, { ok: false, error: "Falha ao processar assinatura." }, 500);
    }
  }

  const incomingStatus = paymentStatusFromEvent(eventType, payment?.status);
  const providerEventAt =
    payload?.dateCreated ||
    payment?.lastUpdated ||
    payment?.paymentDate ||
    payment?.clientPaymentDate ||
    new Date().toISOString();
  const confirmedAt = eventType === "PAYMENT_CONFIRMED" ? new Date().toISOString() : null;
  const receivedAt =
    eventType === "PAYMENT_RECEIVED"
      ? payment?.paymentDate || payment?.clientPaymentDate || new Date().toISOString()
      : null;

  let query = supabase.from("asaas_payments").select("*");
  query = asaasPaymentId
    ? query.eq("asaas_payment_id", asaasPaymentId)
    : query.eq("external_reference", externalReference);
  const { data: foundPayment, error: findError } = await query.maybeSingle();
  let localPayment = foundPayment;

  if (findError) {
    await markEvent(supabase, eventId, "error", findError.message);
    return jsonResponse(req, { ok: false, error: "Falha ao localizar pagamento." }, 500);
  }

  if (payment?.subscription) {
    try {
      localPayment = await materializeSubscriptionPayment(
        supabase,
        payment,
        incomingStatus,
        providerEventAt,
      );
    } catch (error) {
      await markEvent(
        supabase,
        eventId,
        "error",
        error instanceof Error ? error.message : String(error),
      );
      return jsonResponse(req, { ok: false, error: "Falha ao materializar mensalidade." }, 500);
    }
  }

  if (!localPayment) {
    // Nao achou em asaas_payments (cobranca individual) - pode ser um boleto
    // consolidado da imobiliaria, que so existe em
    // consolidated_invoice_batches (nunca cria uma linha em asaas_payments).
    let batchQuery = supabase.from("consolidated_invoice_batches").select("*");
    batchQuery = asaasPaymentId
      ? batchQuery.eq("asaas_payment_id", asaasPaymentId)
      : batchQuery.eq("external_reference", externalReference);
    const { data: batch, error: batchFindError } = await batchQuery.maybeSingle();

    if (batchFindError) {
      await markEvent(supabase, eventId, "error", batchFindError.message);
      return jsonResponse(req, { ok: false, error: "Falha ao localizar pagamento." }, 500);
    }
    if (!batch) {
      if (await hasPendingBillingOperation(supabase, externalReference)) {
        await markEvent(supabase, eventId, "error", "local_payment_persistence_pending");
        return jsonResponse(
          req,
          {
            ok: false,
            retryable: true,
            error: "Pagamento recebido antes da persistencia local.",
          },
          500,
        );
      }
      await markEvent(supabase, eventId, "ignored", "payment_not_found");
      return jsonResponse(req, { ok: true, ignored: true, reason: "payment_not_found" });
    }

    try {
      await handleConsolidatedBatchEvent(
        supabase,
        batch,
        eventType,
        incomingStatus,
        payment,
        providerEventAt,
        eventId,
      );
      await markEvent(supabase, eventId, "processed", null);
      return jsonResponse(req, { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await supabase
        .from("consolidated_invoice_batches")
        .update({
          reconciliation_status: "retry",
          reconciliation_error: message.slice(0, 1000),
          reconciliation_locked_at: null,
        })
        .eq("id", batch.id)
        .eq("reconciliation_event_id", eventId)
        .eq("reconciliation_status", "processing");
      await markEvent(supabase, eventId, "error", message);
      return jsonResponse(req, { ok: false, error: "Falha ao conciliar lote." }, 500);
    }
  }

  let internalStatus: ReturnType<typeof normalizePaymentStatus>;
  try {
    const transition = await persistProviderTransition({
      supabase,
      table: "asaas_payments",
      rowId: localPayment.id,
      current: localPayment,
      incomingEventAt: providerEventAt,
      reduce: (currentStatus, currentEventAt, incomingEventAt) =>
        reducePaymentStatus(
          currentStatus as string,
          incomingStatus,
          currentEventAt,
          incomingEventAt,
        ),
      buildPatch: ({ current, staleEvent }) => {
        const patch: Record<string, unknown> = {
          raw_response: staleEvent ? current.raw_response : sanitizeAsaasResponse(payment),
        };
        if (confirmedAt && !current.confirmed_at) patch.confirmed_at = confirmedAt;
        if (receivedAt && !current.received_at) patch.received_at = receivedAt;
        return patch;
      },
    });
    localPayment = transition.row;
    internalStatus = normalizePaymentStatus(transition.nextStatus);
  } catch (updatePaymentError) {
    const message =
      updatePaymentError instanceof Error ? updatePaymentError.message : String(updatePaymentError);
    await markEvent(supabase, eventId, "error", message);
    return jsonResponse(req, { ok: false, error: "Falha ao atualizar pagamento." }, 500);
  }

  // Se esse pagamento e uma das mensalidades (asaas-create-installment-
  // plan vincula faturas_inquilino.asaas_payment_id = asaas_payments.id),
  // atualiza SO aquela parcela - as demais continuam intactas.
  const { data: faturaVinculada } = await supabase
    .from("faturas_inquilino")
    .select(
      "id, status, numero_parcela, installment_total, vencimento, pago_em, charge_kind, confirmed_at, provider_event_at",
    )
    .eq("asaas_payment_id", localPayment.id)
    .maybeSingle();
  if (faturaVinculada) {
    let invoiceStatus: ReturnType<typeof normalizePaymentStatus>;
    try {
      const invoiceTransition = await persistProviderTransition({
        supabase,
        table: "faturas_inquilino",
        rowId: faturaVinculada.id,
        current: faturaVinculada,
        incomingEventAt: providerEventAt,
        reduce: (currentStatus, currentEventAt, incomingEventAt) =>
          reducePaymentStatus(
            currentStatus as string,
            normalizePaymentStatus(internalStatus),
            currentEventAt,
            incomingEventAt,
          ),
        buildPatch: ({ current, nextStatus }) => {
          const patch: Record<string, unknown> = {};
          if (["confirmed", "paid"].includes(nextStatus) && !current.confirmed_at) {
            patch.confirmed_at = confirmedAt || receivedAt || new Date().toISOString();
          }
          if (nextStatus === "paid" && !current.pago_em) {
            patch.pago_em = receivedAt || new Date().toISOString();
          }
          return patch;
        },
      });
      invoiceStatus = normalizePaymentStatus(invoiceTransition.nextStatus);
    } catch {
      await markEvent(supabase, eventId, "error", "invoice_update_failed");
      return jsonResponse(req, { ok: false, error: "Falha ao atualizar mensalidade." }, 500);
    }

    // A trigger do banco usa a mesma chave idempotente. A chamada explícita
    // confirma que a ponte pagamento -> comissão terminou antes de considerar
    // o webhook processado. PAYMENT_CONFIRMED ainda não libera comissão; a
    // regra conservadora exige PAYMENT_RECEIVED (internalStatus = paid).
    if (invoiceStatus === "paid" && faturaVinculada.numero_parcela === 1) {
      const { error: releaseError } = await supabase.rpc("release_commissions_for_invoice", {
        p_invoice_id: faturaVinculada.id,
        p_event_id: `invoice:${faturaVinculada.id}:first-paid`,
      });
      if (releaseError) {
        await markEvent(supabase, eventId, "error", "commission_release_failed");
        return jsonResponse(req, { ok: false, error: "Falha ao liberar comissao." }, 500);
      }
    }
  }

  if (localPayment.consultation_id) {
    const isInitialPayment = faturaVinculada
      ? faturaVinculada.charge_kind === "initial"
      : localPayment.charge_kind !== "monthly";
    if (isInitialPayment) {
      await persistConsultationPaymentTransition(
        supabase,
        localPayment.consultation_id,
        normalizePaymentStatus(internalStatus),
        providerEventAt,
        (current, _nextStatus, staleEvent) => {
          const patch: Record<string, unknown> = {
            asaas_payment_id: asaasPaymentId || localPayment.asaas_payment_id,
            payment_data: staleEvent ? current.payment_data : sanitizeAsaasResponse(payment),
          };
          if (confirmedAt && !current.payment_confirmed_at) {
            patch.payment_confirmed_at = confirmedAt;
          }
          if (receivedAt && !current.payment_received_at) {
            patch.payment_received_at = receivedAt;
          }
          return patch;
        },
      );
    }

    if (
      (eventType === "PAYMENT_CONFIRMED" || eventType === "PAYMENT_RECEIVED") &&
      localPayment.user_id
    ) {
      await supabase.from("notificacoes").insert({
        user_id: localPayment.user_id,
        titulo: "Pagamento confirmado",
        mensagem: "O pagamento da proposta foi identificado com sucesso.",
        tipo: "pagamento",
        cor_destaque: "verde",
        icone: "check-circle",
        link: `/consultas/${localPayment.consultation_id}/finalizar`,
      });

      // E-mail/SMS pro MESMO responsavel que recebeu a cobranca na criacao -
      // nunca jurídico/admin/financeiro, e nunca recalculado aqui (webhook nao
      // tem sessao de usuario). Le os campos recipient_* salvos em
      // asaas_payments no momento da criacao (ver resolvePaymentRecipient em
      // asaas-create-payment), entao o destinatario nunca muda entre a
      // cobranca ser criada e ela ser confirmada. So dispara em
      // PAYMENT_CONFIRMED/PAYMENT_RECEIVED, nunca em PAYMENT_CREATED, e o
      // event_id unico do webhook (checado no topo desta funcao) ja impede
      // reenvio duplicado quando o Asaas reentrega o MESMO evento. Quando a
      // fatura e uma das mensalidades, ainda existe o caso de
      // PAYMENT_CONFIRMED seguido depois de PAYMENT_RECEIVED (dois eventos
      // DIFERENTES, cada um passaria pelo dedup acima) - sem uma segunda
      // trava, o inquilino receberia duas notificacoes de "pago" pra mesma
      // mensalidade. Usa financial_notifications (mesmo mecanismo do
      // cronograma/lembretes) pra so notificar na primeira vez.
      const contratoRef = faturaVinculada
        ? `mensalidade ${faturaVinculada.numero_parcela}/${faturaVinculada.installment_total}`
        : null;
      const jaNotificouPagamento = faturaVinculada
        ? await wasNotificationSent(supabase, {
            invoiceId: faturaVinculada.id,
            channel: "email",
            notificationType: "payment_confirmed",
          })
        : false;

      if (localPayment.recipient_email && !jaNotificouPagamento) {
        const resultadoEmail = await sendPaymentEmail({
          to: localPayment.recipient_email,
          nome: localPayment.recipient_name || "cliente",
          tipo: "confirmado",
          valor: Number(localPayment.value || 0),
          metodo: localPayment.payment_method,
          vencimento: faturaVinculada?.vencimento || null,
          contratoRef,
        }).catch((error: any) => {
          console.error("[asaas-webhook] falha ao notificar por e-mail", {
            paymentId: localPayment.id,
            message: error instanceof Error ? error.message : String(error),
          });
          return { sent: false, reason: "provider_error" };
        });
        if (faturaVinculada) {
          await logFinancialNotification(supabase, {
            invoiceId: faturaVinculada.id,
            recipientType: localPayment.recipient_type === "user" ? "user" : "tenant",
            recipientId: localPayment.recipient_tenant_id || localPayment.recipient_user_id,
            channel: "email",
            notificationType: "payment_confirmed",
            result: resultadoEmail,
          });
        }
      }
      const jaNotificouSms = faturaVinculada
        ? await wasNotificationSent(supabase, {
            invoiceId: faturaVinculada.id,
            channel: "sms",
            notificationType: "payment_confirmed",
          })
        : false;
      if (localPayment.recipient_phone && !jaNotificouSms) {
        const valorFmt = Number(localPayment.value || 0).toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
        });
        const resultadoSms = await sendPaymentSms({
          to: localPayment.recipient_phone,
          mensagem: contratoRef
            ? `NOX Fiança: pagamento da ${contratoRef} confirmado. Valor: ${valorFmt}.`
            : `NOX Fiança: pagamento de ${valorFmt} confirmado com sucesso.`,
        }).catch((error: any) => {
          console.error("[asaas-webhook] falha ao notificar por SMS", {
            paymentId: localPayment.id,
            message: error instanceof Error ? error.message : String(error),
          });
          return { sent: false, reason: "provider_error" };
        });
        if (faturaVinculada) {
          await logFinancialNotification(supabase, {
            invoiceId: faturaVinculada.id,
            recipientType: localPayment.recipient_type === "user" ? "user" : "tenant",
            recipientId: localPayment.recipient_tenant_id || localPayment.recipient_user_id,
            channel: "sms",
            notificationType: "payment_confirmed",
            result: resultadoSms,
          });
        }
      }
      const whatsappDispatchEnabled = await isBillingWhatsappDispatchEnabled(supabase);
      const jaNotificouWhatsapp = faturaVinculada
        ? await wasNotificationSent(supabase, {
            invoiceId: faturaVinculada.id,
            channel: "whatsapp",
            notificationType: "payment_confirmed",
          })
        : false;
      if (whatsappDispatchEnabled && localPayment.recipient_phone && !jaNotificouWhatsapp) {
        const valorFmt = Number(localPayment.value || 0).toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
        });
        const resultadoWhatsapp = await sendPaymentWhatsapp({
          to: localPayment.recipient_phone,
          mensagem: contratoRef
            ? `Olá, ${localPayment.recipient_name || "cliente"}. O pagamento da ${contratoRef} foi confirmado. Valor recebido: ${valorFmt}. A baixa já está disponível na sua conta NOX Fiança.`
            : `Olá, ${localPayment.recipient_name || "cliente"}. Seu pagamento de ${valorFmt} foi confirmado com sucesso pela NOX Fiança.`,
        });
        if (faturaVinculada) {
          await logFinancialNotification(supabase, {
            invoiceId: faturaVinculada.id,
            recipientType: localPayment.recipient_type === "user" ? "user" : "tenant",
            recipientId: localPayment.recipient_tenant_id || localPayment.recipient_user_id,
            channel: "whatsapp",
            notificationType: "payment_confirmed",
            result: resultadoWhatsapp,
          });
        }
      }
    }

    // O documento pode ter sido assinado antes do primeiro pagamento. Nesse
    // caso, a baixa do Asaas e o segundo requisito que faltava para ativar a
    // apolice. Se ainda aguarda assinatura, a chamada idempotente apenas
    // garante que o convite continue disponivel.
    const isFirstPayment =
      !faturaVinculada ||
      faturaVinculada.charge_kind === "initial" ||
      (faturaVinculada.charge_kind == null && Number(faturaVinculada.numero_parcela) === 1);
    if (isFirstPayment && (eventType === "PAYMENT_CONFIRMED" || eventType === "PAYMENT_RECEIVED")) {
      await dispatchContractWhenBillingIsReady(
        supabase,
        localPayment.consultation_id,
        internalStatus,
      );
    }
  }

  await markEvent(supabase, eventId, "processed", null, {
    invoiceId: faturaVinculada?.id || null,
    oldStatus: localPayment.status,
    newStatus: internalStatus,
  });
  return jsonResponse(req, { ok: true });
});

function consultationIdFromReference(reference?: string | null) {
  const match = /^nox:([0-9a-f-]{36}):(?:checkout|subscription):/i.exec(String(reference || ""));
  return match?.[1] || null;
}

async function findLocalSubscription(
  supabase: any,
  resourceId?: string | null,
  externalReference?: string | null,
) {
  if (resourceId) {
    const { data: byProvider } = await supabase
      .from("asaas_subscriptions")
      .select("*")
      .or(
        `asaas_subscription_id.eq.${resourceId},asaas_checkout_id.eq.${resourceId},asaas_initial_checkout_id.eq.${resourceId}`,
      )
      .maybeSingle();
    if (byProvider) return byProvider;
  }
  const consultationId = consultationIdFromReference(externalReference);
  if (!consultationId) return null;
  const { data } = await supabase
    .from("asaas_subscriptions")
    .select("*")
    .eq("consultation_id", consultationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

async function handleCheckoutEvent(
  supabase: any,
  eventType: string,
  checkout: any,
  checkoutId: string | null,
  externalReference: string | null,
  eventAt: string,
) {
  let local = await findLocalSubscription(supabase, checkoutId, externalReference);
  if (!local) {
    if (await hasPendingBillingOperation(supabase, externalReference)) {
      throw new Error("local_checkout_persistence_pending");
    }
    return { ignored: true, reason: "checkout_not_found" };
  }
  const retryStage = checkoutRetryStage(externalReference);
  const retryAttempt = checkoutRetryAttempt(externalReference);
  const initialRetry = retryStage === "initial";
  const recurringRetry = retryStage === "recurring";
  const currentRetryAttempt = Number(
    initialRetry
      ? local.raw_response?.initialCheckoutAttempt || 0
      : recurringRetry
        ? local.raw_response?.recurrentCheckoutAttempt || 0
        : 0,
  );
  if (retryAttempt !== null && retryAttempt < currentRetryAttempt) {
    return { ignored: true, reason: "superseded_checkout_retry" };
  }
  const initialCheckout =
    initialRetry ||
    /:checkout:initial$/i.test(String(externalReference || "")) ||
    local.raw_response?.initialCheckout?.id === checkoutId;
  if (
    initialCheckout &&
    checkoutId &&
    local.asaas_initial_checkout_id &&
    (!initialRetry || retryAttempt === null || retryAttempt <= currentRetryAttempt) &&
    checkoutId !== local.asaas_initial_checkout_id
  ) {
    return { ignored: true, reason: "superseded_initial_checkout" };
  }
  if (
    !initialCheckout &&
    checkoutId &&
    local.asaas_checkout_id &&
    (!recurringRetry || retryAttempt === null || retryAttempt <= currentRetryAttempt) &&
    checkoutId !== local.asaas_checkout_id
  ) {
    return { ignored: true, reason: "superseded_recurring_checkout" };
  }
  const { data: retryOperation } =
    retryStage && externalReference
      ? await supabase
          .from("billing_operations")
          .select("request_payload")
          .eq("idempotency_key", externalReference)
          .maybeSingle()
      : { data: null };
  const eventTimeKey = initialCheckout ? "initialCheckoutEventAt" : "recurringCheckoutEventAt";
  const retryCreated = retryStage !== null && eventType === "CHECKOUT_CREATED";
  const safeCheckout = sanitizeAsaasResponse(checkout);
  const statusColumn = initialCheckout ? "initial_checkout_status" : "checkout_status";
  const incomingCheckoutStatus = checkoutStatusFromEvent(eventType);
  const transition = await persistProviderTransition({
    supabase,
    table: "asaas_subscriptions",
    rowId: local.id,
    current: local,
    incomingEventAt: eventAt,
    statusColumn,
    // Eventos do Checkout inicial e recorrente possuem relógios independentes.
    // O inicial fica no raw_response; o recorrente também protege a coluna
    // provider_event_at compartilhada com eventos de assinatura.
    eventAtColumn: initialCheckout ? null : "provider_event_at",
    readEventAt: (row) =>
      row.raw_response?.[eventTimeKey] || (!initialCheckout ? row.provider_event_at : null),
    guardColumns: initialCheckout ? [] : ["status"],
    reduce: (currentStatus, currentEventAt, incomingEventAt) =>
      reduceCheckoutStatus(
        retryCreated ? "pending" : (currentStatus as string),
        incomingCheckoutStatus,
        retryCreated ? null : currentEventAt,
        incomingEventAt,
      ),
    buildPatch: ({ current, currentEventAt, nextStatus, acceptedEventAt }) => {
      const nextPatch: Record<string, unknown> = {
        raw_response: {
          ...(current.raw_response || {}),
          ...(initialCheckout
            ? { initialCheckout: safeCheckout }
            : { recurrentCheckout: safeCheckout }),
          lastCheckoutEvent: sanitizeAsaasResponse({ eventType, checkout }),
          [eventTimeKey]: acceptedEventAt,
        },
      };
      if (initialCheckout) {
        nextPatch.asaas_initial_checkout_id = checkoutId || current.asaas_initial_checkout_id;
        nextPatch.initial_checkout_url =
          checkoutResourceUrl(checkout, checkoutId) || current.initial_checkout_url;
        if (nextStatus === "paid") {
          nextPatch.payment_status = reducePaymentStatus(
            current.payment_status,
            "paid",
            currentEventAt,
            eventAt,
          );
        } else if (initialRetry && nextStatus === "pending") {
          const existingPayment = normalizePaymentStatus(current.payment_status);
          nextPatch.payment_status = ["confirmed", "paid"].includes(existingPayment)
            ? existingPayment
            : "pending";
        } else if (["cancelled", "expired"].includes(nextStatus)) {
          nextPatch.payment_status = nextStatus;
        }
      } else {
        nextPatch.asaas_checkout_id = checkoutId || current.asaas_checkout_id;
        nextPatch.checkout_url = checkoutResourceUrl(checkout, checkoutId) || current.checkout_url;
        if (recurringRetry && nextStatus === "pending") {
          nextPatch.asaas_subscription_id = null;
          nextPatch.status = "pending";
          nextPatch.card_registration_status = "awaiting_card";
          nextPatch.cancelled_at = null;
          const requestedNextDueDate = retryOperation?.request_payload?.subscription?.nextDueDate;
          if (requestedNextDueDate) {
            nextPatch.next_due_date = String(requestedNextDueDate).slice(0, 10);
          }
        } else if (nextStatus === "paid") {
          const subscriptionStatus = reduceSubscriptionStatus(
            current.status,
            "active",
            currentEventAt,
            eventAt,
          );
          nextPatch.status = subscriptionStatus;
          nextPatch.card_registration_status =
            subscriptionStatus === "active" ? "registered" : current.card_registration_status;
          const providerSubscriptionCandidate =
            checkout?.subscription?.id || checkout?.subscription;
          const providerSubscriptionId =
            typeof providerSubscriptionCandidate === "string"
              ? providerSubscriptionCandidate
              : null;
          if (providerSubscriptionId) {
            nextPatch.asaas_subscription_id = providerSubscriptionId;
            if (subscriptionStatus === "active") {
              nextPatch.activated_at = current.activated_at || new Date().toISOString();
            }
          }
        } else if (["cancelled", "expired"].includes(nextStatus)) {
          const subscriptionStatus = reduceSubscriptionStatus(
            current.status,
            nextStatus as "cancelled" | "expired",
            currentEventAt,
            eventAt,
          );
          nextPatch.status = subscriptionStatus;
          if (["cancelled", "expired"].includes(subscriptionStatus)) {
            nextPatch.card_registration_status = "failed";
          }
        }
      }
      return nextPatch;
    },
  });
  local = transition.row;
  const checkoutState = transition.nextStatus;

  if (checkoutState === "paid") {
    if (initialCheckout && local.initial_invoice_id) {
      const paymentStatus = normalizePaymentStatus(local.payment_status);
      const { data: invoice, error: invoiceFindError } = await supabase
        .from("faturas_inquilino")
        .select("*")
        .eq("id", local.initial_invoice_id)
        .maybeSingle();
      if (invoiceFindError || !invoice)
        throw invoiceFindError || new Error("initial_invoice_not_found");
      await persistProviderTransition({
        supabase,
        table: "faturas_inquilino",
        rowId: invoice.id,
        current: invoice,
        incomingEventAt: eventAt,
        reduce: (currentStatus, currentEventAt, incomingEventAt) =>
          reducePaymentStatus(
            currentStatus as string,
            paymentStatus,
            currentEventAt,
            incomingEventAt,
          ),
        buildPatch: ({ current, nextStatus }) => ({
          confirmed_at: ["confirmed", "paid"].includes(nextStatus)
            ? current.confirmed_at || new Date().toISOString()
            : current.confirmed_at,
          pago_em:
            nextStatus === "paid" ? current.pago_em || new Date().toISOString() : current.pago_em,
        }),
      });
      if (["confirmed", "paid"].includes(paymentStatus)) {
        await persistConsultationPaymentTransition(
          supabase,
          local.consultation_id,
          paymentStatus,
          eventAt,
          (current) => ({
            payment_confirmed_at: current.payment_confirmed_at || new Date().toISOString(),
          }),
        );
      }
      if (paymentStatus === "paid") {
        const { error: releaseError } = await supabase.rpc("release_commissions_for_invoice", {
          p_invoice_id: local.initial_invoice_id,
          p_event_id: `invoice:${local.initial_invoice_id}:first-paid`,
        });
        if (releaseError) throw releaseError;
      }
    }
  } else if (initialRetry && checkoutState === "pending") {
    if (local.initial_invoice_id) {
      const { data: invoice, error: invoiceFindError } = await supabase
        .from("faturas_inquilino")
        .select("*")
        .eq("id", local.initial_invoice_id)
        .maybeSingle();
      if (invoiceFindError || !invoice)
        throw invoiceFindError || new Error("initial_invoice_not_found");
      await persistProviderTransition({
        supabase,
        table: "faturas_inquilino",
        rowId: invoice.id,
        current: invoice,
        incomingEventAt: eventAt,
        reduce: (currentStatus) => {
          const normalized = normalizePaymentStatus(currentStatus);
          return ["confirmed", "paid"].includes(normalized) ? normalized : "pending";
        },
        buildPatch: () => ({
          payment_url: checkoutResourceUrl(checkout, checkoutId) || local.initial_checkout_url,
        }),
      });
    }
    const { data: consultation, error: consultationError } = await supabase
      .from("consultas_credito")
      .select("*")
      .eq("id", local.consultation_id)
      .maybeSingle();
    if (consultationError || !consultation) {
      throw consultationError || new Error("consultation_not_found");
    }
    await persistProviderTransition({
      supabase,
      table: "consultas_credito",
      rowId: local.consultation_id,
      current: consultation,
      incomingEventAt: eventAt,
      statusColumn: "payment_state",
      eventAtColumn: "payment_provider_event_at",
      reduce: (currentStatus) => {
        const normalized = normalizePaymentStatus(currentStatus);
        return ["confirmed", "paid"].includes(normalized) ? normalized : "pending";
      },
      buildPatch: ({ nextStatus }) => ({ payment_status: nextStatus }),
    });
  } else if (initialCheckout && ["cancelled", "expired"].includes(checkoutState)) {
    if (local.initial_invoice_id) {
      const { data: invoice, error: invoiceFindError } = await supabase
        .from("faturas_inquilino")
        .select("*")
        .eq("id", local.initial_invoice_id)
        .maybeSingle();
      if (invoiceFindError || !invoice)
        throw invoiceFindError || new Error("initial_invoice_not_found");
      await persistProviderTransition({
        supabase,
        table: "faturas_inquilino",
        rowId: invoice.id,
        current: invoice,
        incomingEventAt: eventAt,
        reduce: (currentStatus, currentEventAt, incomingEventAt) =>
          reducePaymentStatus(
            currentStatus as string,
            "cancelled",
            currentEventAt,
            incomingEventAt,
          ),
        buildPatch: () => ({}),
      });
    }
    await persistConsultationPaymentTransition(
      supabase,
      local.consultation_id,
      "cancelled",
      eventAt,
    );
  }

  if (externalReference) {
    const { error: operationError } = await supabase
      .from("billing_operations")
      .update({
        state: "persisted",
        provider_id: checkoutId,
        provider_response: safeCheckout,
        completed_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("idempotency_key", externalReference);
    if (operationError) throw operationError;
  }

  const aggregateKey = buildBillingKey(local.consultation_id, "subscription", "checkout");
  const aggregateRaw = {
    ...(local.raw_response || {}),
    ...(initialCheckout ? { initialCheckout: safeCheckout } : { recurrentCheckout: safeCheckout }),
  };
  const { error: aggregateError } = await supabase
    .from("billing_operations")
    .update({
      state: "provider_created",
      provider_id: checkoutId,
      provider_response: aggregateRaw,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("idempotency_key", aggregateKey)
    .in("state", ["reserved", "provider_created", "ambiguous"]);
  if (aggregateError) throw aggregateError;

  if (checkoutState === "paid") {
    await dispatchContractWhenBillingIsReady(supabase, local.consultation_id, local.payment_status);
  }
  return { ignored: false, checkoutStatus: checkoutState, initialCheckout };
}

async function handleSubscriptionEvent(
  supabase: any,
  eventType: string,
  subscription: any,
  subscriptionId: string | null,
  externalReference: string | null,
  eventAt: string,
) {
  let local = await findLocalSubscription(supabase, subscriptionId, externalReference);
  if (!local) {
    const checkoutCandidate =
      subscription?.checkout?.id ||
      subscription?.checkout ||
      subscription?.checkoutSession?.id ||
      subscription?.checkoutSession;
    const relatedCheckoutId = typeof checkoutCandidate === "string" ? checkoutCandidate : null;
    if (relatedCheckoutId) {
      local = await findLocalSubscription(supabase, relatedCheckoutId, null);
    }
  }
  if (!local) {
    if (await hasPendingBillingOperation(supabase, externalReference)) {
      throw new Error("local_subscription_persistence_pending");
    }
    return { ignored: true, reason: "subscription_not_found" };
  }
  if (local.status === "cancelled" && subscriptionId) {
    try {
      await asaasFetch(`/subscriptions/${subscriptionId}`, { method: "DELETE" });
    } catch (error) {
      if (!(error instanceof AsaasApiError && error.status === 404)) {
        throw error;
      }
    }
    await supabase
      .from("asaas_subscriptions")
      .update({
        asaas_subscription_id: subscriptionId,
        status: "cancelled",
        card_registration_status: "failed",
        cancelled_at: local.cancelled_at || new Date().toISOString(),
        raw_response: {
          ...(local.raw_response || {}),
          cancelledLateProviderSubscription: sanitizeAsaasResponse(subscription),
        },
      })
      .eq("id", local.id);
    return { ignored: false, cancelledLateSubscription: true };
  }
  const incoming = subscriptionStatusFromEvent(eventType, subscription?.status);
  const subscriptionTransition = await persistProviderTransition({
    supabase,
    table: "asaas_subscriptions",
    rowId: local.id,
    current: local,
    incomingEventAt: eventAt,
    reduce: (currentStatus, currentEventAt, incomingEventAt) =>
      reduceSubscriptionStatus(currentStatus as string, incoming, currentEventAt, incomingEventAt),
    buildPatch: ({ current, nextStatus, staleEvent }) => ({
      asaas_subscription_id: subscriptionId || current.asaas_subscription_id,
      card_registration_status:
        current.mode === "checkout" && nextStatus === "active"
          ? "registered"
          : nextStatus === "error"
            ? "failed"
            : current.card_registration_status,
      raw_response: staleEvent ? current.raw_response : sanitizeAsaasResponse(subscription),
      activated_at:
        nextStatus === "active"
          ? current.activated_at || new Date().toISOString()
          : current.activated_at,
      cancelled_at:
        nextStatus === "cancelled"
          ? current.cancelled_at || new Date().toISOString()
          : current.cancelled_at,
    }),
  });
  local = subscriptionTransition.row;
  const status = subscriptionTransition.nextStatus;
  if (externalReference) {
    const { error: operationError } = await supabase
      .from("billing_operations")
      .update({
        state: "persisted",
        provider_id: subscriptionId,
        provider_response: sanitizeAsaasResponse(subscription),
        completed_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("idempotency_key", externalReference);
    if (operationError) throw operationError;
  }
  if (status === "active") {
    await dispatchContractWhenBillingIsReady(supabase, local.consultation_id, local.payment_status);
  }
  return { ignored: false, subscriptionStatus: status };
}

async function materializeSubscriptionPayment(
  supabase: any,
  providerPayment: any,
  status: ReturnType<typeof normalizePaymentStatus>,
  providerEventAt: string,
) {
  const providerSubscriptionId =
    typeof providerPayment?.subscription === "string"
      ? providerPayment.subscription
      : providerPayment?.subscription?.id;
  if (!providerSubscriptionId || !providerPayment?.id) return null;
  const { data: existing } = await supabase
    .from("asaas_payments")
    .select("*")
    .eq("asaas_payment_id", providerPayment.id)
    .maybeSingle();

  const { data: subscription } = await supabase
    .from("asaas_subscriptions")
    .select("*")
    .eq("asaas_subscription_id", providerSubscriptionId)
    .maybeSingle();
  if (!subscription) throw new Error("subscription_payment_parent_not_found");
  const dueDate = providerPayment.dueDate || subscription.next_due_date;
  const { data: initialInvoice } = await supabase
    .from("faturas_inquilino")
    .select("*")
    .eq("id", subscription.initial_invoice_id)
    .maybeSingle();
  const initialMonth = new Date(
    `${initialInvoice?.reference_month || initialInvoice?.vencimento.slice(0, 7) + "-01"}T00:00:00Z`,
  );
  const dueMonth = new Date(`${String(dueDate).slice(0, 7)}-01T00:00:00Z`);
  const monthDelta =
    (dueMonth.getUTCFullYear() - initialMonth.getUTCFullYear()) * 12 +
    dueMonth.getUTCMonth() -
    initialMonth.getUTCMonth();
  const installmentNumber = Math.max(2, monthDelta + 1);
  const idempotencyKey = `nox:provider-payment:${providerPayment.id}`;
  let payment = existing;
  const effectivePaymentStatus = existing
    ? reducePaymentStatus(existing.status, status, existing.provider_event_at, providerEventAt)
    : status;
  if (!payment) {
    const { data, error } = await supabase
      .from("asaas_payments")
      .insert({
        consultation_id: subscription.consultation_id,
        proposal_id: subscription.consultation_id,
        user_id: subscription.created_by,
        tenant_user_id: subscription.tenant_user_id,
        asaas_customer_id: subscription.asaas_customer_id,
        asaas_payment_id: providerPayment.id,
        external_reference: idempotencyKey,
        idempotency_key: idempotencyKey,
        charge_kind: "monthly",
        payment_method: "credit_card",
        value: Number(providerPayment.value || subscription.monthly_amount),
        status: effectivePaymentStatus,
        due_date: dueDate,
        confirmed_at: effectivePaymentStatus === "confirmed" ? new Date().toISOString() : null,
        received_at:
          effectivePaymentStatus === "paid"
            ? providerPayment.paymentDate || new Date().toISOString()
            : null,
        raw_response: sanitizeAsaasResponse(providerPayment),
        provider_event_at: providerEventAt,
        payment_responsible: subscription.payment_responsible,
        recipient_type: subscription.recipient_type,
        recipient_user_id: subscription.recipient_user_id,
        recipient_tenant_id: subscription.recipient_tenant_id,
        recipient_name: subscription.recipient_name,
        recipient_email: subscription.recipient_email,
        recipient_phone: subscription.recipient_phone,
      })
      .select("*")
      .maybeSingle();
    if (error || !data) throw error || new Error("subscription_payment_persist_failed");
    payment = data;
  }

  // A redelivery tambem repara o caso em que o pagamento local foi gravado,
  // mas a fatura mensal falhou. O upsert por billing_key torna a reparacao
  // idempotente e impede evento "processado" com mensalidade orfa.
  const billingKey = buildBillingKey(
    subscription.consultation_id,
    "monthly",
    String(dueDate).slice(0, 7),
  );
  const { data: existingInvoice, error: invoiceFindError } = await supabase
    .from("faturas_inquilino")
    .select("id, status, provider_event_at")
    .eq("billing_key", billingKey)
    .maybeSingle();
  if (invoiceFindError) throw invoiceFindError;
  const effectiveInvoiceStatus = existingInvoice
    ? reducePaymentStatus(
        existingInvoice.status,
        status,
        existingInvoice.provider_event_at,
        providerEventAt,
      )
    : effectivePaymentStatus;
  await materializeInvoice(supabase, {
    consultation: {
      id: subscription.consultation_id,
      tenant_user_id: subscription.tenant_user_id,
    },
    recipient: {
      paymentResponsible: subscription.payment_responsible,
      recipientType: subscription.recipient_type,
      recipientUserId: subscription.recipient_user_id,
      recipientTenantId: subscription.recipient_tenant_id,
      recipientName: subscription.recipient_name,
      recipientEmail: subscription.recipient_email,
      recipientPhone: subscription.recipient_phone,
    },
    billingKey,
    installmentNumber,
    installmentTotal: Number(initialInvoice?.installment_total || installmentNumber),
    dueDate,
    value: Number(providerPayment.value || subscription.monthly_amount),
    status: effectiveInvoiceStatus,
    chargeKind: "monthly",
    paymentMethod: "credit_card",
    components: { subscriptionId: subscription.id, providerSubscriptionId },
    paymentUrl: providerPayment.invoiceUrl || null,
    localPaymentId: payment.id,
    subscriptionId: subscription.id,
    referenceMonth: `${String(dueDate).slice(0, 7)}-01`,
    providerEventAt,
  });
  await persistProviderTransition({
    supabase,
    table: "asaas_subscriptions",
    rowId: subscription.id,
    current: subscription,
    incomingEventAt: providerEventAt,
    statusColumn: "payment_status",
    eventAtColumn: null,
    reduce: (currentStatus) => reducePaymentStatus(currentStatus as string, effectivePaymentStatus),
    buildPatch: () => ({}),
  });
  return payment;
}

async function markEvent(
  supabase: any,
  eventId: string,
  status: string,
  errorMessage: string | null,
  audit?: { invoiceId: string | null; oldStatus: string | null; newStatus: string | null },
) {
  let nextAttemptAt: string | null = null;
  if (status === "error") {
    const { data: event } = await supabase
      .from("asaas_webhook_events")
      .select("attempts")
      .eq("event_id", eventId)
      .maybeSingle();
    const attempts = Math.max(1, Number(event?.attempts || 1));
    const delaySeconds = Math.min(300, 15 * 2 ** Math.min(attempts - 1, 5));
    nextAttemptAt = new Date(Date.now() + delaySeconds * 1_000).toISOString();
  }
  await supabase
    .from("asaas_webhook_events")
    .update({
      status,
      error_message: errorMessage,
      processed_at: new Date().toISOString(),
      locked_at: null,
      next_attempt_at: nextAttemptAt,
      ...(audit
        ? { invoice_id: audit.invoiceId, old_status: audit.oldStatus, new_status: audit.newStatus }
        : {}),
    })
    .eq("event_id", eventId);
}

// Reconciliacao do boleto consolidado. So confirma/recebe quando o valor
// pago bate com o total esperado (com tolerancia de centavos) - pagamento
// parcial nunca quita automaticamente as faturas individuais (fica marcado
// "partial" pra revisao). Ao confirmar por completo, marca cada fatura
// individual como paga internamente (nunca falsifica um PAYMENT_RECEIVED do
// Asaas na cobranca individual) e tenta cancelar no Asaas a cobranca
// individual que ainda estivesse aberta, pra impedir pagamento duplicado.
async function handleConsolidatedBatchEvent(
  supabase: any,
  batch: any,
  eventType: string,
  internalStatus: string,
  payment: any,
  providerEventAt: string,
  eventId: string,
) {
  if (
    !shouldApplyConsolidatedEvent({
      currentStatus: batch.status,
      currentEventAt: batch.provider_event_at,
      incomingEventAt: providerEventAt,
    })
  )
    return;
  const transitionBatch = async (
    incoming: "active" | "partial" | "paid" | "cancelled",
    buildPatch: (current: any, nextStatus: string) => Record<string, unknown>,
  ) => {
    const result = await persistProviderTransition({
      supabase,
      table: "consolidated_invoice_batches",
      rowId: batch.id,
      current: batch,
      incomingEventAt: providerEventAt,
      guardColumns: [
        "reconciliation_status",
        "reconciliation_event_id",
        "reconciliation_locked_at",
      ],
      reduce: (currentStatus, currentEventAt, incomingEventAt) =>
        reduceConsolidatedBatchStatus(currentStatus, incoming, currentEventAt, incomingEventAt),
      buildPatch: ({ current, nextStatus }) => buildPatch(current, nextStatus),
    });
    batch = result.row;
    return result;
  };
  if (eventType === "PAYMENT_CONFIRMED") {
    // Confirmação bancária não é recebimento efetivo para fins de comissão.
    // O lote permanece ativo até o Asaas emitir PAYMENT_RECEIVED.
    await transitionBatch("active", () => ({}));
    return;
  }

  if (eventType === "PAYMENT_RECEIVED") {
    const valorPago = toMoney(payment?.value ?? payment?.netValue ?? batch.total_value);
    const bateValor = Math.abs(valorPago - Number(batch.total_value)) <= 0.02;

    if (!bateValor) {
      await transitionBatch("partial", (_current, nextStatus) => ({
        received_value: nextStatus === "partial" ? valorPago : batch.received_value,
        paid_at: nextStatus === "partial" ? new Date().toISOString() : batch.paid_at,
      }));
      return;
    }

    await transitionBatch("active", (current) => {
      if (
        current.reconciliation_status === "processing" &&
        current.reconciliation_event_id !== eventId
      ) {
        const lockedAt = Date.parse(String(current.reconciliation_locked_at || ""));
        if (Number.isFinite(lockedAt) && lockedAt > Date.now() - 5 * 60_000) {
          throw new Error("batch_reconciliation_in_progress");
        }
      }
      return {
        received_value: valorPago,
        paid_at: new Date().toISOString(),
        reconciliation_status: "processing",
        reconciliation_error: null,
        reconciliation_event_id: eventId,
        reconciliation_locked_at: new Date().toISOString(),
      };
    });

    const { data: batchRecipient } = await supabase
      .from("profiles")
      .select("nome, email, telefone")
      .eq("id", batch.agency_user_id)
      .maybeSingle();
    if (batchRecipient?.email) {
      const alreadySent = await wasNotificationSent(supabase, {
        batchId: batch.id,
        channel: "email",
        notificationType: "payment_confirmed",
      });
      if (!alreadySent) {
        const result = await sendPaymentEmail({
          to: batchRecipient.email,
          nome: batchRecipient.nome || "cliente",
          tipo: "confirmado",
          valor: Number(batch.total_value || 0),
          metodo: batch.billing_method || "boleto",
          vencimento: batch.due_date,
          contratoRef: `cobrança consolidada ${String(batch.reference_month).padStart(2, "0")}/${batch.reference_year}`,
        });
        await logFinancialNotification(supabase, {
          batchId: batch.id,
          recipientType: "user",
          recipientId: batch.agency_user_id,
          channel: "email",
          notificationType: "payment_confirmed",
          result,
        });
      }
    }
    if (batchRecipient?.telefone && (await isBillingWhatsappDispatchEnabled(supabase))) {
      const alreadySent = await wasNotificationSent(supabase, {
        batchId: batch.id,
        channel: "whatsapp",
        notificationType: "payment_confirmed",
      });
      if (!alreadySent) {
        const amount = Number(batch.total_value || 0).toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
        });
        const result = await sendPaymentWhatsapp({
          to: batchRecipient.telefone,
          mensagem: `Olá, ${batchRecipient.nome || "cliente"}. O pagamento da cobrança consolidada de ${amount} foi confirmado. Todas as mensalidades incluídas no lote já receberam baixa automática na NOX Fiança.`,
        });
        await logFinancialNotification(supabase, {
          batchId: batch.id,
          recipientType: "user",
          recipientId: batch.agency_user_id,
          channel: "whatsapp",
          notificationType: "payment_confirmed",
          result,
        });
      }
    }

    const { data: itens } = await supabase
      .from("consolidated_invoice_items")
      .select(
        "*, fatura:faturas_inquilino(id, asaas_payment_id, status, provider_event_at, pago_em)",
      )
      .eq("batch_id", batch.id)
      .eq("status", "active");

    for (const item of itens ?? []) {
      // status distinto de "paid" (quitacao individual real no Asaas) -
      // deixa explicito pro inquilino/corretor/imobiliaria que essa parcela
      // foi paga atraves do boleto consolidado, nao de uma cobranca propria.
      try {
        await persistProviderTransition({
          supabase,
          table: "faturas_inquilino",
          rowId: item.fatura_id,
          current: item.fatura,
          incomingEventAt: providerEventAt,
          reduce: (currentStatus) => {
            const normalized = normalizePaymentStatus(currentStatus);
            return ["confirmed", "paid"].includes(normalized)
              ? String(currentStatus)
              : "paid_via_consolidated";
          },
          buildPatch: ({ current, nextStatus }) => ({
            pago_em:
              nextStatus === "paid_via_consolidated"
                ? current.pago_em || new Date().toISOString()
                : current.pago_em,
          }),
        });
      } catch {
        throw new Error(`consolidated_invoice_update_failed:${item.fatura_id}`);
      }

      try {
        await persistConsultationPaymentTransition(
          supabase,
          item.consulta_id,
          "paid",
          providerEventAt,
          (current) => ({
            payment_received_at: current.payment_received_at || new Date().toISOString(),
            payment_confirmed_at: current.payment_confirmed_at || new Date().toISOString(),
          }),
        );
      } catch {
        throw new Error(`consolidated_consultation_update_failed:${item.consulta_id}`);
      }

      const { data: signature, error: signatureError } = await supabase
        .from("contract_signatures")
        .select("*")
        .eq("consultation_id", item.consulta_id)
        .maybeSingle();
      if (signatureError) throw signatureError;
      if (
        signature?.signature_status === "signed" ||
        ["signed", "active"].includes(signature?.status)
      ) {
        await finalizeD4SignContract(supabase, signature);
      }

      const { error: releaseError } = await supabase.rpc("release_commissions_for_invoice", {
        p_invoice_id: item.fatura_id,
        p_event_id: `invoice:${item.fatura_id}:first-paid`,
      });
      if (releaseError) {
        throw new Error(`consolidated_commission_release_failed:${item.fatura_id}`);
      }

      const faturaAsaasPaymentRowId = item.fatura?.asaas_payment_id;
      if (!faturaAsaasPaymentRowId) {
        await supabase
          .from("consolidated_invoice_items")
          .update({ status: "paid_via_consolidated" })
          .eq("id", item.id);
        continue;
      }

      const { data: pagamentoIndividual } = await supabase
        .from("asaas_payments")
        .select("asaas_payment_id, status")
        .eq("id", faturaAsaasPaymentRowId)
        .maybeSingle();
      const individualAsaasChargeId = pagamentoIndividual?.asaas_payment_id;

      if (
        !individualAsaasChargeId ||
        pagamentoIndividual?.status === "paid" ||
        pagamentoIndividual?.status === "cancelled"
      ) {
        await supabase
          .from("consolidated_invoice_items")
          .update({ status: "paid_via_consolidated" })
          .eq("id", item.id);
        continue;
      }

      const resultado = await cancelAsaasPayment(individualAsaasChargeId);
      if (resultado.cancelled) {
        await supabase
          .from("asaas_payments")
          .update({ status: "cancelled" })
          .eq("id", faturaAsaasPaymentRowId);
        await supabase
          .from("consolidated_invoice_items")
          .update({ status: "paid_via_consolidated" })
          .eq("id", item.id);
      } else {
        console.error(
          "[asaas-webhook] nao foi possivel cancelar cobranca individual apos consolidado pago",
          {
            batchId: batch.id,
            itemId: item.id,
            individualAsaasChargeId,
          },
        );
        await supabase
          .from("consolidated_invoice_items")
          .update({ status: "manual_review_required" })
          .eq("id", item.id);
      }
    }
    const completed = await transitionBatch("paid", () => ({
      reconciliation_status: "complete",
      reconciliation_error: null,
      reconciliation_event_id: eventId,
      reconciliation_locked_at: null,
    }));
    if (completed.nextStatus !== "paid") {
      throw new Error("batch_paid_transition_rejected");
    }
    return;
  }

  if (eventType === "PAYMENT_OVERDUE") {
    await transitionBatch("active", () => ({}));
    return;
  }
  if (eventType === "PAYMENT_DELETED" || eventType === "PAYMENT_BANK_SLIP_CANCELLED") {
    // Lote cancelado/vencido sem pagamento - libera as faturas individuais
    // (remove o vinculo de consolidacao) pra poderem ser cobradas de novo ou
    // entrar em outro lote futuro.
    const cancelledTransition = await transitionBatch("cancelled", (_current, nextStatus) =>
      nextStatus === "cancelled"
        ? {
            invoice_url: null,
            bank_slip_url: null,
            identification_field: null,
            pix_qr_code: null,
            pix_copy_paste: null,
            pix_expires_at: null,
          }
        : {},
    );
    if (cancelledTransition.nextStatus !== "cancelled") return;
    const { data: itens } = await supabase
      .from("consolidated_invoice_items")
      .select("id, fatura_id")
      .eq("batch_id", batch.id)
      .eq("status", "active");
    for (const item of itens ?? []) {
      await supabase
        .from("faturas_inquilino")
        .update({ consolidated_item_id: null })
        .eq("id", item.fatura_id);
      await supabase
        .from("consolidated_invoice_items")
        .update({ status: "cancelled_after_consolidation" })
        .eq("id", item.id);
    }
    return;
  }

  console.error("[asaas-webhook] evento de lote consolidado nao tratado explicitamente", {
    batchId: batch.id,
    eventType,
    internalStatus,
  });
}

async function isBillingWhatsappDispatchEnabled(supabase: any) {
  const { data } = await supabase
    .from("billing_automation_settings")
    .select("enabled, dispatch_enabled")
    .eq("id", true)
    .maybeSingle();
  return data?.enabled !== false && data?.dispatch_enabled === true;
}
