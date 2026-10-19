import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  AsaasApiError,
  asaasFetch,
  cancelAsaasPayment,
  corsHeaders,
  jsonResponse,
  logFinancialNotification,
  normalizeDocumento,
  normalizePhone,
  requireUser,
  sanitizeAsaasResponse,
  sendPaymentEmail,
  sendPaymentWhatsapp,
  supabaseAdmin,
  toMoney,
  wasNotificationSent,
} from "../_shared/asaas.ts";
import {
  asaasLateFeePayload,
  consolidatedDueDate,
  isCollectableStatus,
  resolveBillingDueDay,
  saoPauloClock,
} from "../_shared/billing-automation.ts";
import {
  claimBillingOperation,
  reclaimStaleBillingOperation,
  recoverPaymentForOperation,
  updateBillingOperation,
} from "../_shared/contract-billing.ts";
import { hasOversizedBody, safeEqualSecret } from "../_shared/http-security.ts";
import { buildPaymentRequestWhatsappContent } from "../_shared/payment-notification-content.ts";

type Body = {
  invoiceIds?: string[];
  referenceMonth?: number;
  referenceYear?: number;
  agencyUserId?: string;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonResponse(req, { ok: false, error: "Método não permitido." }, 405);
  }
  if (hasOversizedBody(req, 64_000))
    return jsonResponse(req, { ok: false, error: "Payload muito grande." }, 413);

  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const cronSecret = Deno.env.get("CRON_NOTIFICATIONS_SECRET") || "";
    const receivedCronSecret = req.headers.get("x-cron-secret") || "";
    const internal = !!cronSecret && safeEqualSecret(receivedCronSecret, cronSecret);
    let actorId: string | null = null;
    let agencyUserId = body.agencyUserId || null;
    if (!internal) {
      const { user } = await requireUser(req);
      actorId = user.id;
      agencyUserId = user.id;
    }
    if (!agencyUserId) {
      return jsonResponse(
        req,
        {
          ok: false,
          error: "Responsável não informado.",
        },
        400,
      );
    }
    // Valida UUID antes de passar para query - sem isso um agencyUserId
    // malformado via o cron viraria erro 500 em PostgREST com stacktrace.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(agencyUserId)) {
      return jsonResponse(req, { ok: false, error: "Responsável inválido." }, 400);
    }

    const admin = supabaseAdmin();
    const clock = saoPauloClock();
    const [currentYear, currentMonth] = clock.date.split("-").map(Number);
    const referenceMonth = body.referenceMonth || currentMonth;
    const referenceYear = body.referenceYear || currentYear;
    if (referenceMonth < 1 || referenceMonth > 12 || referenceYear < 2020 || referenceYear > 2200) {
      return jsonResponse(
        req,
        {
          ok: false,
          error: "Mês de referência inválido.",
        },
        400,
      );
    }

    const { data: latestBatch, error: latestBatchError } = await admin
      .from("consolidated_invoice_batches")
      .select("*")
      .eq("agency_user_id", agencyUserId)
      .eq("reference_month", referenceMonth)
      .eq("reference_year", referenceYear)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestBatchError) throw latestBatchError;
    const existingBatch = ["active", "partial"].includes(latestBatch?.status) ? latestBatch : null;

    const invoiceIds = Array.isArray(body.invoiceIds)
      ? [...new Set(body.invoiceIds.filter(Boolean))]
      : [];
    let scopedInvoiceIds = invoiceIds;
    if (invoiceIds.length && existingBatch?.id) {
      const { data: currentItems, error: currentItemsError } = await admin
        .from("consolidated_invoice_items")
        .select("fatura_id")
        .eq("batch_id", existingBatch.id)
        .eq("status", "active");
      if (currentItemsError) throw currentItemsError;
      scopedInvoiceIds = [
        ...new Set([
          ...invoiceIds,
          ...(currentItems || []).map((item: any) => item.fatura_id).filter(Boolean),
        ]),
      ];
    }

    let candidateQuery = admin
      .from("faturas_inquilino")
      .select(
        "id, consulta_id, tenant_user_id, asaas_payment_id, valor, vencimento, status, consolidated_item_id",
      )
      .eq("recipient_user_id", agencyUserId)
      .eq("payment_responsible", "agency")
      .eq("status", "awaiting_consolidation")
      .is("asaas_payment_id", null);
    if (scopedInvoiceIds.length) candidateQuery = candidateQuery.in("id", scopedInvoiceIds);
    const { data: candidates, error: candidateError } = await candidateQuery;
    if (candidateError) throw candidateError;

    const eligible = (candidates ?? []).filter((invoice: any) => {
      const [year, month] = String(invoice.vencimento).split("-").map(Number);
      return year === referenceYear && month === referenceMonth;
    });

    if (!eligible.length) {
      if (existingBatch?.asaas_payment_id && existingBatch.status === "active") {
        const cancellation = await cancelAsaasPayment(existingBatch.asaas_payment_id);
        if (!cancellation.cancelled) {
          await admin
            .from("consolidated_invoice_batches")
            .update({
              reconciliation_status: "manual_review",
              reconciliation_error: cancellation.error || "provider_cancellation_failed",
            })
            .eq("id", existingBatch.id);
          return jsonResponse(
            req,
            {
              ok: false,
              error:
                "O lote continua vinculado porque o cancelamento no Asaas nao foi confirmado. Revisao financeira necessaria.",
              manualReview: true,
            },
            502,
          );
        }
        await releaseBatch(admin, existingBatch.id);
      } else if (existingBatch?.id) {
        await releaseBatch(admin, existingBatch.id);
      }
      return jsonResponse(
        req,
        {
          ok: false,
          error: "Nenhuma fatura elegível para este mês.",
        },
        400,
      );
    }
    if (existingBatch?.status === "partial") {
      return jsonResponse(
        req,
        {
          ok: false,
          error: "O lote possui pagamento parcial e requer revisão financeira.",
        },
        409,
      );
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("id, nome, email, telefone, cnpj, role")
      .eq("id", agencyUserId)
      .maybeSingle();
    if (!profile?.email || !profile?.telefone) {
      return jsonResponse(
        req,
        {
          ok: false,
          error: "Complete e-mail e telefone do responsável antes de gerar a cobrança.",
        },
        400,
      );
    }
    const cpfCnpj = await resolveProfileDocument(admin, profile);
    if (!cpfCnpj) {
      return jsonResponse(
        req,
        {
          ok: false,
          error: "Cadastre o CPF ou CNPJ do responsável antes de gerar a cobrança.",
        },
        400,
      );
    }

    const totalValue = toMoney(
      eligible.reduce((sum: number, invoice: any) => sum + Number(invoice.valor || 0), 0),
    );
    const dueDay = await resolveBillingDueDay(admin);
    const dueDate = consolidatedDueDate(referenceYear, referenceMonth, dueDay, clock.date);
    let customerId = existingBatch?.asaas_customer_id || null;
    if (!customerId) {
      const found = await asaasFetch(`/customers?cpfCnpj=${encodeURIComponent(cpfCnpj)}`);
      customerId = Array.isArray(found?.data) && found.data.length ? found.data[0].id : null;
    }
    if (!customerId) {
      const created = await asaasFetch("/customers", {
        method: "POST",
        body: JSON.stringify({
          name: profile.nome,
          cpfCnpj,
          email: profile.email,
          mobilePhone: normalizePhone(profile.telefone),
          phone: normalizePhone(profile.telefone),
        }),
      });
      customerId = created?.id || null;
    }
    if (!customerId) throw new Error("asaas_customer_missing");

    const previousGeneration = Math.max(1, Number(latestBatch?.automation_version || 1));
    const generation = existingBatch
      ? previousGeneration
      : latestBatch
        ? previousGeneration + 1
        : 1;
    const baseExternalReference = `nox:lote:${agencyUserId}:${referenceYear}:${String(referenceMonth).padStart(2, "0")}`;
    const externalReference =
      existingBatch?.external_reference ||
      (generation === 1 ? baseExternalReference : `${baseExternalReference}:attempt:${generation}`);
    const paymentPayload = {
      customer: customerId,
      billingType: "BOLETO",
      value: totalValue,
      dueDate,
      description: `NOX Fiança — cobrança mensal consolidada ${String(referenceMonth).padStart(
        2,
        "0",
      )}/${referenceYear} (${eligible.length} contratos)`,
      externalReference,
      ...asaasLateFeePayload(),
    };

    const { operation, claimed } = await claimBillingOperation(admin, {
      consultationId: eligible[0].consulta_id,
      operationType: "payment",
      idempotencyKey: externalReference,
      request: { agencyUserId, referenceYear, referenceMonth, generation },
      userId: actorId,
    });

    let raw: any = null;
    if (!existingBatch?.asaas_payment_id) {
      raw = await recoverPaymentForOperation(operation, externalReference);
      if (!raw && !claimed) {
        const reclaimed = await reclaimStaleBillingOperation(admin, operation);
        if (!reclaimed) {
          return jsonResponse(
            req,
            {
              ok: false,
              error: "A cobranca consolidada esta em conciliacao. Nenhum boleto novo foi criado.",
              operationState: operation.state,
              retryable: true,
            },
            409,
          );
        }
      }
    }
    if (
      !existingBatch &&
      ["CANCELLED", "CANCELED", "DELETED", "REFUNDED"].includes(
        String(raw?.status || "").toUpperCase(),
      )
    ) {
      await updateBillingOperation(admin, operation.id, {
        state: "failed",
        provider_id: raw?.id || operation.provider_id || null,
        provider_response: sanitizeAsaasResponse(raw),
        last_error: "recovered_consolidated_payment_is_terminal",
      });
      return jsonResponse(
        req,
        {
          ok: false,
          error: "A tentativa anterior do lote foi cancelada. Solicite uma nova geracao.",
          retryable: true,
        },
        409,
      );
    }
    try {
      raw = existingBatch?.asaas_payment_id
        ? await asaasFetch(`/payments/${existingBatch.asaas_payment_id}`, {
            method: "PUT",
            body: JSON.stringify(paymentPayload),
          })
        : raw ||
          (await asaasFetch("/payments", {
            method: "POST",
            body: JSON.stringify(paymentPayload),
          }));
      if (!existingBatch?.asaas_payment_id) {
        await updateBillingOperation(admin, operation.id, {
          state: "provider_created",
          provider_id: raw?.id || null,
          provider_response: sanitizeAsaasResponse(raw),
          last_error: null,
        });
      }
    } catch (error) {
      await updateBillingOperation(admin, operation.id, {
        state: error instanceof AsaasApiError && error.status < 500 ? "failed" : "ambiguous",
        last_error: error instanceof Error ? error.message : String(error),
      });
      console.error("[asaas-create-consolidated-invoice] provider_error", {
        status: error instanceof AsaasApiError ? error.status : "unknown",
      });
      return jsonResponse(
        req,
        {
          ok: false,
          error: "Não foi possível gerar a cobrança consolidada agora.",
        },
        502,
      );
    }

    let batch = existingBatch;
    if (batch) {
      const { data, error } = await admin
        .from("consolidated_invoice_batches")
        .update({
          total_value: totalValue,
          due_date: dueDate,
          invoice_count: eligible.length,
          billing_method: "boleto",
          asaas_customer_id: customerId,
          asaas_payment_id: raw?.id || batch.asaas_payment_id,
          invoice_url: raw?.invoiceUrl || null,
          bank_slip_url: raw?.bankSlipUrl || raw?.invoiceUrl || null,
          identification_field: raw?.identificationField || raw?.nossoNumero || null,
          last_synced_at: new Date().toISOString(),
          reconciliation_status: "ready",
          reconciliation_error: null,
          automation_version: generation,
        })
        .eq("id", batch.id)
        .select()
        .maybeSingle();
      if (error) throw error;
      batch = data;
    } else {
      const { data, error } = await admin
        .from("consolidated_invoice_batches")
        .insert({
          agency_user_id: agencyUserId,
          created_by: actorId,
          reference_month: referenceMonth,
          reference_year: referenceYear,
          total_value: totalValue,
          due_date: dueDate,
          status: "active",
          invoice_count: eligible.length,
          billing_method: "boleto",
          asaas_customer_id: customerId,
          asaas_payment_id: raw?.id || null,
          external_reference: externalReference,
          invoice_url: raw?.invoiceUrl || null,
          bank_slip_url: raw?.bankSlipUrl || raw?.invoiceUrl || null,
          identification_field: raw?.identificationField || raw?.nossoNumero || null,
          last_synced_at: new Date().toISOString(),
          reconciliation_status: "ready",
          reconciliation_error: null,
          automation_version: generation,
        })
        .select()
        .maybeSingle();
      if (error) throw error;
      batch = data;
    }

    const { data: currentItems } = await admin
      .from("consolidated_invoice_items")
      .select("id, fatura_id, status")
      .eq("batch_id", batch.id)
      .eq("status", "active");
    const eligibleIds = new Set(eligible.map((invoice: any) => invoice.id));
    const itemByInvoice = new Map((currentItems ?? []).map((item: any) => [item.fatura_id, item]));

    for (const item of currentItems ?? []) {
      if (eligibleIds.has(item.fatura_id)) continue;
      await admin
        .from("faturas_inquilino")
        .update({
          consolidated_item_id: null,
        })
        .eq("id", item.fatura_id);
      await admin
        .from("consolidated_invoice_items")
        .update({
          status: "cancelled_after_consolidation",
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.id);
    }

    for (const invoice of eligible) {
      let item = itemByInvoice.get(invoice.id);
      if (!item) {
        const { data, error } = await admin
          .from("consolidated_invoice_items")
          .insert({
            batch_id: batch.id,
            fatura_id: invoice.id,
            tenant_user_id: invoice.tenant_user_id,
            consulta_id: invoice.consulta_id,
            original_value: invoice.valor,
            status: "active",
          })
          .select("id, fatura_id")
          .maybeSingle();
        if (error) throw error;
        item = data;
      }
      await admin
        .from("faturas_inquilino")
        .update({
          consolidated_item_id: item.id,
          boleto_url: null,
          linha_digitavel: null,
        })
        .eq("id", invoice.id);
    }

    // Uma cobrança individual aberta nunca pode coexistir com o lote. Se o
    // cancelamento de qualquer item falhar, o lote novo é cancelado e os
    // vínculos são liberados para evitar cobrança duplicada.
    for (const invoice of eligible) {
      if (!invoice.asaas_payment_id) continue;
      const { data: payment } = await admin
        .from("asaas_payments")
        .select("id, asaas_payment_id, status")
        .eq("id", invoice.asaas_payment_id)
        .maybeSingle();
      if (!payment?.asaas_payment_id || !isCollectableStatus(payment.status)) continue;
      const cancelled = await cancelAsaasPayment(payment.asaas_payment_id);
      if (!cancelled.cancelled) {
        const batchCancellation = await cancelAsaasPayment(batch.asaas_payment_id);
        if (batchCancellation.cancelled) {
          await releaseBatch(admin, batch.id);
          await updateBillingOperation(admin, operation.id, {
            state: "cancelled",
            provider_id: batch.asaas_payment_id,
            last_error: "individual_payment_cancellation_failed",
            completed_at: new Date().toISOString(),
          });
        } else {
          await admin
            .from("consolidated_invoice_batches")
            .update({
              reconciliation_status: "manual_review",
              reconciliation_error: `individual:${payment.asaas_payment_id};batch:${batch.asaas_payment_id}`,
            })
            .eq("id", batch.id);
          await updateBillingOperation(admin, operation.id, {
            state: "ambiguous",
            provider_id: batch.asaas_payment_id,
            last_error: "provider_exclusivity_not_confirmed",
          });
        }
        return jsonResponse(
          req,
          {
            ok: false,
            error: batchCancellation.cancelled
              ? "A consolidacao foi interrompida e o lote cancelado para evitar cobranca duplicada."
              : "Nao foi possivel confirmar exclusividade das cobrancas. Os vinculos foram preservados para revisao financeira.",
            manualReview: !batchCancellation.cancelled,
          },
          502,
        );
      }
      await admin.from("asaas_payments").update({ status: "cancelled" }).eq("id", payment.id);
    }

    await updateBillingOperation(admin, operation.id, {
      state: "persisted",
      provider_id: batch.asaas_payment_id,
      provider_response: sanitizeAsaasResponse(raw),
      completed_at: new Date().toISOString(),
      last_error: null,
    });

    try {
      await notifyBatchCreated(admin, batch, profile, raw);
    } catch (notificationError) {
      console.error("[asaas-create-consolidated-invoice] notification_error", {
        batchId: batch.id,
        message:
          notificationError instanceof Error
            ? notificationError.message
            : String(notificationError),
      });
    }

    return jsonResponse(req, {
      success: true,
      batchId: batch.id,
      totalValue,
      dueDate,
      invoiceCount: eligible.length,
      status: batch.status,
      invoiceUrl: raw?.invoiceUrl || null,
      bankSlipUrl: raw?.bankSlipUrl || raw?.invoiceUrl || null,
      identificationField: raw?.identificationField || raw?.nossoNumero || null,
    });
  } catch (error) {
    console.error("[asaas-create-consolidated-invoice] unexpected_error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(
      req,
      {
        ok: false,
        error: "Não foi possível sincronizar a cobrança consolidada.",
      },
      500,
    );
  }
});

async function resolveProfileDocument(admin: any, profile: any) {
  if (normalizeDocumento(profile.cnpj)) return normalizeDocumento(profile.cnpj);
  const role = String(profile.role || "");
  if (role === "corretor") {
    const { data } = await admin
      .from("corretores")
      .select("cpf")
      .eq("profile_id", profile.id)
      .maybeSingle();
    return normalizeDocumento(data?.cpf);
  }
  if (role === "proprietario") {
    const { data } = await admin
      .from("proprietarios")
      .select("cpf_cnpj")
      .eq("profile_id", profile.id)
      .maybeSingle();
    return normalizeDocumento(data?.cpf_cnpj);
  }
  if (role === "inquilino") {
    const { data } = await admin
      .from("inquilinos")
      .select("cpf, cnpj")
      .eq("profile_id", profile.id)
      .maybeSingle();
    return normalizeDocumento(data?.cpf || data?.cnpj);
  }
  return "";
}

async function notifyBatchCreated(admin: any, batch: any, profile: any, raw: any) {
  const notificationType = "consolidated_payment_created";
  const paymentUrl =
    raw?.bankSlipUrl || raw?.invoiceUrl || batch.bank_slip_url || batch.invoice_url || null;
  for (const channel of ["email", "whatsapp"] as const) {
    if (
      await wasNotificationSent(admin, {
        batchId: batch.id,
        channel,
        notificationType,
      })
    )
      continue;
    let result: any;
    try {
      const contractRef = `lote ${String(batch.reference_month).padStart(2, "0")}/${batch.reference_year}`;
      const whatsappContent = buildPaymentRequestWhatsappContent({
        name: profile.nome,
        method: "boleto",
        amount: Number(batch.total_value || 0),
        dueDate: batch.due_date,
        contractRef,
        paymentUrl,
      });
      result =
        channel === "email"
          ? await sendPaymentEmail({
              to: profile.email,
              nome: profile.nome || "cliente",
              tipo: "criado",
              valor: Number(batch.total_value || 0),
              metodo: "boleto",
              vencimento: batch.due_date,
              boletoUrl: paymentUrl,
              contratoRef: contractRef,
            })
          : await sendPaymentWhatsapp({
              to: profile.telefone,
              mensagem: whatsappContent.message,
              title: whatsappContent.title,
              paymentUrl,
              buttonLabel: "Pagar",
            });
    } catch (error) {
      result = { sent: false, reason: error instanceof Error ? error.message : String(error) };
    }
    await logFinancialNotification(admin, {
      batchId: batch.id,
      recipientType: "user",
      recipientId: batch.agency_user_id,
      channel,
      notificationType,
      result,
    });
  }
}

async function releaseBatch(admin: any, batchId: string) {
  const { data: items } = await admin
    .from("consolidated_invoice_items")
    .select("id, fatura_id")
    .eq("batch_id", batchId)
    .eq("status", "active");
  for (const item of items ?? []) {
    await admin
      .from("faturas_inquilino")
      .update({ consolidated_item_id: null })
      .eq("id", item.fatura_id);
    await admin
      .from("consolidated_invoice_items")
      .update({
        status: "cancelled_after_consolidation",
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);
  }
  await admin
    .from("consolidated_invoice_batches")
    .update({
      status: "cancelled",
      invoice_url: null,
      bank_slip_url: null,
      identification_field: null,
      pix_qr_code: null,
      pix_copy_paste: null,
      pix_expires_at: null,
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", batchId);
}
