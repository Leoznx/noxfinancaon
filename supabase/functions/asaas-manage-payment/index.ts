import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  addBusinessDays,
  asaasFetch,
  corsHeaders,
  describePaymentError,
  jsonResponse,
  logFinancialNotification,
  mapAsaasStatus,
  normalizedPaymentResponse,
  paymentErrorStatus,
  requireUser,
  resolvePaymentRecipientFromContract,
  sanitizeAsaasResponse,
  sendPaymentEmail,
  sendPaymentWhatsapp,
  wasNotificationSent,
} from "../_shared/asaas.ts";
import { assertCanManageInvoiceOrBatch } from "../_shared/billing-auth.ts";
import {
  billingDueDateError,
  canManageIndividualInvoiceAction,
  normalizePaymentStatus,
  persistProviderTransition,
  reducePaymentStatus,
  shouldApplyConsolidatedEvent,
} from "../_shared/billing-state.ts";
import { asaasLateFeePayload, isCollectableStatus } from "../_shared/billing-automation.ts";
import {
  getInvoiceNotificationSummary,
  publicRecipient,
  sendInvoiceNotifications,
} from "../_shared/contract-billing.ts";
import { dispatchD4SignContract, finalizeD4SignContract } from "../_shared/d4sign.ts";

type Body = {
  invoiceId?: string;
  paymentId?: string;
  consultationId?: string;
  batchId?: string;
  requestId?: string;
  action?: "refresh" | "resend_email" | "resend_whatsapp" | "reissue";
  paymentMethod?: "pix" | "boleto";
};

function reduceReissueStatus(
  currentStatus: unknown,
  incomingStatus: ReturnType<typeof normalizePaymentStatus>,
  currentEventAt?: string | null,
  incomingEventAt?: string | null,
) {
  const normalizedCurrent = normalizePaymentStatus(currentStatus);
  const currentTime = currentEventAt ? Date.parse(currentEventAt) : Number.NaN;
  const incomingTime = incomingEventAt ? Date.parse(incomingEventAt) : Number.NaN;
  if (Number.isFinite(currentTime) && Number.isFinite(incomingTime) && incomingTime < currentTime) {
    return normalizedCurrent;
  }
  return isCollectableStatus(normalizedCurrent) ? incomingStatus : normalizedCurrent;
}

async function manageBatch(supabase: any, userId: string, body: Body) {
  const { data: batch, error: batchError } = await supabase
    .from("consolidated_invoice_batches")
    .select("*")
    .eq("id", body.batchId)
    .maybeSingle();
  if (batchError) throw batchError;
  if (!batch) return { response: { ok: false, error: "Lote nao encontrado." }, status: 404 };
  await assertCanManageInvoiceOrBatch(supabase, userId, { batch });
  if (body.action === "reissue") {
    return {
      response: {
        ok: false,
        error: "A segunda via consolidada deve ser gerada pelo fluxo do lote mensal.",
      },
      status: 409,
    };
  }
  const { data: recipient, error: recipientError } = await supabase
    .from("profiles")
    .select("id, nome, email, telefone")
    .eq("id", batch.agency_user_id)
    .maybeSingle();
  if (recipientError) throw recipientError;
  let provider: any = null;
  let currentBatch = batch;
  if (body.action === "refresh") {
    if (!batch.asaas_payment_id) {
      return {
        response: { ok: false, error: "O lote ainda nao possui cobranca no Asaas." },
        status: 409,
      };
    }
    provider = await asaasFetch(`/payments/${batch.asaas_payment_id}`);
    const incoming = normalizePaymentStatus(mapAsaasStatus(provider?.status));
    const eventAt = new Date().toISOString();
    const batchTransition = await persistProviderTransition({
      supabase,
      table: "consolidated_invoice_batches",
      rowId: batch.id,
      current: batch,
      incomingEventAt: eventAt,
      eventAtColumn: null,
      readEventAt: (row) => row.provider_event_at,
      guardColumns: ["provider_event_at", "reconciliation_status"],
      reduce: (currentStatus) => String(currentStatus || "active"),
      buildPatch: ({ current, staleEvent }) => {
        const mayApply = shouldApplyConsolidatedEvent({
          currentStatus: current.status,
          currentEventAt: current.provider_event_at,
          incomingEventAt: eventAt,
        });
        const patch: Record<string, unknown> = {
          last_synced_at: new Date().toISOString(),
        };
        if (!staleEvent) {
          patch.invoice_url = provider?.invoiceUrl || current.invoice_url;
          patch.bank_slip_url =
            provider?.bankSlipUrl || provider?.invoiceUrl || current.bank_slip_url;
          patch.identification_field =
            provider?.identificationField || current.identification_field;
        }
        if (mayApply && ["paid", "confirmed"].includes(incoming) && current.status !== "paid") {
          patch.reconciliation_status = "provider_paid_pending_webhook";
          patch.reconciliation_error = null;
        }
        return patch;
      },
    });
    currentBatch = batchTransition.row;
  } else {
    const channel = body.action === "resend_email" ? "email" : "whatsapp";
    const explicitRequestId = String(body.requestId || "")
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 80);
    const requestKey = explicitRequestId || new Date().toISOString().slice(0, 10);
    const notificationType = `consolidated_manual_resend:${requestKey}`;
    const alreadySent = await wasNotificationSent(supabase, {
      batchId: batch.id,
      channel,
      notificationType,
    });
    if (!alreadySent) {
      const paymentUrl = batch.bank_slip_url || batch.invoice_url || null;
      let result: any;
      try {
        result =
          channel === "email"
            ? recipient?.email
              ? await sendPaymentEmail({
                  to: recipient.email,
                  nome: recipient.nome || "cliente",
                  tipo: "criado",
                  valor: Number(batch.total_value || 0),
                  metodo: batch.billing_method || "boleto",
                  vencimento: batch.due_date,
                  boletoUrl: paymentUrl,
                  contratoRef: `lote ${String(batch.reference_month).padStart(2, "0")}/${batch.reference_year}`,
                })
              : { sent: false, reason: "missing_recipient" }
            : recipient?.telefone
              ? await sendPaymentWhatsapp({
                  to: recipient.telefone,
                  mensagem: `Olá, ${recipient.nome || "cliente"}. A cobrança consolidada NOX Fiança de ${Number(batch.total_value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} está disponível.${paymentUrl ? ` Link seguro: ${paymentUrl}` : " Consulte o painel financeiro."}`,
                })
              : { sent: false, reason: "missing_recipient" };
      } catch (error) {
        result = { sent: false, reason: error instanceof Error ? error.message : String(error) };
      }
      await logFinancialNotification(supabase, {
        batchId: batch.id,
        recipientType: "user",
        recipientId: batch.agency_user_id,
        channel,
        notificationType,
        result,
      });
    }
  }
  const { data: history } = await supabase
    .from("financial_notifications")
    .select("id, channel, notification_type, status, attempts, last_error, sent_at, created_at")
    .eq("batch_id", batch.id)
    .order("created_at", { ascending: false });
  return {
    response: {
      success: true,
      reused: true,
      payment: provider
        ? normalizedPaymentResponse(provider, {
            payment_method: currentBatch.billing_method,
            value: currentBatch.total_value,
            due_date: currentBatch.due_date,
          })
        : {
            success: true,
            paymentId: currentBatch.asaas_payment_id,
            paymentStatus: currentBatch.status,
            paymentMethod: currentBatch.billing_method,
            amount: Number(currentBatch.total_value),
            dueDate: currentBatch.due_date,
            invoiceUrl: currentBatch.bank_slip_url || currentBatch.invoice_url,
          },
      invoice: null,
      batch: {
        id: currentBatch.id,
        status: currentBatch.status,
        amount: Number(currentBatch.total_value),
        dueDate: currentBatch.due_date,
        invoiceCount: currentBatch.invoice_count,
        paymentUrl: currentBatch.bank_slip_url || currentBatch.invoice_url,
        reconciliationStatus: currentBatch.reconciliation_status,
      },
      recipient: {
        responsible: "agency",
        type: "user",
        userId: batch.agency_user_id,
        name: recipient?.nome || null,
      },
      notifications: { history: history || [] },
    },
    status: 200,
  };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function resolveTarget(supabase: any, body: Body) {
  let payment: any = null;
  let invoice: any = null;
  if (body.invoiceId) {
    invoice = (
      await supabase.from("faturas_inquilino").select("*").eq("id", body.invoiceId).maybeSingle()
    ).data;
  } else if (body.paymentId) {
    let query = supabase.from("asaas_payments").select("*");
    query = isUuid(body.paymentId)
      ? query.or(`id.eq.${body.paymentId},asaas_payment_id.eq.${body.paymentId}`)
      : query.eq("asaas_payment_id", body.paymentId);
    payment = (await query.maybeSingle()).data;
    if (payment) {
      invoice = (
        await supabase
          .from("faturas_inquilino")
          .select("*")
          .eq("asaas_payment_id", payment.id)
          .maybeSingle()
      ).data;
    }
  } else if (body.consultationId) {
    invoice = (
      await supabase
        .from("faturas_inquilino")
        .select("*")
        .eq("consulta_id", body.consultationId)
        .eq("charge_kind", "initial")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    ).data;
  }
  if (!invoice) return { invoice: null, payment };
  if (!payment && invoice.asaas_payment_id) {
    payment = (
      await supabase
        .from("asaas_payments")
        .select("*")
        .eq("id", invoice.asaas_payment_id)
        .maybeSingle()
    ).data;
  }
  return { invoice, payment };
}

async function reconcileContractAfterPayment(
  supabase: any,
  invoice: any,
  payment: any,
  providerEventAt: string,
) {
  if (
    invoice.charge_kind !== "initial" ||
    !["confirmed", "paid"].includes(normalizePaymentStatus(payment.status))
  )
    return;
  const incomingStatus = normalizePaymentStatus(payment.status);
  const { data: consultation, error: consultationError } = await supabase
    .from("consultas_credito")
    .select("*")
    .eq("id", invoice.consulta_id)
    .maybeSingle();
  if (consultationError || !consultation) {
    throw consultationError || new Error("consultation_not_found");
  }
  const consultationTransition = await persistProviderTransition({
    supabase,
    table: "consultas_credito",
    rowId: invoice.consulta_id,
    current: consultation,
    incomingEventAt: providerEventAt,
    statusColumn: "payment_state",
    eventAtColumn: "payment_provider_event_at",
    reduce: (currentStatus, currentEventAt, incomingEventAt) =>
      reducePaymentStatus(currentStatus as string, incomingStatus, currentEventAt, incomingEventAt),
    buildPatch: ({ current, nextStatus, staleEvent }) => {
      const incomingAccepted = !staleEvent && normalizePaymentStatus(nextStatus) === incomingStatus;
      return {
        asaas_payment_id: payment.asaas_payment_id,
        payment_status: nextStatus,
        payment_data: incomingAccepted ? payment.raw_response : current.payment_data,
        payment_confirmed_at: incomingAccepted
          ? current.payment_confirmed_at || payment.confirmed_at || new Date().toISOString()
          : current.payment_confirmed_at,
        payment_received_at: incomingAccepted
          ? current.payment_received_at || payment.received_at || null
          : current.payment_received_at,
      };
    },
  });
  if (!["confirmed", "paid"].includes(normalizePaymentStatus(consultationTransition.nextStatus)))
    return;
  const { data: signature } = await supabase
    .from("contract_signatures")
    .select("*")
    .eq("consultation_id", invoice.consulta_id)
    .maybeSingle();
  if (
    signature?.signature_status === "signed" ||
    ["signed", "active"].includes(signature?.status)
  ) {
    await finalizeD4SignContract(supabase, signature);
  } else {
    await dispatchD4SignContract(supabase, invoice.consulta_id, { allowPendingPayment: true });
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") {
    return jsonResponse(req, { ok: false, error: "Metodo nao permitido." }, 405);
  }
  try {
    const { supabase, user } = await requireUser(req);
    const body = (await req.json()) as Body;
    if (
      !body.action ||
      !["refresh", "resend_email", "resend_whatsapp", "reissue"].includes(body.action)
    ) {
      return jsonResponse(req, { ok: false, error: "Acao invalida." }, 400);
    }
    if (
      ![body.invoiceId, body.paymentId, body.consultationId, body.batchId].filter(Boolean).length
    ) {
      return jsonResponse(req, { ok: false, error: "Informe a cobranca." }, 400);
    }
    if (body.batchId) {
      const managed = await manageBatch(supabase, user.id, body);
      return jsonResponse(req, managed.response, managed.status);
    }
    const target = await resolveTarget(supabase, body);
    if (!target.invoice) {
      return jsonResponse(req, { ok: false, error: "Cobranca nao encontrada." }, 404);
    }
    await assertCanManageInvoiceOrBatch(supabase, user.id, { invoice: target.invoice });
    const { data: consultation } = await supabase
      .from("consultas_credito")
      .select(
        "*, inquilinos(*), imoveis(*), responsavel_profile:profiles!consultas_credito_profile_id_solicitante_fkey(id, nome, email, telefone, cnpj, role)",
      )
      .eq("id", target.invoice.consulta_id)
      .maybeSingle();
    if (!consultation) throw new Error("Proposta da cobranca nao encontrada.");
    const recipient = await resolvePaymentRecipientFromContract(supabase, consultation);
    let payment = target.payment;
    let invoice = target.invoice;

    if (!canManageIndividualInvoiceAction(invoice, body.action)) {
      return jsonResponse(
        req,
        {
          ok: false,
          error:
            "Esta fatura pertence a cobranca consolidada da imobiliaria. Gerencie reenvio ou segunda via pelo lote consolidado.",
        },
        409,
      );
    }

    if (body.action === "refresh") {
      if (!payment?.asaas_payment_id) {
        // Fatura da imobiliaria permanece aguardando o lote consolidado; a
        // consulta e estritamente local e jamais cria cobranca individual.
      } else {
        const raw = await asaasFetch(`/payments/${payment.asaas_payment_id}`);
        const incoming = normalizePaymentStatus(mapAsaasStatus(raw?.status));
        // O snapshot retornado pelo GET foi observado agora; dateCreated nao
        // representa a versao do status e nao deve ordenar esta conciliacao.
        const providerEventAt = new Date().toISOString();
        const sanitizedRaw = sanitizeAsaasResponse(raw);
        const paymentTransition = await persistProviderTransition({
          supabase,
          table: "asaas_payments",
          rowId: payment.id,
          current: payment,
          incomingEventAt: providerEventAt,
          reduce: (currentStatus, currentEventAt, incomingEventAt) =>
            reducePaymentStatus(currentStatus as string, incoming, currentEventAt, incomingEventAt),
          buildPatch: ({ current, nextStatus, staleEvent }) => {
            const incomingAccepted = !staleEvent && normalizePaymentStatus(nextStatus) === incoming;
            const patch: Record<string, unknown> = {
              raw_response: incomingAccepted ? sanitizedRaw : current.raw_response,
            };
            if (incomingAccepted && nextStatus === "confirmed" && !current.confirmed_at) {
              patch.confirmed_at = new Date().toISOString();
            }
            if (incomingAccepted && nextStatus === "paid" && !current.received_at) {
              patch.received_at =
                raw?.paymentDate || raw?.clientPaymentDate || new Date().toISOString();
            }
            return patch;
          },
        });
        payment = paymentTransition.row;
        const effectivePaymentStatus = normalizePaymentStatus(payment.status);
        const invoiceTransition = await persistProviderTransition({
          supabase,
          table: "faturas_inquilino",
          rowId: invoice.id,
          current: invoice,
          incomingEventAt: providerEventAt,
          reduce: (currentStatus, currentEventAt, incomingEventAt) =>
            reducePaymentStatus(
              currentStatus as string,
              effectivePaymentStatus,
              currentEventAt,
              incomingEventAt,
            ),
          buildPatch: ({ current, nextStatus, staleEvent }) => {
            const incomingAccepted =
              !staleEvent && normalizePaymentStatus(nextStatus) === effectivePaymentStatus;
            const patch: Record<string, unknown> = {};
            if (incomingAccepted && ["confirmed", "paid"].includes(nextStatus)) {
              patch.confirmed_at = current.confirmed_at || new Date().toISOString();
              patch.pago_em =
                nextStatus === "paid"
                  ? current.pago_em || payment.received_at || new Date().toISOString()
                  : current.pago_em;
            }
            return patch;
          },
        });
        invoice = invoiceTransition.row;
        const invoiceReissueApplied =
          reissueApplied &&
          !invoiceTransition.staleEvent &&
          isCollectableStatus(invoiceTransition.current.status) &&
          normalizePaymentStatus(invoiceTransition.nextStatus) === status;
        await reconcileContractAfterPayment(supabase, invoice, payment, providerEventAt);
      }
    } else if (body.action === "resend_email" || body.action === "resend_whatsapp") {
      await sendInvoiceNotifications(supabase, {
        invoice,
        recipient,
        paymentMethod: (invoice.payment_method || payment?.payment_method || "boleto") as any,
        amount: Number(invoice.valor),
        dueDate: invoice.vencimento,
        paymentUrl: invoice.payment_url || payment?.boleto_url || payment?.raw_response?.invoiceUrl,
        pixCopyPaste: payment?.pix_copy_paste,
        boletoBarcode: payment?.boleto_barcode || invoice.linha_digitavel,
        contractRef: String(invoice.consulta_id).slice(0, 8).toUpperCase(),
        forceChannel: body.action === "resend_email" ? "email" : "whatsapp",
      });
    } else {
      const method = body.paymentMethod || (invoice.payment_method === "pix" ? "pix" : "boleto");
      if (!payment?.asaas_payment_id) {
        return jsonResponse(
          req,
          {
            ok: false,
            error:
              invoice.status === "awaiting_consolidation"
                ? "Esta fatura pertence a cobranca consolidada da imobiliaria. Reemita o lote, nao uma cobranca individual."
                : "Cobranca Asaas nao encontrada para segunda via.",
          },
          409,
        );
      }
      if (!isCollectableStatus(payment.status)) {
        return jsonResponse(
          req,
          { ok: false, error: "Esta cobranca nao permite segunda via." },
          409,
        );
      }
      const newDueDate = addBusinessDays(3);
      const dueDateError = billingDueDateError(newDueDate, new Date().toISOString().slice(0, 10));
      if (dueDateError) throw new Error(`invalid_reissue_due_date:${dueDateError}`);
      const { data: audit } = await supabase
        .from("payment_reissue_requests")
        .insert({
          requested_by: user.id,
          invoice_id: invoice.id,
          asaas_payment_id: payment.asaas_payment_id,
          requested_method: method,
          amount: Number(invoice.valor),
          due_date: newDueDate,
        })
        .select("id")
        .maybeSingle();
      try {
        const raw = await asaasFetch(`/payments/${payment.asaas_payment_id}`, {
          method: "PUT",
          body: JSON.stringify({
            billingType: method === "pix" ? "PIX" : "BOLETO",
            value: Number(invoice.valor),
            dueDate: newDueDate,
            ...asaasLateFeePayload(),
          }),
        });
        let pix: any = null;
        if (method === "pix")
          pix = await asaasFetch(`/payments/${payment.asaas_payment_id}/pixQrCode`);
        const incomingStatus = normalizePaymentStatus(mapAsaasStatus(raw?.status));
        const providerEventAt = new Date().toISOString();
        const safeRaw = sanitizeAsaasResponse(raw);
        const paymentTransition = await persistProviderTransition({
          supabase,
          table: "asaas_payments",
          rowId: payment.id,
          current: payment,
          incomingEventAt: providerEventAt,
          reduce: (currentStatus, currentEventAt, incomingEventAt) =>
            reduceReissueStatus(currentStatus, incomingStatus, currentEventAt, incomingEventAt),
          buildPatch: ({ current, nextStatus, staleEvent }) => {
            const reissueApplied =
              !staleEvent &&
              isCollectableStatus(current.status) &&
              normalizePaymentStatus(nextStatus) === incomingStatus;
            return reissueApplied
              ? {
                  payment_method: method,
                  due_date: newDueDate,
                  raw_response: safeRaw,
                  boleto_url:
                    method === "boleto" ? raw?.bankSlipUrl || raw?.invoiceUrl || null : null,
                  boleto_barcode: method === "boleto" ? raw?.identificationField || null : null,
                  pix_qr_code: method === "pix" ? pix?.encodedImage || null : null,
                  pix_copy_paste: method === "pix" ? pix?.payload || null : null,
                  pix_expires_at: method === "pix" ? pix?.expirationDate || null : null,
                }
              : {
                  raw_response: current.raw_response,
                };
          },
        });
        payment = paymentTransition.row;
        const status = normalizePaymentStatus(payment.status);
        const reissueApplied =
          !paymentTransition.staleEvent &&
          isCollectableStatus(paymentTransition.current.status) &&
          status === incomingStatus;
        const invoiceTransition = await persistProviderTransition({
          supabase,
          table: "faturas_inquilino",
          rowId: invoice.id,
          current: invoice,
          incomingEventAt: providerEventAt,
          reduce: (currentStatus, currentEventAt, incomingEventAt) =>
            reissueApplied
              ? reduceReissueStatus(currentStatus, status, currentEventAt, incomingEventAt)
              : reducePaymentStatus(
                  currentStatus as string,
                  status,
                  currentEventAt,
                  incomingEventAt,
                ),
          buildPatch: ({ current, nextStatus, staleEvent }) => {
            const invoiceReissueApplied =
              reissueApplied &&
              !staleEvent &&
              isCollectableStatus(current.status) &&
              normalizePaymentStatus(nextStatus) === status;
            return invoiceReissueApplied
              ? {
                  payment_method: method,
                  vencimento: newDueDate,
                  payment_url: raw?.invoiceUrl || raw?.bankSlipUrl || null,
                  boleto_url:
                    method === "boleto" ? raw?.bankSlipUrl || raw?.invoiceUrl || null : null,
                  linha_digitavel: method === "boleto" ? raw?.identificationField || null : null,
                }
              : {};
          },
        });
        invoice = invoiceTransition.row;
        if (audit?.id)
          await supabase
            .from("payment_reissue_requests")
            .update({
              status: "completed",
              provider_status: status,
              completed_at: new Date().toISOString(),
            })
            .eq("id", audit.id);
        if (invoiceReissueApplied) {
          await sendInvoiceNotifications(supabase, {
            invoice,
            recipient,
            paymentMethod: method,
            amount: Number(invoice.valor),
            dueDate: newDueDate,
            paymentUrl: invoice.payment_url || invoice.boleto_url,
            pixCopyPaste: payment?.pix_copy_paste,
            boletoBarcode: payment?.boleto_barcode || invoice.linha_digitavel,
            contractRef: String(invoice.consulta_id).slice(0, 8).toUpperCase(),
            notificationType: "payment_reissued",
          });
        }
      } catch (error) {
        if (audit?.id)
          await supabase
            .from("payment_reissue_requests")
            .update({
              status: "failed",
              error_code: error instanceof Error ? error.message.slice(0, 100) : "provider_error",
              completed_at: new Date().toISOString(),
            })
            .eq("id", audit.id);
        throw error;
      }
    }

    const summary = await getInvoiceNotificationSummary(supabase, invoice.id);
    const { data: history } = await supabase
      .from("financial_notifications")
      .select("id, channel, notification_type, status, attempts, last_error, sent_at, created_at")
      .eq("invoice_id", invoice.id)
      .order("created_at", { ascending: false });
    return jsonResponse(req, {
      success: true,
      reused: true,
      payment: payment
        ? {
            ...normalizedPaymentResponse(payment.raw_response || {}, payment),
            localPaymentId: payment.id,
          }
        : {
            success: true,
            paymentId: null,
            status: invoice.status,
            paymentStatus: normalizePaymentStatus(invoice.status),
            paymentMethod: invoice.payment_method,
            amount: Number(invoice.valor),
            dueDate: invoice.vencimento,
            invoiceUrl: invoice.payment_url,
            pix: null,
            boleto: null,
          },
      invoice: {
        id: invoice.id,
        billingKey: invoice.billing_key,
        kind: invoice.charge_kind,
        status: invoice.status,
        paymentMethod: invoice.payment_method,
        amount: Number(invoice.valor),
        dueDate: invoice.vencimento,
        confirmedAt: invoice.confirmed_at || invoice.pago_em || null,
        paymentUrl: invoice.payment_url || invoice.boleto_url || null,
      },
      recipient: publicRecipient(recipient),
      notifications: { ...summary, history: history || [] },
    });
  } catch (error) {
    console.error("[asaas-manage-payment] erro", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(
      req,
      {
        ok: false,
        error: describePaymentError(error, "Nao foi possivel gerenciar a cobranca agora."),
      },
      paymentErrorStatus(error, 500),
    );
  }
});
