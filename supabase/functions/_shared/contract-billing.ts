import {
  AsaasApiError,
  HttpError,
  PaymentMethod,
  PaymentRecipient,
  asaasFetch,
  findAsaasPaymentByExternalReference,
  findAsaasSubscriptionByExternalReference,
  hashPayload,
  logFinancialNotification,
  runInBackground,
  sendPaymentEmail,
  sendPaymentWhatsapp,
  wasNotificationSent,
} from "./asaas.ts";
import {
  billingOperationCanBeReclaimed,
  buildBillingKey,
  normalizePaymentStatus,
  persistProviderTransition,
  reducePaymentStatus,
} from "./billing-state.ts";
import { dispatchD4SignContract, ensurePendingPolicy } from "./d4sign.ts";
import { buildPaymentRequestWhatsappContent } from "./payment-notification-content.ts";

function duplicateError(error: any) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "23505" || message.includes("duplicate") || message.includes("unique");
}

export async function claimBillingOperation(
  supabase: any,
  params: {
    consultationId: string;
    invoiceId?: string | null;
    operationType:
      "payment" | "installment" | "subscription" | "checkout" | "notification" | "d4sign";
    idempotencyKey: string;
    request: unknown;
    userId?: string | null;
  },
) {
  const requestHash = await hashPayload(params.request);
  const { data, error } = await supabase
    .from("billing_operations")
    .insert({
      consultation_id: params.consultationId,
      invoice_id: params.invoiceId || null,
      operation_type: params.operationType,
      idempotency_key: params.idempotencyKey,
      request_hash: requestHash,
      request_payload: params.request,
      state: "reserved",
      created_by: params.userId || null,
      locked_at: new Date().toISOString(),
    })
    .select("*")
    .maybeSingle();
  if (!error && data) return { operation: data, claimed: true };
  if (!duplicateError(error)) throw error;

  const { data: existing, error: findError } = await supabase
    .from("billing_operations")
    .select("*")
    .eq("idempotency_key", params.idempotencyKey)
    .maybeSingle();
  if (findError || !existing) throw findError || error;
  if (existing.request_hash !== requestHash) {
    throw new HttpError(409, "A mesma operacao foi solicitada com dados diferentes.");
  }
  // Falhas deterministicas do provedor (4xx) garantem que nenhum recurso foi
  // criado. A retomada condicional evita deixar a intencao travada e, ao
  // mesmo tempo, permite somente um novo chamador por vez.
  if (existing.state === "failed" && !existing.provider_id) {
    const { data: reclaimed, error: reclaimError } = await supabase
      .from("billing_operations")
      .update({
        state: "reserved",
        attempts: Number(existing.attempts || 0) + 1,
        last_error: null,
        locked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .eq("state", "failed")
      .select("*")
      .maybeSingle();
    if (reclaimError) throw reclaimError;
    if (reclaimed) return { operation: reclaimed, claimed: true };
  }
  return { operation: existing, claimed: false };
}

export async function updateBillingOperation(
  supabase: any,
  operationId: string,
  patch: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("billing_operations")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", operationId);
  if (error) throw error;
}

/**
 * Reabre uma reserva somente depois que o chamador consultou o provedor pela
 * externalReference e comprovou que nenhum recurso existe. O CAS por estado,
 * provider_id e locked_at impede que dois retries ganhem a mesma reserva.
 */
export async function reclaimStaleBillingOperation(supabase: any, operation: any) {
  if (!billingOperationCanBeReclaimed(operation)) return null;
  const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  let query = supabase
    .from("billing_operations")
    .update({
      locked_at: new Date().toISOString(),
      attempts: Number(operation.attempts || 0) + 1,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", operation.id)
    .eq("state", "reserved")
    .is("provider_id", null)
    .lt("locked_at", cutoff);
  if (operation.locked_at) query = query.eq("locked_at", operation.locked_at);
  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function cancelContractSubscription(
  supabase: any,
  params: {
    consultationId: string;
    actorId?: string | null;
    reason: string;
  },
) {
  const { data: subscription, error: subscriptionError } = await supabase
    .from("asaas_subscriptions")
    .select("*")
    .eq("consultation_id", params.consultationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (subscriptionError) throw subscriptionError;
  if (!subscription) return { cancelled: false, reason: "subscription_not_found" as const };

  const cancellationKey = buildBillingKey(
    params.consultationId,
    "subscription",
    `cancel-${subscription.id}`,
  );
  const { operation, claimed } = await claimBillingOperation(supabase, {
    consultationId: params.consultationId,
    operationType: "subscription",
    idempotencyKey: cancellationKey,
    request: {
      subscriptionId: subscription.id,
      providerSubscriptionId: subscription.asaas_subscription_id || null,
      checkoutIds: [subscription.asaas_initial_checkout_id, subscription.asaas_checkout_id].filter(
        Boolean,
      ),
    },
    userId: params.actorId || null,
  });

  const providerId = subscription.asaas_subscription_id || null;
  const checkoutIds = [
    ...new Set(
      [subscription.asaas_initial_checkout_id, subscription.asaas_checkout_id].filter(Boolean),
    ),
  ] as string[];
  const previousResponse = operation.provider_response || {};
  const providerResponse: any = {
    subscription:
      previousResponse.subscription || (previousResponse.cancelled ? previousResponse : null),
    checkouts: { ...(previousResponse.checkouts || {}) },
  };
  try {
    for (const checkoutId of checkoutIds) {
      if (providerResponse.checkouts[checkoutId]?.cancelled) continue;
      const result = await ensureCheckoutClosed(checkoutId);
      providerResponse.checkouts[checkoutId] = result;
      await updateBillingOperation(supabase, operation.id, {
        state: "provider_created",
        provider_id: providerId || checkoutId,
        provider_response: providerResponse,
        last_error: null,
      });
    }

    if (providerId && !providerResponse.subscription?.cancelled) {
      const result = await ensureSubscriptionCancelled(providerId);
      providerResponse.subscription = result;
      await updateBillingOperation(supabase, operation.id, {
        state: "provider_created",
        provider_id: providerId,
        provider_response: providerResponse,
        last_error: null,
      });
    }
  } catch (error) {
    await updateBillingOperation(supabase, operation.id, {
      state: error instanceof AsaasApiError && error.status < 500 ? "failed" : "ambiguous",
      provider_id: providerId || checkoutIds[0] || null,
      provider_response: providerResponse,
      last_error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const providerConfirmed =
    (!providerId || providerResponse.subscription?.cancelled === true) &&
    checkoutIds.every((id) => providerResponse.checkouts[id]?.cancelled === true);
  if (!providerConfirmed) {
    return { cancelled: false, reason: "provider_not_confirmed" as const, manualReview: true };
  }

  const cancelledAt = subscription.cancelled_at || new Date().toISOString();
  const { data: cancelled, error: persistError } = await supabase
    .from("asaas_subscriptions")
    .update({
      status: "cancelled",
      card_registration_status:
        subscription.card_registration_status === "registered"
          ? "failed"
          : subscription.card_registration_status,
      checkout_status:
        subscription.checkout_status === "paid" ? subscription.checkout_status : "cancelled",
      cancelled_at: cancelledAt,
      raw_response: {
        ...(subscription.raw_response || {}),
        cancellation: sanitizeCancellationResponse(providerResponse, params.reason),
      },
    })
    .eq("id", subscription.id)
    .select("*")
    .maybeSingle();
  if (persistError || !cancelled) {
    await updateBillingOperation(supabase, operation.id, {
      state: "provider_created",
      provider_id: providerId,
      provider_response: providerResponse,
      last_error: persistError?.message || "subscription_cancellation_persist_failed",
    });
    throw persistError || new Error("subscription_cancellation_persist_failed");
  }
  await updateBillingOperation(supabase, operation.id, {
    state: "persisted",
    provider_id: providerId,
    provider_response: providerResponse,
    completed_at: new Date().toISOString(),
    last_error: null,
  });
  if (subscription.status !== "cancelled") {
    await supabase.from("proposta_historico").insert({
      consulta_id: params.consultationId,
      tipo_evento: "assinatura_asaas_cancelada",
      descricao: `Recorrencia Asaas cancelada. Motivo: ${params.reason.slice(0, 300)}`,
    });
  }
  return { cancelled: true, subscription: cancelled, reused: !claimed };
}

async function ensureCheckoutClosed(checkoutId: string) {
  try {
    const current = await asaasFetch(`/checkouts/${checkoutId}`);
    const status = String(current?.status || "").toUpperCase();
    if (["CANCELLED", "CANCELED", "EXPIRED", "PAID", "COMPLETED"].includes(status)) {
      return {
        id: checkoutId,
        cancelled: true,
        status,
        response: sanitizeCancellationResponse(current, "reconciled"),
      };
    }
  } catch (error) {
    if (error instanceof AsaasApiError && error.status === 404) {
      return { id: checkoutId, cancelled: true, notFound: true };
    }
    throw error;
  }
  const raw = await asaasFetch(`/checkouts/${checkoutId}/cancel`, { method: "POST" });
  return {
    id: checkoutId,
    cancelled: true,
    response: sanitizeCancellationResponse(raw, "cancelled"),
  };
}

async function ensureSubscriptionCancelled(providerId: string) {
  try {
    const current = await asaasFetch(`/subscriptions/${providerId}`);
    const status = String(current?.status || "").toUpperCase();
    if (["CANCELLED", "CANCELED", "DELETED", "INACTIVE"].includes(status)) {
      return {
        id: providerId,
        cancelled: true,
        status,
        response: sanitizeCancellationResponse(current, "reconciled"),
      };
    }
  } catch (error) {
    if (error instanceof AsaasApiError && error.status === 404) {
      return { id: providerId, cancelled: true, notFound: true };
    }
    throw error;
  }
  const raw = await asaasFetch(`/subscriptions/${providerId}`, { method: "DELETE" });
  return {
    id: providerId,
    cancelled: true,
    response: sanitizeCancellationResponse(raw, "cancelled"),
  };
}

function sanitizeCancellationResponse(raw: any, reason: string) {
  if (!raw || typeof raw !== "object") return { cancelled: true, reason };
  return { ...raw, reason };
}

export async function recoverPaymentForOperation(operation: any, externalReference: string) {
  if (operation?.provider_response?.id) return operation.provider_response;
  if (operation?.provider_id) {
    try {
      return await asaasFetch(`/payments/${operation.provider_id}`);
    } catch (error) {
      if (!(error instanceof AsaasApiError) || error.status !== 404) throw error;
    }
  }
  return await findAsaasPaymentByExternalReference(externalReference);
}

export async function recoverSubscriptionForOperation(operation: any, externalReference: string) {
  if (operation?.provider_response?.id) return operation.provider_response;
  if (operation?.provider_id) {
    try {
      return await asaasFetch(`/subscriptions/${operation.provider_id}`);
    } catch (error) {
      if (!(error instanceof AsaasApiError) || error.status !== 404) throw error;
    }
  }
  return await findAsaasSubscriptionByExternalReference(externalReference);
}

export async function materializeInvoice(
  supabase: any,
  params: {
    consultation: any;
    recipient: PaymentRecipient;
    billingKey?: string;
    installmentNumber: number;
    installmentTotal: number;
    dueDate: string;
    value: number;
    status: string;
    chargeKind: "initial" | "monthly" | "activation" | "adjustment";
    paymentMethod: PaymentMethod | "consolidated";
    components?: Record<string, unknown>;
    paymentUrl?: string | null;
    localPaymentId?: string | null;
    subscriptionId?: string | null;
    referenceMonth?: string | null;
    providerEventAt?: string | null;
  },
) {
  const billingKey =
    params.billingKey ||
    buildBillingKey(
      params.consultation.id,
      params.chargeKind === "initial" ? "initial" : "monthly",
      params.installmentNumber,
    );
  const payload: Record<string, unknown> = {
    consulta_id: params.consultation.id,
    tenant_user_id:
      params.consultation.tenant_user_id || params.recipient.recipientTenantId || null,
    numero_parcela: params.installmentNumber,
    installment_total: params.installmentTotal,
    vencimento: params.dueDate,
    valor: params.value,
    status: params.status,
    boleto_url: params.paymentMethod === "boleto" ? params.paymentUrl || null : null,
    payment_responsible: params.recipient.paymentResponsible,
    recipient_user_id: params.recipient.recipientUserId,
    asaas_payment_id: params.localPaymentId || null,
    billing_key: billingKey,
    charge_kind: params.chargeKind,
    payment_method: params.paymentMethod,
    components: params.components || {},
    payment_url: params.paymentUrl || null,
    asaas_subscription_id: params.subscriptionId || null,
    reference_month: params.referenceMonth || `${params.dueDate.slice(0, 7)}-01`,
  };
  if (params.providerEventAt) payload.provider_event_at = params.providerEventAt;
  const { data, error } = await supabase
    .from("faturas_inquilino")
    .insert(payload)
    .select("*")
    .maybeSingle();
  if (!error && data) return data;
  if (!duplicateError(error)) throw error;

  const { data: existing, error: findError } = await supabase
    .from("faturas_inquilino")
    .select("*")
    .eq("billing_key", billingKey)
    .maybeSingle();
  if (findError || !existing) throw findError || error;

  const safePatch = {
    tenant_user_id: existing.tenant_user_id || payload.tenant_user_id,
    recipient_user_id: existing.recipient_user_id || payload.recipient_user_id,
    asaas_payment_id: payload.asaas_payment_id || existing.asaas_payment_id,
    asaas_subscription_id: payload.asaas_subscription_id || existing.asaas_subscription_id,
    boleto_url: payload.boleto_url || existing.boleto_url,
    payment_url: payload.payment_url || existing.payment_url,
    payment_method: payload.payment_method || existing.payment_method,
    components: {
      ...(existing.components || {}),
      ...((payload.components as Record<string, unknown>) || {}),
    },
  };
  if (!params.providerEventAt) {
    const { data: repaired, error: repairError } = await supabase
      .from("faturas_inquilino")
      .update(safePatch)
      .eq("id", existing.id)
      .select("*")
      .maybeSingle();
    if (repairError) throw repairError;
    return repaired || existing;
  }

  const transition = await persistProviderTransition({
    supabase,
    table: "faturas_inquilino",
    rowId: existing.id,
    current: existing,
    incomingEventAt: params.providerEventAt,
    reduce: (currentStatus, currentEventAt, incomingEventAt) =>
      reducePaymentStatus(
        currentStatus as string,
        normalizePaymentStatus(params.status),
        currentEventAt,
        incomingEventAt,
      ),
    buildPatch: () => safePatch,
  });
  return transition.row;
}

export function publicRecipient(recipient: PaymentRecipient) {
  const maskEmail = (email?: string | null) => {
    if (!email) return null;
    const [user, domain] = email.split("@");
    if (!domain) return email;
    return `${user.slice(0, 2)}${"*".repeat(Math.max(2, user.length - 2))}@${domain}`;
  };
  const maskPhone = (phone?: string | null) => {
    if (!phone) return null;
    const digits = String(phone).replace(/\D/g, "");
    return digits.length >= 4 ? `+55 (***) *****-${digits.slice(-4)}` : phone;
  };
  return {
    responsible: recipient.paymentResponsible,
    type: recipient.recipientType,
    userId: recipient.recipientUserId,
    tenantId: recipient.recipientTenantId,
    name: recipient.recipientName,
    emailMasked: maskEmail(recipient.recipientEmail),
    phoneMasked: maskPhone(recipient.recipientPhone),
  };
}

function notificationStatus(row: any) {
  if (!row) return { status: "skipped", sentAt: null, error: null };
  return {
    status: ["sent", "queued", "delivered", "read"].includes(row.status)
      ? row.status
      : row.status === "failed" || row.status === "not_configured"
        ? "failed"
        : "queued",
    sentAt: row.sent_at || null,
    error: row.last_error || null,
  };
}

export async function getInvoiceNotificationSummary(
  supabase: any,
  invoiceId: string,
  notificationType = "payment_created",
) {
  const { data } = await supabase
    .from("financial_notifications")
    .select("channel, status, sent_at, last_error")
    .eq("invoice_id", invoiceId)
    .eq("notification_type", notificationType);
  const byChannel = new Map((data || []).map((row: any) => [row.channel, row]));
  return {
    email: notificationStatus(byChannel.get("email")),
    whatsapp: notificationStatus(byChannel.get("whatsapp")),
  };
}

export async function sendInvoiceNotifications(
  supabase: any,
  params: {
    invoice: any;
    recipient: PaymentRecipient;
    paymentMethod: PaymentMethod;
    amount: number;
    dueDate: string;
    paymentUrl?: string | null;
    pixCopyPaste?: string | null;
    boletoBarcode?: string | null;
    contractRef: string;
    secondaryPaymentUrl?: string | null;
    secondaryActionLabel?: string;
    forceChannel?: "email" | "whatsapp";
    cardRegistration?: boolean;
    notificationType?: string;
  },
) {
  const notificationType = params.notificationType || "payment_created";
  const channels = params.forceChannel ? [params.forceChannel] : (["email", "whatsapp"] as const);
  for (const channel of channels) {
    const alreadySent =
      !params.forceChannel &&
      (await wasNotificationSent(supabase, {
        invoiceId: params.invoice.id,
        channel,
        notificationType,
      }));
    if (alreadySent) continue;

    const recipientId = params.recipient.recipientTenantId || params.recipient.recipientUserId;
    if (channel === "email") {
      const result = params.recipient.recipientEmail
        ? await sendPaymentEmail({
            to: params.recipient.recipientEmail,
            nome: params.recipient.recipientName || "cliente",
            tipo: "criado",
            valor: params.amount,
            metodo: params.paymentMethod,
            vencimento: params.dueDate,
            pixCopyPaste: params.pixCopyPaste,
            boletoUrl: params.paymentUrl,
            boletoBarcode: params.boletoBarcode,
            contratoRef: params.contractRef,
            cardRegistration: params.cardRegistration,
            secondaryPaymentUrl: params.secondaryPaymentUrl,
            secondaryActionLabel: params.secondaryActionLabel,
          })
        : { sent: false, reason: "missing_recipient" };
      await logFinancialNotification(supabase, {
        invoiceId: params.invoice.id,
        recipientType: params.recipient.recipientType,
        recipientId,
        channel: "email",
        notificationType,
        result,
      });
    } else {
      const content = buildPaymentRequestWhatsappContent({
        name: params.recipient.recipientName,
        method: params.paymentMethod,
        amount: params.amount,
        dueDate: params.dueDate,
        contractRef: params.contractRef,
        paymentUrl: params.paymentUrl,
        secondaryPaymentUrl: params.secondaryPaymentUrl,
        secondaryActionLabel: params.secondaryActionLabel,
        cardRegistration: params.cardRegistration,
      });
      const result = params.recipient.recipientPhone
        ? await sendPaymentWhatsapp({
            to: params.recipient.recipientPhone,
            mensagem: content.message,
            title: content.title,
            paymentUrl: params.paymentUrl,
            buttonLabel: "Pagar",
            secondaryPaymentUrl: params.secondaryPaymentUrl,
            secondaryButtonLabel: params.secondaryActionLabel,
          })
        : { sent: false, reason: "missing_recipient" };
      await logFinancialNotification(supabase, {
        invoiceId: params.invoice.id,
        recipientType: params.recipient.recipientType,
        recipientId,
        channel: "whatsapp",
        notificationType,
        result,
      });
    }
  }
  return getInvoiceNotificationSummary(supabase, params.invoice.id, notificationType);
}

export async function getContractBillingStates(supabase: any, consultationId: string) {
  const [{ data: signature }, { data: policy }] = await Promise.all([
    supabase
      .from("contract_signatures")
      .select("status, signature_status")
      .eq("consultation_id", consultationId)
      .maybeSingle(),
    supabase
      .from("apolices")
      .select("status")
      .eq("consulta_id", consultationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const signatureStatus =
    signature?.signature_status ||
    (signature?.status === "awaiting_signature"
      ? "sent"
      : ["signed", "active"].includes(signature?.status)
        ? "signed"
        : signature?.status === "error"
          ? "error"
          : "pending");
  const policyStatus =
    policy?.status === "ativa"
      ? "active"
      : policy?.status === "cancelada"
        ? "cancelled"
        : policy?.status === "emitida_pendente"
          ? "issued_pending"
          : "draft";
  return { signatureStatus, policyStatus };
}

export function queuePendingContractFlow(supabase: any, consultationId: string) {
  runInBackground(`fluxo documental pendente ${consultationId}`, async () => {
    await ensurePendingPolicy(supabase, consultationId);
    const result = await dispatchD4SignContract(supabase, consultationId, {
      allowPendingPayment: true,
    });
    if (!result.ok) {
      console.error("[contract-billing] falha ao despachar D4Sign", {
        consultationId,
        error: result.error || result.status || "unknown",
      });
    }
  });
}
