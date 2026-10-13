import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  AsaasApiError,
  FireMode,
  asaasFetch,
  calculateMonthlyInstallmentValue,
  corsHeaders,
  describePaymentError,
  formatBRL,
  formatDateBr,
  jsonResponse,
  logFinancialNotification,
  mapAsaasStatus,
  paymentErrorStatus,
  requireUser,
  resolvePaymentRecipientFromContract,
  sanitizeAsaasResponse,
  sendInstallmentScheduleEmail,
  sendPaymentWhatsapp,
  supabaseAdmin,
  toMoney,
  wasNotificationSent,
} from "../_shared/asaas.ts";
import { ensureAsaasCustomer } from "../_shared/asaas-customer.ts";
import {
  assertCanManageConsultationBilling,
  assertContractAcceptsBilling,
} from "../_shared/billing-auth.ts";
import { buildBillingKey, buildBillingSchedule } from "../_shared/billing-state.ts";
import { asaasLateFeePayload, resolveBillingDueDay } from "../_shared/billing-automation.ts";
import {
  CONTRACT_PERIOD_LOCK_CONFLICT_CODE,
  ContractPeriodLockError,
  lockContractPeriod,
  parseContractPeriodMonths,
  resolveContractPeriodMonths,
} from "../_shared/contract-period.ts";
import {
  claimBillingOperation,
  materializeInvoice,
  publicRecipient,
  queuePendingContractFlow,
  reclaimStaleBillingOperation,
  recoverPaymentForOperation,
  updateBillingOperation,
} from "../_shared/contract-billing.ts";

type Body = {
  proposalId?: string;
  consultationId?: string;
  paymentMethod?: "pix" | "boleto";
  selectedFireInsuranceMode?: FireMode;
  amount?: number;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") {
    return jsonResponse(req, { ok: false, error: "Metodo nao permitido." }, 405);
  }

  try {
    const { supabase, user } = await requireUser(req);
    const body = (await req.json()) as Body;
    const proposalId = body.proposalId || body.consultationId;
    const paymentMethod = body.paymentMethod || "boleto";
    const fireMode = body.selectedFireInsuranceMode || "embutido";
    if (!proposalId) {
      return jsonResponse(req, { ok: false, error: "Proposta nao encontrada." }, 400);
    }
    if (!["pix", "boleto"].includes(paymentMethod)) {
      return jsonResponse(
        req,
        { ok: false, error: "Cronograma disponivel para Pix ou boleto." },
        400,
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
    if (!consulta) {
      return jsonResponse(req, { ok: false, error: "Proposta nao encontrada." }, 404);
    }
    await assertCanManageConsultationBilling(supabase, user.id, consulta);
    await assertContractAcceptsBilling(supabase, consulta);
    const recipient = await resolvePaymentRecipientFromContract(supabase, consulta);

    const initialKey = buildBillingKey(proposalId, "initial", 1);
    const { data: initialInvoice, error: initialError } = await supabase
      .from("faturas_inquilino")
      .select("*, asaas_payment:asaas_payments(*)")
      .eq("billing_key", initialKey)
      .maybeSingle();
    if (initialError) throw initialError;
    if (!initialInvoice) {
      return jsonResponse(
        req,
        {
          ok: false,
          error: "Gere primeiro a cobranca inicial. Nenhuma mensalidade futura foi criada.",
          initialRequired: true,
        },
        409,
      );
    }
    if (initialInvoice.payment_method && initialInvoice.payment_method !== paymentMethod) {
      return jsonResponse(
        req,
        {
          ok: false,
          error: "O metodo difere da cobranca inicial. Consulte ou reemita a cobranca existente.",
        },
        409,
      );
    }
    const frozenFireMode = initialInvoice.components?.fireMode || fireMode;
    if (frozenFireMode !== fireMode) {
      return jsonResponse(
        req,
        {
          ok: false,
          error: "A forma de cobranca do seguro incendio difere da cobranca inicial.",
        },
        409,
      );
    }

    let contractPeriodMonths: number;
    try {
      contractPeriodMonths = resolveContractPeriodMonths(consulta);
    } catch {
      return jsonResponse(
        req,
        {
          ok: false,
          error:
            "Selecione um periodo de contrato valido, entre 1 e 120 meses, antes de gerar as cobrancas.",
        },
        400,
      );
    }

    const initialInstallmentTotal = parseContractPeriodMonths(initialInvoice.installment_total);
    const componentPeriodRaw = initialInvoice.components?.contractMonths;
    const componentPeriod =
      componentPeriodRaw == null ? null : parseContractPeriodMonths(componentPeriodRaw);
    if (
      initialInstallmentTotal === null ||
      (componentPeriodRaw != null && componentPeriod === null)
    ) {
      return jsonResponse(
        req,
        {
          ok: false,
          error:
            "A cobranca inicial possui um periodo invalido e precisa de revisao antes de continuar.",
        },
        409,
      );
    }
    if (
      initialInstallmentTotal !== contractPeriodMonths ||
      (componentPeriod !== null && componentPeriod !== contractPeriodMonths)
    ) {
      return jsonResponse(
        req,
        {
          ok: false,
          error:
            "O periodo da proposta nao coincide com a cobranca inicial. Nenhuma nova cobranca foi criada.",
        },
        409,
      );
    }
    const installmentTotal = contractPeriodMonths;

    const monthlyValue = calculateMonthlyInstallmentValue(consulta, fireMode);
    if (monthlyValue <= 0) {
      return jsonResponse(
        req,
        { ok: false, error: "Nao foi possivel calcular a mensalidade." },
        400,
      );
    }
    if (body.amount != null && Math.abs(toMoney(body.amount) - monthlyValue) > 0.02) {
      return jsonResponse(
        req,
        {
          ok: false,
          error: "O valor da mensalidade mudou. Atualize a pagina e tente novamente.",
          expectedAmount: monthlyValue,
        },
        409,
      );
    }

    const dueDay = await resolveBillingDueDay(supabaseAdmin());
    const schedule = buildBillingSchedule({
      consultationId: proposalId,
      months: installmentTotal,
      initialDueDate: initialInvoice.vencimento,
      monthlyDueDay: dueDay,
    });
    const { data: existingRows, error: existingError } = await supabase
      .from("faturas_inquilino")
      .select("*, asaas_payment:asaas_payments(*)")
      .eq("consulta_id", proposalId)
      .in("charge_kind", ["initial", "monthly"]);
    if (existingError) throw existingError;

    for (const invoice of existingRows || []) {
      const frozenTotal = parseContractPeriodMonths(invoice.installment_total);
      const installmentNumber = Number(invoice.numero_parcela);
      if (frozenTotal === null) {
        return jsonResponse(
          req,
          {
            ok: false,
            error:
              "O cronograma existente possui um periodo invalido e precisa de revisao antes de continuar.",
          },
          409,
        );
      }
      if (frozenTotal !== installmentTotal) {
        return jsonResponse(
          req,
          {
            ok: false,
            error:
              "O periodo da proposta nao coincide com o cronograma ja gerado. Nenhuma nova cobranca foi criada.",
          },
          409,
        );
      }
      if (
        !Number.isSafeInteger(installmentNumber) ||
        installmentNumber < 1 ||
        installmentNumber > installmentTotal
      ) {
        return jsonResponse(
          req,
          {
            ok: false,
            error:
              "O cronograma existente possui uma parcela incompatível com o periodo contratado.",
          },
          409,
        );
      }
    }

    try {
      await lockContractPeriod(supabase, proposalId, installmentTotal);
    } catch (error) {
      const conflict =
        error instanceof ContractPeriodLockError &&
        error.code === CONTRACT_PERIOD_LOCK_CONFLICT_CODE;
      console.error("[asaas-create-installment-plan] falha ao bloquear periodo", {
        proposalId,
        code: error instanceof ContractPeriodLockError ? error.code : "unknown",
      });
      return jsonResponse(
        req,
        {
          ok: false,
          error: conflict
            ? "O periodo do contrato mudou. Atualize a pagina antes de gerar as cobrancas."
            : "Nao foi possivel confirmar o periodo do contrato agora. Tente novamente.",
        },
        conflict ? 409 : 500,
      );
    }

    const byKey = new Map((existingRows || []).map((row: any) => [row.billing_key, row]));
    byKey.set(initialKey, initialInvoice);

    let customerId: string | null = null;
    if (recipient.paymentResponsible === "tenant") {
      customerId = await ensureAsaasCustomer(supabase, consulta, recipient);
    }

    for (const item of schedule.slice(1)) {
      if (byKey.has(item.billingKey)) continue;
      const status =
        recipient.paymentResponsible === "agency" ? "awaiting_consolidation" : "pending";
      if (recipient.paymentResponsible === "agency") {
        const invoice = await materializeInvoice(supabase, {
          consultation: consulta,
          recipient,
          billingKey: item.billingKey,
          installmentNumber: item.installmentNumber,
          installmentTotal,
          dueDate: item.dueDate,
          value: monthlyValue,
          status,
          chargeKind: "monthly",
          paymentMethod,
          components: { fireMode, monthlyAmount: monthlyValue, contractMonths: installmentTotal },
          referenceMonth: item.referenceMonth,
        });
        byKey.set(item.billingKey, invoice);
        continue;
      }

      const { operation, claimed } = await claimBillingOperation(supabase, {
        consultationId: proposalId,
        operationType: "installment",
        idempotencyKey: item.billingKey,
        request: {
          proposalId,
          installmentNumber: item.installmentNumber,
          paymentMethod,
          fireMode,
          value: monthlyValue,
          dueDate: item.dueDate,
        },
        userId: user.id,
      });
      let raw: any = null;
      if (!claimed) {
        const { data: raced } = await supabase
          .from("faturas_inquilino")
          .select("*, asaas_payment:asaas_payments(*)")
          .eq("billing_key", item.billingKey)
          .maybeSingle();
        if (raced) {
          byKey.set(item.billingKey, raced);
          continue;
        }
        if (["reserved", "provider_created", "ambiguous", "persisted"].includes(operation.state)) {
          raw = await recoverPaymentForOperation(operation, item.billingKey);
        }
        if (!raw && (await reclaimStaleBillingOperation(supabase, operation))) {
          // A busca por externalReference comprovou que a competencia ainda nao existe no Asaas.
        } else if (!raw) {
          return jsonResponse(
            req,
            {
              ok: false,
              error: `A mensalidade ${item.installmentNumber}/${installmentTotal} esta sendo conciliada no Asaas. Nenhuma cobranca nova foi emitida.`,
              created: byKey.size,
              total: installmentTotal,
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

      if (!raw) {
        try {
          raw = await asaasFetch("/payments", {
            method: "POST",
            body: JSON.stringify({
              customer: customerId,
              billingType: paymentMethod === "pix" ? "PIX" : "BOLETO",
              value: monthlyValue,
              dueDate: item.dueDate,
              description: `NOX Fianca - mensalidade ${item.installmentNumber}/${installmentTotal}`,
              externalReference: item.billingKey,
              ...asaasLateFeePayload(),
            }),
          });
          await updateBillingOperation(supabase, operation.id, {
            state: "provider_created",
            provider_id: raw?.id || null,
            provider_response: sanitizeAsaasResponse(raw),
          });
        } catch (error) {
          await updateBillingOperation(supabase, operation.id, {
            state: error instanceof AsaasApiError && error.status < 500 ? "failed" : "ambiguous",
            last_error: error instanceof Error ? error.message : String(error),
          });
          return jsonResponse(
            req,
            {
              ok: false,
              error: `Nao foi possivel gerar a mensalidade ${item.installmentNumber}/${installmentTotal}: ${describePaymentError(error, "tente novamente")}. As cobrancas existentes foram preservadas.`,
              created: byKey.size,
              total: installmentTotal,
            },
            paymentErrorStatus(error, 502),
          );
        }
      }

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
          // A mensalidade continua criada; refresh recupera o QR posteriormente.
        }
      }
      const internalStatus = mapAsaasStatus(raw?.status);
      const { data: payment, error: paymentError } = await supabase
        .from("asaas_payments")
        .upsert(
          {
            consultation_id: proposalId,
            proposal_id: proposalId,
            plan_id: consulta.plano_id,
            user_id: user.id,
            tenant_user_id: consulta.tenant_user_id,
            asaas_customer_id: customerId,
            asaas_payment_id: raw?.id || null,
            external_reference: item.billingKey,
            idempotency_key: item.billingKey,
            billing_operation_id: operation.id,
            charge_kind: "monthly",
            payment_method: paymentMethod,
            value: monthlyValue,
            status: internalStatus,
            due_date: item.dueDate,
            pix_qr_code: pixQrCode,
            pix_copy_paste: pixCopyPaste,
            pix_expires_at: pixExpiresAt,
            boleto_url: raw?.bankSlipUrl || raw?.invoiceUrl || null,
            boleto_barcode: raw?.identificationField || raw?.nossoNumero || null,
            raw_response: sanitizeAsaasResponse(raw),
            payment_responsible: recipient.paymentResponsible,
            recipient_type: recipient.recipientType,
            recipient_user_id: recipient.recipientUserId,
            recipient_tenant_id: recipient.recipientTenantId,
            recipient_name: recipient.recipientName,
            recipient_email: recipient.recipientEmail,
            recipient_phone: recipient.recipientPhone,
          },
          { onConflict: "idempotency_key" },
        )
        .select("*")
        .maybeSingle();
      if (paymentError || !payment) {
        await updateBillingOperation(supabase, operation.id, {
          state: "provider_created",
          last_error: paymentError?.message || "local_payment_missing",
        });
        return jsonResponse(
          req,
          {
            ok: false,
            error:
              "Uma mensalidade foi criada no Asaas e esta em conciliacao. Nao tente criar outra.",
            created: byKey.size,
            total: installmentTotal,
          },
          502,
        );
      }
      const paymentUrl = raw?.invoiceUrl || raw?.bankSlipUrl || null;
      const invoice = await materializeInvoice(supabase, {
        consultation: consulta,
        recipient,
        billingKey: item.billingKey,
        installmentNumber: item.installmentNumber,
        installmentTotal,
        dueDate: item.dueDate,
        value: monthlyValue,
        status: internalStatus,
        chargeKind: "monthly",
        paymentMethod,
        components: { fireMode, monthlyAmount: monthlyValue, contractMonths: installmentTotal },
        paymentUrl,
        localPaymentId: payment.id,
        referenceMonth: item.referenceMonth,
      });
      await updateBillingOperation(supabase, operation.id, {
        invoice_id: invoice.id,
        state: "persisted",
        completed_at: new Date().toISOString(),
      });
      byKey.set(item.billingKey, { ...invoice, asaas_payment: payment });
    }

    const invoices = schedule.map((item) => byKey.get(item.billingKey)).filter(Boolean);
    if (invoices.length === installmentTotal) {
      const anchor = initialInvoice;
      if (
        recipient.recipientEmail &&
        !(await wasNotificationSent(supabase, {
          invoiceId: anchor.id,
          channel: "email",
          notificationType: "billing_schedule_created",
        }))
      ) {
        const result = await sendInstallmentScheduleEmail({
          to: recipient.recipientEmail,
          nome: recipient.recipientName || "cliente",
          installments: schedule.map((item, index) => ({
            installmentNumber: item.installmentNumber,
            dueDate: item.dueDate,
            referenceMonth: Number(item.dueDate.slice(5, 7)),
            referenceYear: Number(item.dueDate.slice(0, 4)),
            value: index === 0 ? Number(initialInvoice.valor) : monthlyValue,
          })),
        });
        await logFinancialNotification(supabase, {
          invoiceId: anchor.id,
          recipientType: recipient.recipientType,
          recipientId: recipient.recipientTenantId || recipient.recipientUserId,
          channel: "email",
          notificationType: "billing_schedule_created",
          result,
        });
      }
      if (
        recipient.recipientPhone &&
        !(await wasNotificationSent(supabase, {
          invoiceId: anchor.id,
          channel: "whatsapp",
          notificationType: "billing_schedule_created",
        }))
      ) {
        const result = await sendPaymentWhatsapp({
          to: recipient.recipientPhone,
          mensagem: `Ola, ${recipient.recipientName || "cliente"}. O cronograma da NOX Fianca foi gerado sem duplicar a primeira mensalidade: inicial ${formatBRL(Number(initialInvoice.valor))} em ${formatDateBr(initialInvoice.vencimento)} e ${Math.max(installmentTotal - 1, 0)} mensalidades futuras de ${formatBRL(monthlyValue)}.`,
        });
        await logFinancialNotification(supabase, {
          invoiceId: anchor.id,
          recipientType: recipient.recipientType,
          recipientId: recipient.recipientTenantId || recipient.recipientUserId,
          channel: "whatsapp",
          notificationType: "billing_schedule_created",
          result,
        });
      }
    }

    queuePendingContractFlow(supabase, proposalId);
    return jsonResponse(req, {
      success: true,
      paymentMethod,
      fireMode,
      installmentTotal,
      initialInvoiceId: initialInvoice.id,
      initialAmount: Number(initialInvoice.valor),
      monthlyAmount: monthlyValue,
      recipient: publicRecipient(recipient),
      installments: invoices.map((invoice: any) => ({
        installmentNumber: invoice.numero_parcela,
        kind: invoice.charge_kind,
        dueDate: invoice.vencimento,
        value: Number(invoice.valor),
        status: invoice.status,
        paymentUrl: invoice.payment_url || invoice.boleto_url || null,
        boletoUrl: invoice.boleto_url || null,
        boletoBarcode: invoice.linha_digitavel || invoice.asaas_payment?.boleto_barcode || null,
        pix:
          invoice.asaas_payment?.pix_copy_paste || invoice.asaas_payment?.pix_qr_code
            ? {
                qrCode: invoice.asaas_payment?.pix_copy_paste || "",
                qrCodeBase64: invoice.asaas_payment?.pix_qr_code || "",
                expiresAt: invoice.asaas_payment?.pix_expires_at || null,
              }
            : null,
        faturaId: invoice.id,
      })),
    });
  } catch (error) {
    console.error("[asaas-create-installment-plan] erro", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(
      req,
      {
        ok: false,
        error: describePaymentError(error, "Nao foi possivel gerar o cronograma agora."),
      },
      paymentErrorStatus(error, 500),
    );
  }
});
