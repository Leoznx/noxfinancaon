import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  cancelAsaasPayment,
  corsHeaders,
  hashPayload,
  jsonResponse,
  logFinancialNotification,
  mapAsaasEvent,
  sanitizeAsaasResponse,
  sendPaymentEmail,
  sendPaymentSms,
  supabaseAdmin,
  toMoney,
  wasNotificationSent,
} from "../_shared/asaas.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST")
    return jsonResponse(req, { ok: false, error: "Metodo nao permitido." }, 405);

  const expectedToken = Deno.env.get("ASAAS_WEBHOOK_TOKEN") || "";
  const token = req.headers.get("asaas-access-token") || "";
  if (!expectedToken || token !== expectedToken) {
    return jsonResponse(req, { ok: false, error: "Nao autorizado." }, 401);
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(req, { ok: false, error: "JSON invalido." }, 400);
  }

  const eventType = String(payload?.event || "");
  const payment = payload?.payment || payload?.data || {};
  const asaasPaymentId = payment?.id || null;
  const externalReference = payment?.externalReference || null;
  if (!eventType || (!asaasPaymentId && !externalReference)) {
    return jsonResponse(req, { ok: true, ignored: true });
  }

  const supabase = supabaseAdmin();
  const payloadHash = await hashPayload(payload);
  const eventId = String(
    payload?.id || `${eventType}:${asaasPaymentId || externalReference}:${payloadHash}`,
  );

  const { error: insertEventError } = await supabase.from("asaas_webhook_events").insert({
    event_id: eventId,
    event_type: eventType,
    payment_id: asaasPaymentId,
    external_reference: externalReference,
    payload_hash: payloadHash,
    payload: sanitizeAsaasResponse(payload),
    status: "received",
  });

  if (insertEventError) {
    const duplicated = String(insertEventError.message || "")
      .toLowerCase()
      .includes("duplicate");
    if (duplicated) return jsonResponse(req, { ok: true, duplicated: true });
    console.error("[asaas-webhook] falha ao registrar evento", {
      eventType,
      paymentId: asaasPaymentId,
    });
    return jsonResponse(req, { ok: false, error: "Falha ao registrar evento." }, 500);
  }

  const internalStatus = mapAsaasEvent(eventType);
  const confirmedAt = eventType === "PAYMENT_CONFIRMED" ? new Date().toISOString() : null;
  const receivedAt =
    eventType === "PAYMENT_RECEIVED"
      ? payment?.paymentDate || payment?.clientPaymentDate || new Date().toISOString()
      : null;

  let query = supabase.from("asaas_payments").select("*");
  query = asaasPaymentId
    ? query.eq("asaas_payment_id", asaasPaymentId)
    : query.eq("external_reference", externalReference);
  const { data: localPayment, error: findError } = await query.maybeSingle();

  if (findError) {
    await markEvent(supabase, eventId, "error", findError.message);
    return jsonResponse(req, { ok: false, error: "Falha ao localizar pagamento." }, 500);
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
      await markEvent(supabase, eventId, "ignored", "payment_not_found");
      return jsonResponse(req, { ok: true, ignored: true, reason: "payment_not_found" });
    }

    await handleConsolidatedBatchEvent(supabase, batch, eventType, internalStatus, payment);
    await markEvent(supabase, eventId, "processed", null);
    return jsonResponse(req, { ok: true });
  }

  const updatePayment: Record<string, unknown> = {
    status: internalStatus,
    raw_response: sanitizeAsaasResponse(payment),
  };
  if (confirmedAt && !localPayment.confirmed_at) updatePayment.confirmed_at = confirmedAt;
  if (receivedAt && !localPayment.received_at) updatePayment.received_at = receivedAt;

  const { error: updatePaymentError } = await supabase
    .from("asaas_payments")
    .update(updatePayment)
    .eq("id", localPayment.id);

  if (updatePaymentError) {
    await markEvent(supabase, eventId, "error", updatePaymentError.message);
    return jsonResponse(req, { ok: false, error: "Falha ao atualizar pagamento." }, 500);
  }

  // Se esse pagamento e uma das 12 mensalidades (asaas-create-installment-
  // plan vincula faturas_inquilino.asaas_payment_id = asaas_payments.id),
  // atualiza SO aquela parcela - as outras 11 continuam intactas.
  const { data: faturaVinculada } = await supabase
    .from("faturas_inquilino")
    .select("id, status, numero_parcela, installment_total, vencimento, pago_em")
    .eq("asaas_payment_id", localPayment.id)
    .maybeSingle();
  if (faturaVinculada) {
    const updateFatura: Record<string, unknown> = { status: internalStatus };
    if (internalStatus === "paid" && !faturaVinculada.pago_em) updateFatura.pago_em = receivedAt || new Date().toISOString();
    const { error: updateFaturaError } = await supabase
      .from("faturas_inquilino")
      .update(updateFatura)
      .eq("id", faturaVinculada.id);
    if (updateFaturaError) {
      await markEvent(supabase, eventId, "error", "invoice_update_failed");
      return jsonResponse(req, { ok: false, error: "Falha ao atualizar mensalidade." }, 500);
    }

    // A trigger do banco usa a mesma chave idempotente. A chamada explícita
    // confirma que a ponte pagamento -> comissão terminou antes de considerar
    // o webhook processado. PAYMENT_CONFIRMED ainda não libera comissão; a
    // regra conservadora exige PAYMENT_RECEIVED (internalStatus = paid).
    if (internalStatus === "paid" && faturaVinculada.numero_parcela === 1) {
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
    const updateConsulta: Record<string, unknown> = {
      asaas_payment_id: asaasPaymentId || localPayment.asaas_payment_id,
      payment_status: internalStatus,
      payment_data: sanitizeAsaasResponse(payment),
    };
    if (confirmedAt) updateConsulta.payment_confirmed_at = confirmedAt;
    if (receivedAt) updateConsulta.payment_received_at = receivedAt;

    await supabase
      .from("consultas_credito")
      .update(updateConsulta)
      .eq("id", localPayment.consultation_id);

    if (
      (eventType === "PAYMENT_CONFIRMED" || eventType === "PAYMENT_RECEIVED") &&
      localPayment.user_id
    ) {
      await supabase.from("notificacoes").insert({
        user_id: localPayment.user_id,
        titulo: "Pagamento confirmado",
        mensagem: "O pagamento da proposta foi identificado com sucesso.",
        tipo: "pagamento",
        cor_destaque: "emerald",
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
      // fatura e uma das 12 mensalidades, ainda existe o caso de
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
    }
  }

  await markEvent(supabase, eventId, "processed", null, {
    invoiceId: faturaVinculada?.id || null,
    oldStatus: localPayment.status,
    newStatus: internalStatus,
  });
  return jsonResponse(req, { ok: true });
});

async function markEvent(
  supabase: any,
  eventId: string,
  status: string,
  errorMessage: string | null,
  audit?: { invoiceId: string | null; oldStatus: string | null; newStatus: string | null },
) {
  await supabase
    .from("asaas_webhook_events")
    .update({
      status,
      error_message: errorMessage,
      processed_at: new Date().toISOString(),
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
) {
  if (eventType === "PAYMENT_CONFIRMED") {
    // Confirmação bancária não é recebimento efetivo para fins de comissão.
    // O lote permanece ativo até o Asaas emitir PAYMENT_RECEIVED.
    return;
  }

  if (eventType === "PAYMENT_RECEIVED") {
    const valorPago = toMoney(payment?.value ?? payment?.netValue ?? batch.total_value);
    const bateValor = Math.abs(valorPago - Number(batch.total_value)) <= 0.02;

    if (!bateValor) {
      await supabase.from("consolidated_invoice_batches").update({ status: "partial" }).eq("id", batch.id);
      return;
    }

    await supabase
      .from("consolidated_invoice_batches")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", batch.id);

    const { data: itens } = await supabase
      .from("consolidated_invoice_items")
      .select("*, fatura:faturas_inquilino(id, asaas_payment_id)")
      .eq("batch_id", batch.id)
      .eq("status", "active");

    for (const item of itens ?? []) {
      // status distinto de "paid" (quitacao individual real no Asaas) -
      // deixa explicito pro inquilino/corretor/imobiliaria que essa parcela
      // foi paga atraves do boleto consolidado, nao de uma cobranca propria.
      const { error: updateInvoiceError } = await supabase
        .from("faturas_inquilino")
        .update({ status: "paid_via_consolidated", pago_em: new Date().toISOString() })
        .eq("id", item.fatura_id);
      if (updateInvoiceError) {
        throw new Error(`consolidated_invoice_update_failed:${item.fatura_id}`);
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
        await supabase.from("consolidated_invoice_items").update({ status: "paid_via_consolidated" }).eq("id", item.id);
        continue;
      }

      const { data: pagamentoIndividual } = await supabase
        .from("asaas_payments")
        .select("asaas_payment_id, status")
        .eq("id", faturaAsaasPaymentRowId)
        .maybeSingle();
      const individualAsaasChargeId = pagamentoIndividual?.asaas_payment_id;

      if (!individualAsaasChargeId || pagamentoIndividual?.status === "paid" || pagamentoIndividual?.status === "cancelled") {
        await supabase.from("consolidated_invoice_items").update({ status: "paid_via_consolidated" }).eq("id", item.id);
        continue;
      }

      const resultado = await cancelAsaasPayment(individualAsaasChargeId);
      if (resultado.cancelled) {
        await supabase.from("asaas_payments").update({ status: "cancelled" }).eq("id", faturaAsaasPaymentRowId);
        await supabase.from("consolidated_invoice_items").update({ status: "paid_via_consolidated" }).eq("id", item.id);
      } else {
        console.error("[asaas-webhook] nao foi possivel cancelar cobranca individual apos consolidado pago", {
          batchId: batch.id,
          itemId: item.id,
          individualAsaasChargeId,
        });
        await supabase.from("consolidated_invoice_items").update({ status: "manual_review_required" }).eq("id", item.id);
      }
    }
    return;
  }

  if (eventType === "PAYMENT_OVERDUE") {
    await supabase.from("consolidated_invoice_batches").update({ status: "active" }).eq("id", batch.id);
    return;
  }
  if (eventType === "PAYMENT_DELETED" || eventType === "PAYMENT_BANK_SLIP_CANCELLED") {
    // Lote cancelado/vencido sem pagamento - libera as faturas individuais
    // (remove o vinculo de consolidacao) pra poderem ser cobradas de novo ou
    // entrar em outro lote futuro.
    await supabase.from("consolidated_invoice_batches").update({ status: "cancelled" }).eq("id", batch.id);
    const { data: itens } = await supabase
      .from("consolidated_invoice_items")
      .select("id, fatura_id")
      .eq("batch_id", batch.id)
      .eq("status", "active");
    for (const item of itens ?? []) {
      await supabase.from("faturas_inquilino").update({ consolidated_item_id: null }).eq("id", item.fatura_id);
      await supabase.from("consolidated_invoice_items").update({ status: "cancelled_after_consolidation" }).eq("id", item.id);
    }
    return;
  }

  console.error("[asaas-webhook] evento de lote consolidado nao tratado explicitamente", {
    batchId: batch.id,
    eventType,
    internalStatus,
  });
}
