import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  AsaasApiError,
  FireMode,
  PaymentMethod,
  asaasFetch,
  calculateExpectedPayment,
  calculateMonthlyInstallmentValue,
  corsHeaders,
  describePaymentError,
  jsonResponse,
  mapAsaasStatus,
  normalizedPaymentResponse,
  paymentErrorStatus,
  refetchPixQrCode,
  requireUser,
  resolvePaymentRecipientFromContract,
  sanitizeAsaasResponse,
  supabaseAdmin,
  todayDate,
  toMoney,
} from "../_shared/asaas.ts";
import { ensureAsaasCustomer } from "../_shared/asaas-customer.ts";
import {
  CONTRACT_PERIOD_LOCK_CONFLICT_CODE,
  ContractPeriodLockError,
  lockContractPeriod,
  resolveContractPeriodMonths,
} from "../_shared/contract-period.ts";
import {
  assertCanManageConsultationBilling,
  assertContractAcceptsBilling,
} from "../_shared/billing-auth.ts";
import {
  buildBillingKey,
  billingDueDateError,
  normalizePaymentStatus,
  persistProviderTransition,
  planInitialBilling,
  reducePaymentStatus,
} from "../_shared/billing-state.ts";
import {
  claimBillingOperation,
  getContractBillingStates,
  getInvoiceNotificationSummary,
  materializeInvoice,
  publicRecipient,
  queuePendingContractFlow,
  reclaimStaleBillingOperation,
  recoverPaymentForOperation,
  sendInvoiceNotifications,
  switchOpenInvoicePaymentMethod,
  updateBillingOperation,
} from "../_shared/contract-billing.ts";
import { ensurePendingPolicy } from "../_shared/d4sign.ts";
import {
  nextContractBillingDueDate,
  normalizeContractBillingDueDay,
  resolveBillingDueDay,
} from "../_shared/billing-automation.ts";

type Action = "create" | "refresh" | "resend_email" | "resend_whatsapp";

type Body = {
  proposalId?: string;
  consultationId?: string;
  paymentMethod?: PaymentMethod;
  selectedFireInsuranceMode?: FireMode;
  deferPayment?: boolean;
  action?: Action;
  amount?: number;
  billingDueDay?: number;
  dueDate?: string;
  creditCard?: {
    holderName?: string;
    number?: string;
    expiryMonth?: string;
    expiryYear?: string;
    ccv?: string;
  };
  creditCardHolderInfo?: {
    name?: string;
    email?: string;
    cpfCnpj?: string;
    postalCode?: string;
    addressNumber?: string;
    phone?: string;
  };
};

function providerPaymentUrl(raw: any, local?: any) {
  return raw?.invoiceUrl || raw?.bankSlipUrl || local?.payment_url || local?.boleto_url || null;
}

async function loadExistingInitial(supabase: any, proposalId: string) {
  const billingKey = buildBillingKey(proposalId, "initial", 1);
  const { data: invoice } = await supabase
    .from("faturas_inquilino")
    .select("*, asaas_payment:asaas_payments(*)")
    .eq("billing_key", billingKey)
    .maybeSingle();
  return invoice || null;
}

async function persistConsultationPaymentState(
  supabase: any,
  consultationId: string,
  incomingStatus: ReturnType<typeof normalizePaymentStatus>,
  providerEventAt: string,
  buildPatch: (
    current: any,
    nextStatus: string,
    incomingAccepted: boolean,
  ) => Record<string, unknown>,
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
      ...buildPatch(
        current,
        nextStatus,
        !staleEvent && normalizePaymentStatus(nextStatus) === incomingStatus,
      ),
    }),
  });
}

async function responseFor(
  supabase: any,
  params: {
    consultationId: string;
    recipient: any;
    invoice: any;
    payment?: any;
    raw?: any;
    deferred: boolean;
    notifications?: any;
  },
) {
  const localPayment = params.payment || params.invoice?.asaas_payment || null;
  const base = localPayment
    ? normalizedPaymentResponse(params.raw || localPayment.raw_response || {}, localPayment)
    : {
        success: true,
        paymentId: null,
        externalReference: params.invoice?.billing_key || null,
        status: params.invoice?.status || "awaiting_consolidation",
        paymentMethod: params.invoice?.payment_method || null,
        amount: Number(params.invoice?.valor || 0),
        dueDate: params.invoice?.vencimento || null,
        invoiceUrl: params.invoice?.payment_url || null,
        pix: null,
        boleto: null,
      };
  const states = await getContractBillingStates(supabase, params.consultationId);
  const notifications =
    params.notifications || (await getInvoiceNotificationSummary(supabase, params.invoice.id));
  return {
    ...base,
    success: true,
    localPaymentId: localPayment?.id || null,
    invoiceId: params.invoice.id,
    status: params.invoice.status || base.status,
    paymentStatus: normalizePaymentStatus(params.invoice.status || base.status),
    invoiceUrl: params.invoice.payment_url || base.invoiceUrl || null,
    deferPayment: params.deferred,
    recipient: publicRecipient(params.recipient),
    notifications,
    ...states,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST")
    return jsonResponse(req, { ok: false, error: "Metodo nao permitido." }, 405);

  try {
    const { supabase, user } = await requireUser(req);
    const body = (await req.json()) as Body;
    const proposalId = body.proposalId || body.consultationId;
    const action = body.action || "create";
    const paymentMethod = body.paymentMethod;
    const fireMode = body.selectedFireInsuranceMode || "embutido";
    const deferred = body.deferPayment === true;

    if (!proposalId)
      return jsonResponse(req, { ok: false, error: "Proposta nao encontrada." }, 400);
    if (!paymentMethod || !["pix", "boleto", "credit_card"].includes(paymentMethod)) {
      return jsonResponse(req, { ok: false, error: "Selecione uma forma de pagamento." }, 400);
    }
    if (paymentMethod === "credit_card") {
      // Cartao sempre vai pela recorrencia via asaas-create-subscription. O
      // branch secundario de credit_card abaixo nao e mais alcancavel.
      return jsonResponse(
        req,
        {
          ok: false,
          error: "Cartao requer a configuracao recorrente. Use asaas-create-subscription.",
          subscriptionRequired: true,
        },
        409,
      );
    }

    const { data: consulta, error: consultaError } = await supabase
      .from("consultas_credito")
      .select(
        "*, inquilinos(*), imoveis(*), planos(*), responsavel_profile:profiles!consultas_credito_profile_id_solicitante_fkey(id, nome, email, telefone, cnpj, role)",
      )
      .eq("id", proposalId)
      .maybeSingle();
    if (consultaError) throw consultaError;
    if (!consulta) return jsonResponse(req, { ok: false, error: "Proposta nao encontrada." }, 404);
    await assertCanManageConsultationBilling(supabase, user.id, consulta);
    await assertContractAcceptsBilling(supabase, consulta);

    const requestedBillingDueDay =
      body.billingDueDay === undefined ? null : normalizeContractBillingDueDay(body.billingDueDay);
    if (body.billingDueDay !== undefined && requestedBillingDueDay === null) {
      return jsonResponse(
        req,
        { ok: false, error: "Escolha o vencimento entre os dias 5, 10, 15, 20, 25 ou 28." },
        400,
      );
    }
    const storedBillingDueDay = normalizeContractBillingDueDay(consulta.billing_due_day);
    const billingDueDay =
      requestedBillingDueDay ||
      storedBillingDueDay ||
      (await resolveBillingDueDay(supabaseAdmin()));

    let contractPeriodMonths: number;
    try {
      contractPeriodMonths = resolveContractPeriodMonths(consulta);
    } catch {
      return jsonResponse(
        req,
        {
          ok: false,
          error:
            "Selecione um período de contrato válido, entre 1 e 120 meses, antes de gerar o pagamento.",
        },
        400,
      );
    }

    const recipient = await resolvePaymentRecipientFromContract(supabase, consulta);
    const initialDecision =
      paymentMethod === "credit_card"
        ? null
        : planInitialBilling({
            paymentMethod,
            deferPayment: deferred,
            payer: recipient.paymentResponsible,
            fireMode,
          });

    let existingInvoice = await loadExistingInitial(supabase, proposalId);
    if (
      existingInvoice &&
      requestedBillingDueDay &&
      Number(String(existingInvoice.vencimento || "").slice(-2)) !== requestedBillingDueDay
    ) {
      return jsonResponse(
        req,
        {
          ok: false,
          error: "O vencimento desta cobrança já foi definido e não pode ser alterado.",
        },
        409,
      );
    }
    if (action !== "create") {
      if (!existingInvoice) {
        return jsonResponse(req, { ok: false, error: "Cobranca ainda nao foi criada." }, 404);
      }
      let payment = existingInvoice.asaas_payment || null;
      let raw = payment?.raw_response || {};
      if (
        existingInvoice.status === "awaiting_consolidation" &&
        (action === "resend_email" || action === "resend_whatsapp")
      ) {
        return jsonResponse(
          req,
          {
            ok: false,
            error:
              "Esta fatura aguarda a cobranca consolidada da imobiliaria. O reenvio sera feito pelo lote quando o link existir.",
          },
          409,
        );
      }
      if (action === "refresh" && payment?.asaas_payment_id) {
        raw = await asaasFetch(`/payments/${payment.asaas_payment_id}`);
        const incoming = normalizePaymentStatus(mapAsaasStatus(raw?.status));
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
          buildPatch: ({ current, nextStatus, staleEvent }) => ({
            raw_response:
              !staleEvent && normalizePaymentStatus(nextStatus) === incoming
                ? sanitizedRaw
                : current.raw_response,
          }),
        });
        payment = paymentTransition.row;
        const effectivePaymentStatus = normalizePaymentStatus(payment.status);
        const invoiceTransition = await persistProviderTransition({
          supabase,
          table: "faturas_inquilino",
          rowId: existingInvoice.id,
          current: existingInvoice,
          incomingEventAt: providerEventAt,
          reduce: (currentStatus, currentEventAt, incomingEventAt) =>
            reducePaymentStatus(
              currentStatus as string,
              effectivePaymentStatus,
              currentEventAt,
              incomingEventAt,
            ),
          buildPatch: () => ({}),
        });
        existingInvoice = invoiceTransition.row;
      }
      if (payment?.payment_method === "pix") payment = await refetchPixQrCode(supabase, payment);
      let notifications: any;
      if (action === "resend_email" || action === "resend_whatsapp") {
        notifications = await sendInvoiceNotifications(supabase, {
          invoice: existingInvoice,
          recipient,
          paymentMethod,
          amount: Number(existingInvoice.valor),
          dueDate: existingInvoice.vencimento,
          paymentUrl: existingInvoice.payment_url || providerPaymentUrl(raw, payment),
          pixCopyPaste: payment?.pix_copy_paste,
          boletoBarcode: payment?.boleto_barcode,
          contractRef: String(proposalId).slice(0, 8).toUpperCase(),
          forceChannel: action === "resend_email" ? "email" : "whatsapp",
        });
      }
      return jsonResponse(
        req,
        await responseFor(supabase, {
          consultationId: proposalId,
          recipient,
          invoice: existingInvoice,
          payment,
          raw,
          deferred: consulta.payment_deferred === true,
          notifications,
        }),
      );
    }

    const expectedAmount = calculateExpectedPayment(consulta, fireMode);
    const monthlyAmount = calculateMonthlyInstallmentValue(consulta, fireMode);
    const requestedAmount = toMoney(body.amount ?? expectedAmount);
    if (expectedAmount <= 0 || monthlyAmount <= 0) {
      return jsonResponse(req, { ok: false, error: "Nao foi possivel calcular o pagamento." }, 400);
    }
    if (Math.abs(requestedAmount - expectedAmount) > 0.02) {
      return jsonResponse(
        req,
        {
          ok: false,
          error: "O valor do pagamento mudou. Atualize a pagina e tente novamente.",
          expectedAmount,
        },
        409,
      );
    }

    // Congela o prazo antes de qualquer retomada que consulte o provedor,
    // reserva local, materializacao ou criacao de recurso no Asaas.
    try {
      await lockContractPeriod(supabase, proposalId, contractPeriodMonths);
    } catch (error) {
      const conflict =
        error instanceof ContractPeriodLockError &&
        error.code === CONTRACT_PERIOD_LOCK_CONFLICT_CODE;
      console.error("[asaas-create-payment] falha ao bloquear período", {
        proposalId,
        code: error instanceof ContractPeriodLockError ? error.code : "unknown",
      });
      return jsonResponse(
        req,
        {
          ok: false,
          error: conflict
            ? "O período do contrato mudou. Atualize a página antes de gerar o pagamento."
            : "Não foi possível confirmar o período do contrato agora. Tente novamente.",
        },
        conflict ? 409 : 500,
      );
    }

    if (existingInvoice) {
      let payment = existingInvoice.asaas_payment || null;
      const currentMethod = payment?.payment_method || existingInvoice.payment_method;
      if (currentMethod && currentMethod !== paymentMethod) {
        const switched = await switchOpenInvoicePaymentMethod(supabase, {
          invoice: existingInvoice,
          payment,
          method: paymentMethod,
          dueDate: existingInvoice.vencimento,
        });
        existingInvoice = switched.invoice;
        payment = switched.payment;
        if (switched.changed) {
          await persistConsultationPaymentState(
            supabase,
            proposalId,
            normalizePaymentStatus(payment.status),
            switched.providerEventAt || new Date().toISOString(),
            () => ({
              payment_method: paymentMethod,
              payment_due_date: payment.due_date,
              payment_data: sanitizeAsaasResponse(switched.raw),
              payment_deferred: deferred,
              payment_deferred_at: deferred ? new Date().toISOString() : null,
              fire_insurance_payment_mode: fireMode,
            }),
          );
        }
      }
      if (payment?.payment_method === "pix") payment = await refetchPixQrCode(supabase, payment);
      queuePendingContractFlow(supabase, proposalId);
      return jsonResponse(
        req,
        await responseFor(supabase, {
          consultationId: proposalId,
          recipient,
          invoice: existingInvoice,
          payment,
          deferred: existingInvoice.components?.deferred === true || deferred,
        }),
      );
    }

    if (body.dueDate) {
      const dueDateError = billingDueDateError(body.dueDate, todayDate());
      if (dueDateError) return jsonResponse(req, { ok: false, error: dueDateError }, 400);
    }
    const dueDate = body.dueDate || nextContractBillingDueDate(todayDate(), billingDueDay);
    if (Number(dueDate.slice(-2)) !== billingDueDay) {
      return jsonResponse(
        req,
        { ok: false, error: "A data informada não corresponde ao dia de vencimento escolhido." },
        400,
      );
    }
    if (requestedBillingDueDay || storedBillingDueDay) {
      const { error: billingDueDayError } = await supabaseAdmin()
        .from("consultas_credito")
        .update({ billing_due_day: billingDueDay })
        .eq("id", proposalId);
      if (billingDueDayError) throw billingDueDayError;
      consulta.billing_due_day = billingDueDay;
    }
    const contractMonths = contractPeriodMonths;
    const billingKey = buildBillingKey(proposalId, "initial", 1);
    // A mesma chave usada na reserva local vai ao provedor. Assim uma resposta
    // perdida pode ser reconciliada por externalReference sem novo POST.
    const externalReference = billingKey;
    const { operation, claimed } = await claimBillingOperation(supabase, {
      consultationId: proposalId,
      operationType: "payment",
      idempotencyKey: billingKey,
      request: {
        proposalId,
        paymentMethod,
        fireMode,
        amount: expectedAmount,
        dueDate,
        billingDueDay,
        payer: recipient.paymentResponsible,
      },
      userId: user.id,
    });

    let raw: any = null;
    if (!claimed) {
      const racedInvoice = await loadExistingInitial(supabase, proposalId);
      if (racedInvoice) {
        return jsonResponse(
          req,
          await responseFor(supabase, {
            consultationId: proposalId,
            recipient,
            invoice: racedInvoice,
            payment: racedInvoice.asaas_payment,
            deferred,
          }),
        );
      }
      if (["reserved", "provider_created", "ambiguous", "persisted"].includes(operation.state)) {
        raw = await recoverPaymentForOperation(operation, externalReference);
      }
      if (!raw && (await reclaimStaleBillingOperation(supabase, operation))) {
        // A consulta por externalReference acima comprovou a ausencia no
        // provedor; este chamador ganhou o CAS e pode concluir a reserva orfa.
      } else if (!raw) {
        return jsonResponse(
          req,
          {
            ok: false,
            error:
              operation.state === "ambiguous"
                ? "A criacao da cobranca segue em conciliacao no Asaas. Nenhuma nova cobranca foi emitida."
                : "A cobranca ja esta sendo criada. Aguarde e consulte novamente.",
            retryable: true,
            reconciled: false,
            operationState: operation.state,
          },
          409,
        );
      }
      await updateBillingOperation(supabase, operation.id, {
        state: "provider_created",
        provider_id: raw?.id || operation.provider_id || null,
        provider_response: sanitizeAsaasResponse(raw),
        attempts: Number(operation.attempts || 0) + 1,
        last_error: null,
      });
    }

    const components = {
      deferred,
      fireMode,
      initialAmount: expectedAmount,
      monthlyAmount,
      includesFirstMonthlyPayment: true,
      contractMonths,
    };

    if (initialDecision && !initialDecision.createIndividualProviderCharge) {
      const invoice = await materializeInvoice(supabase, {
        consultation: consulta,
        recipient,
        billingKey,
        installmentNumber: 1,
        installmentTotal: contractMonths,
        dueDate,
        value: expectedAmount,
        status: initialDecision.invoiceStatus,
        chargeKind: "initial",
        paymentMethod,
        components,
      });
      await updateBillingOperation(supabase, operation.id, {
        invoice_id: invoice.id,
        state: "persisted",
        completed_at: new Date().toISOString(),
      });
      await persistConsultationPaymentState(
        supabase,
        proposalId,
        "awaiting_consolidation",
        new Date().toISOString(),
        (current) => ({
          payment_deferred: deferred,
          payment_deferred_at: deferred ? new Date().toISOString() : null,
          payment_method: paymentMethod,
          payment_value: expectedAmount,
          payment_due_date: dueDate,
          fire_insurance_payment_mode: fireMode,
          policy_status: ["active", "cancelled"].includes(current.policy_status)
            ? current.policy_status
            : "issued_pending",
        }),
      );
      try {
        await ensurePendingPolicy(supabase, proposalId);
      } catch (error) {
        console.error("[asaas-create-payment] apolice pendente sera retomada", {
          proposalId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      queuePendingContractFlow(supabase, proposalId);
      return jsonResponse(
        req,
        await responseFor(supabase, {
          consultationId: proposalId,
          recipient,
          invoice,
          deferred,
        }),
      );
    }

    let customerId: string;
    try {
      customerId = await ensureAsaasCustomer(supabase, consulta, recipient);
    } catch (error) {
      await updateBillingOperation(supabase, operation.id, {
        state: "failed",
        last_error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const billingType =
      paymentMethod === "pix" ? "PIX" : paymentMethod === "boleto" ? "BOLETO" : "CREDIT_CARD";
    const providerPayload: Record<string, unknown> = {
      customer: customerId,
      billingType,
      value: expectedAmount,
      dueDate,
      description: `NOX Fianca - inicial ${String(proposalId).slice(0, 8).toUpperCase()}`,
      externalReference,
    };

    if (paymentMethod === "credit_card" && !raw) {
      const card = body.creditCard || {};
      const holder = body.creditCardHolderInfo || {};
      if (!card.holderName || !card.number || !card.expiryMonth || !card.expiryYear || !card.ccv) {
        await updateBillingOperation(supabase, operation.id, {
          state: "failed",
          last_error: "missing_card",
        });
        return jsonResponse(req, { ok: false, error: "Preencha todos os dados do cartao." }, 400);
      }
      if (
        !holder.name ||
        !holder.email ||
        !holder.cpfCnpj ||
        !holder.postalCode ||
        !holder.addressNumber ||
        !holder.phone
      ) {
        await updateBillingOperation(supabase, operation.id, {
          state: "failed",
          last_error: "missing_holder",
        });
        return jsonResponse(
          req,
          { ok: false, error: "Preencha os dados do titular do cartao." },
          400,
        );
      }
      providerPayload.creditCard = {
        holderName: card.holderName,
        number: String(card.number).replace(/\s/g, ""),
        expiryMonth: card.expiryMonth,
        expiryYear: card.expiryYear,
        ccv: card.ccv,
      };
      providerPayload.creditCardHolderInfo = {
        name: holder.name,
        email: holder.email,
        cpfCnpj: String(holder.cpfCnpj).replace(/\D/g, ""),
        postalCode: String(holder.postalCode).replace(/\D/g, ""),
        addressNumber: holder.addressNumber,
        phone: String(holder.phone).replace(/\D/g, ""),
      };
      providerPayload.remoteIp =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
    }

    if (!raw) {
      try {
        raw = await asaasFetch("/payments", {
          method: "POST",
          body: JSON.stringify(providerPayload),
        });
        await updateBillingOperation(supabase, operation.id, {
          state: "provider_created",
          provider_id: raw?.id || null,
          provider_response: sanitizeAsaasResponse(raw),
        });
      } catch (error) {
        const ambiguous = !(error instanceof AsaasApiError) || error.status >= 500;
        await updateBillingOperation(supabase, operation.id, {
          state: ambiguous ? "ambiguous" : "failed",
          last_error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    const sanitized = sanitizeAsaasResponse(raw);
    const internalStatus = mapAsaasStatus(raw?.status);
    let pixQrCode: string | null = null;
    let pixCopyPaste: string | null = null;
    let pixExpiresAt: string | null = null;
    if (paymentMethod === "pix" && raw?.id) {
      try {
        const pix = await asaasFetch(`/payments/${raw.id}/pixQrCode`);
        pixQrCode = pix?.encodedImage || null;
        pixCopyPaste = pix?.payload || null;
        pixExpiresAt = pix?.expirationDate || null;
      } catch {
        console.error("[asaas-create-payment] QR Pix pendente de reidratacao", {
          proposalId,
          paymentId: raw?.id,
        });
      }
    }

    const localPayload = {
      consultation_id: proposalId,
      proposal_id: proposalId,
      plan_id: consulta.plano_id,
      user_id: user.id,
      tenant_user_id: consulta.tenant_user_id,
      asaas_customer_id: customerId,
      asaas_payment_id: raw?.id || null,
      external_reference: externalReference,
      idempotency_key: billingKey,
      billing_operation_id: operation.id,
      charge_kind: "initial",
      payment_method: paymentMethod,
      value: expectedAmount,
      status: internalStatus,
      due_date: dueDate,
      pix_qr_code: pixQrCode,
      pix_copy_paste: pixCopyPaste,
      pix_expires_at: pixExpiresAt,
      boleto_url: raw?.bankSlipUrl || raw?.invoiceUrl || null,
      boleto_barcode: raw?.identificationField || raw?.nossoNumero || null,
      raw_response: sanitized,
      payment_responsible: recipient.paymentResponsible,
      recipient_type: recipient.recipientType,
      recipient_user_id: recipient.recipientUserId,
      recipient_tenant_id: recipient.recipientTenantId,
      recipient_name: recipient.recipientName,
      recipient_email: recipient.recipientEmail,
      recipient_phone: recipient.recipientPhone,
    };
    const { data: localPayment, error: paymentError } = await supabase
      .from("asaas_payments")
      .upsert(localPayload, { onConflict: "idempotency_key" })
      .select("*")
      .maybeSingle();
    if (paymentError || !localPayment) {
      await updateBillingOperation(supabase, operation.id, {
        state: "provider_created",
        last_error: paymentError?.message || "local_payment_missing",
      });
      throw new Error("A cobranca foi criada e sera conciliada automaticamente.");
    }

    const paymentUrl = providerPaymentUrl(raw, localPayment);
    const invoice = await materializeInvoice(supabase, {
      consultation: consulta,
      recipient,
      billingKey,
      installmentNumber: 1,
      installmentTotal: contractMonths,
      dueDate,
      value: expectedAmount,
      status: internalStatus,
      chargeKind: "initial",
      paymentMethod,
      components,
      paymentUrl,
      localPaymentId: localPayment.id,
    });
    await updateBillingOperation(supabase, operation.id, {
      invoice_id: invoice.id,
      state: "persisted",
      completed_at: new Date().toISOString(),
      last_error: null,
    });
    await persistConsultationPaymentState(
      supabase,
      proposalId,
      normalizePaymentStatus(internalStatus),
      new Date().toISOString(),
      (current, _nextStatus, incomingAccepted) => ({
        asaas_customer_id: customerId,
        asaas_payment_id: raw?.id || null,
        external_reference: externalReference,
        payment_method: paymentMethod,
        payment_value: expectedAmount,
        payment_due_date: dueDate,
        payment_data: incomingAccepted ? sanitized : current.payment_data,
        payment_deferred: deferred,
        payment_deferred_at: deferred ? new Date().toISOString() : null,
        fire_insurance_payment_mode: fireMode,
        policy_status: ["active", "cancelled"].includes(current.policy_status)
          ? current.policy_status
          : "issued_pending",
      }),
    );

    try {
      await ensurePendingPolicy(supabase, proposalId);
    } catch (error) {
      console.error("[asaas-create-payment] apolice pendente sera retomada", {
        proposalId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    const notifications = await sendInvoiceNotifications(supabase, {
      invoice,
      recipient,
      paymentMethod,
      amount: expectedAmount,
      dueDate,
      paymentUrl,
      pixCopyPaste,
      boletoBarcode: localPayment.boleto_barcode,
      contractRef: String(proposalId).slice(0, 8).toUpperCase(),
    });
    queuePendingContractFlow(supabase, proposalId);

    return jsonResponse(
      req,
      await responseFor(supabase, {
        consultationId: proposalId,
        recipient,
        invoice,
        payment: localPayment,
        raw,
        deferred,
        notifications,
      }),
    );
  } catch (error) {
    console.error("[asaas-create-payment] erro", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(
      req,
      {
        ok: false,
        error: describePaymentError(error, "Nao foi possivel gerar o pagamento agora."),
      },
      paymentErrorStatus(error, 500),
    );
  }
});
