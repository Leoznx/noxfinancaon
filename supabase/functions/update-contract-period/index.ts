import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  HttpError,
  cancelAsaasPayment,
  corsHeaders,
  describePaymentError,
  jsonResponse,
  paymentErrorStatus,
  requireUser,
} from "../_shared/asaas.ts";
import { assertCanManageConsultationBilling } from "../_shared/billing-auth.ts";
import { cancelContractSubscription } from "../_shared/contract-billing.ts";
import { supersedePendingD4SignDocument } from "../_shared/d4sign.ts";
import { parseContractPeriodMonths } from "../_shared/contract-period.ts";

type Body = {
  proposalId?: string;
  consultationId?: string;
  contractPeriodMonths?: number;
};

const INACTIVE_PAYMENT_STATUSES = new Set([
  "cancelled",
  "canceled",
  "cancelado",
  "expired",
  "refused",
  "recusado",
  "failed",
  "falhou",
]);

function firstRow(value: any) {
  return Array.isArray(value) ? value[0] : value;
}

function rpcError(error: any) {
  const status = ["23514", "55P03"].includes(String(error?.code || "")) ? 409 : 400;
  return new HttpError(status, String(error?.message || "Nao foi possivel alterar o periodo."));
}

function periodChangeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (message === "contract_signature_already_signed") {
    return new HttpError(
      409,
      "O período não pode ser alterado porque o contrato já foi assinado.",
    );
  }
  if (message.startsWith("d4sign_api_error:")) {
    return new HttpError(
      409,
      "Não foi possível cancelar o documento pendente na D4Sign. Tente novamente antes de continuar.",
    );
  }
  return error;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") {
    return jsonResponse(req, { ok: false, error: "Metodo nao permitido." }, 405);
  }

  try {
    const { supabase, user } = await requireUser(req);
    const body = (await req.json()) as Body;
    const consultationId = String(body.proposalId || body.consultationId || "").trim();
    const nextMonths = parseContractPeriodMonths(body.contractPeriodMonths);
    if (!consultationId) {
      return jsonResponse(req, { ok: false, error: "Proposta nao encontrada." }, 400);
    }
    if (nextMonths == null) {
      return jsonResponse(
        req,
        { ok: false, error: "Selecione um período do contrato entre 1 e 120 meses." },
        400,
      );
    }

    const { data: consultation, error: consultationError } = await supabase
      .from("consultas_credito")
      .select("*")
      .eq("id", consultationId)
      .maybeSingle();
    if (consultationError) throw consultationError;
    if (!consultation) {
      return jsonResponse(req, { ok: false, error: "Proposta nao encontrada." }, 404);
    }
    await assertCanManageConsultationBilling(supabase, user.id, consultation);

    const { data: beginRows, error: beginError } = await supabase.rpc(
      "begin_contract_period_change",
      {
        p_consultation_id: consultationId,
        p_new_period_months: nextMonths,
      },
    );
    if (beginError) throw rpcError(beginError);
    const reservation = firstRow(beginRows);
    if (!reservation?.changed) {
      return jsonResponse(req, {
        ok: true,
        changed: false,
        contractPeriodMonths: nextMonths,
        contractPeriodRevision: Number(reservation?.current_revision || 0),
      });
    }

    const previousMonths = Number(reservation.current_period_months);
    await supersedePendingD4SignDocument(supabase, {
      consultationId,
      previousMonths,
      nextMonths,
    }).catch((error) => {
      throw periodChangeError(error);
    });

    const { data: subscription, error: subscriptionLookupError } = await supabase
      .from("asaas_subscriptions")
      .select("*")
      .eq("consultation_id", consultationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (subscriptionLookupError) throw subscriptionLookupError;
    if (subscription) {
      const cancellation = await cancelContractSubscription(supabase, {
        consultationId,
        actorId: user.id,
        reason: `periodo_contrato_${previousMonths}_para_${nextMonths}`,
      });
      if (!cancellation.cancelled) {
        throw new HttpError(
          409,
          "A recorrência pendente ainda não foi cancelada no Asaas. Tente novamente antes de continuar.",
        );
      }
    }

    const { data: payments, error: paymentsError } = await supabase
      .from("asaas_payments")
      .select("*")
      .or(`consultation_id.eq.${consultationId},proposal_id.eq.${consultationId}`)
      .eq("charge_kind", "monthly");
    if (paymentsError) throw paymentsError;

    for (const payment of payments || []) {
      const status = String(payment.status || "pending").toLowerCase();
      if (!INACTIVE_PAYMENT_STATUSES.has(status) && payment.asaas_payment_id) {
        const cancelled = await cancelAsaasPayment(payment.asaas_payment_id);
        if (!cancelled.cancelled) {
          throw new HttpError(
            409,
            "Uma mensalidade pendente ainda não foi cancelada no Asaas. Tente novamente antes de continuar.",
          );
        }
      }
      if (!INACTIVE_PAYMENT_STATUSES.has(status)) {
        const { error: paymentUpdateError } = await supabase
          .from("asaas_payments")
          .update({
            status: "cancelled",
            raw_response: {
              ...(payment.raw_response || {}),
              periodChange: {
                previousMonths,
                nextMonths,
                cancelledAt: new Date().toISOString(),
              },
            },
          })
          .eq("id", payment.id);
        if (paymentUpdateError) throw paymentUpdateError;
      }
    }

    const { data: invoices, error: invoicesError } = await supabase
      .from("faturas_inquilino")
      .select("*")
      .eq("consulta_id", consultationId)
      .eq("charge_kind", "monthly");
    if (invoicesError) throw invoicesError;
    for (const invoice of invoices || []) {
      const status = String(invoice.status || "pending").toLowerCase();
      if (INACTIVE_PAYMENT_STATUSES.has(status)) continue;
      const { error: invoiceUpdateError } = await supabase
        .from("faturas_inquilino")
        .update({
          status: "cancelled",
          payment_url: null,
          boleto_url: null,
          linha_digitavel: null,
          components: {
            ...(invoice.components || {}),
            periodChange: {
              previousMonths,
              nextMonths,
              cancelledAt: new Date().toISOString(),
            },
          },
        })
        .eq("id", invoice.id);
      if (invoiceUpdateError) throw invoiceUpdateError;
    }

    // O Checkout hospedado inclui um link inicial dentro da mesma operacao que
    // a recorrencia. O valor/fatura inicial e preservado, mas o link cancelado
    // precisa ser removido para a proxima criacao preencher o novo.
    if (subscription?.mode === "checkout" && subscription.initial_invoice_id) {
      const { error: initialInvoiceError } = await supabase
        .from("faturas_inquilino")
        .update({ payment_url: null, boleto_url: null, linha_digitavel: null })
        .eq("id", subscription.initial_invoice_id);
      if (initialInvoiceError) throw initialInvoiceError;
    }

    const { data: finishRows, error: finishError } = await supabase.rpc(
      "finish_contract_period_change",
      {
        p_consultation_id: consultationId,
        p_new_period_months: nextMonths,
      },
    );
    if (finishError) throw rpcError(finishError);
    const result = firstRow(finishRows);

    return jsonResponse(req, {
      ok: true,
      changed: true,
      contractPeriodMonths: Number(result?.contract_period_months || nextMonths),
      contractPeriodRevision: Number(result?.contract_period_revision || 0),
      preservedFields: true,
    });
  } catch (caught) {
    const error = periodChangeError(caught);
    console.error("[update-contract-period] falha ao alterar periodo", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(
      req,
      {
        ok: false,
        error: describePaymentError(
          error,
          "Não foi possível alterar o período agora. Nenhum dado da proposta foi apagado.",
        ),
      },
      paymentErrorStatus(error, 500),
    );
  }
});
