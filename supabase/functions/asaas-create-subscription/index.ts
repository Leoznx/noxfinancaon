import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  AsaasApiError,
  FireMode,
  HttpError,
  asaasFetch,
  calculateExpectedPayment,
  calculateMonthlyInstallmentValue,
  corsHeaders,
  describePaymentError,
  jsonResponse,
  mapAsaasStatus,
  paymentErrorStatus,
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
  parseContractPeriodMonths,
  resolveContractPeriodMonths,
} from "../_shared/contract-period.ts";
import {
  assertHasGlobalBillingRole,
  assertCanManageConsultationBilling,
  assertContractAcceptsBilling,
} from "../_shared/billing-auth.ts";
import {
  addCalendarMonths,
  anchoredRecurrencePlan,
  buildBillingKey,
  buildSubscriptionNotificationPlan,
  canReissueCheckout,
  normalizePaymentStatus,
  persistProviderTransition,
  reducePaymentStatus,
  reduceSubscriptionStatus,
  subscriptionStatusFromEvent,
} from "../_shared/billing-state.ts";
import { resolveBillingDueDay } from "../_shared/billing-automation.ts";
import {
  claimBillingOperation,
  cancelContractSubscription,
  getInvoiceNotificationSummary,
  materializeInvoice,
  publicRecipient,
  queuePendingContractFlow,
  reclaimStaleBillingOperation,
  recoverPaymentForOperation,
  recoverSubscriptionForOperation,
  sendInvoiceNotifications,
  updateBillingOperation,
} from "../_shared/contract-billing.ts";
import { ensurePendingPolicy } from "../_shared/d4sign.ts";

type Mode = "direct" | "checkout";
type Action =
  | "create"
  | "refresh"
  | "resend_email"
  | "resend_whatsapp"
  | "reissue_initial"
  | "reissue_checkout"
  | "cancel";

type Body = {
  proposalId?: string;
  mode?: Mode;
  selectedFireInsuranceMode?: FireMode;
  amount?: number;
  monthlyAmount?: number;
  action?: Action;
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

function strictContractPeriodMonths(consultation: any) {
  try {
    return resolveContractPeriodMonths(consultation);
  } catch {
    throw new HttpError(
      400,
      "Selecione um período de contrato válido, entre 1 e 120 meses, antes de configurar a recorrência.",
    );
  }
}

function assertStoredContractPeriod(subscription: any, expectedMonths: number) {
  const invoice = subscription?.initial_invoice;
  const storedValues = [invoice?.installment_total, invoice?.components?.contractMonths];
  for (const value of storedValues) {
    if (value === null || value === undefined || value === "") continue;
    if (parseContractPeriodMonths(value) !== expectedMonths) {
      throw new HttpError(
        409,
        "O período salvo da cobrança diverge do contrato. Atualize a página e encaminhe para conciliação.",
      );
    }
  }

  if (
    subscription?.recurrence_total_payments !== null &&
    subscription?.recurrence_total_payments !== undefined
  ) {
    const recurringPayments = Number(subscription.recurrence_total_payments);
    if (
      !Number.isSafeInteger(recurringPayments) ||
      recurringPayments < 0 ||
      recurringPayments + 1 !== expectedMonths
    ) {
      throw new HttpError(
        409,
        "O período salvo da recorrência diverge do contrato. Atualize a página e encaminhe para conciliação.",
      );
    }
  }
}

async function acquireContractPeriodLock(
  supabase: any,
  consultationId: string,
  expectedMonths: number,
) {
  try {
    await lockContractPeriod(supabase, consultationId, expectedMonths);
  } catch (error) {
    const conflict =
      error instanceof ContractPeriodLockError && error.code === CONTRACT_PERIOD_LOCK_CONFLICT_CODE;
    throw new HttpError(
      conflict ? 409 : 500,
      conflict
        ? "O período do contrato mudou. Atualize a página antes de configurar a recorrência."
        : "Não foi possível confirmar o período do contrato agora. Tente novamente.",
    );
  }
}

function reduceCardRetryStatus(
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
  if (["confirmed", "paid", "cancelled", "refunded", "chargeback"].includes(normalizedCurrent)) {
    return normalizedCurrent;
  }
  return incomingStatus;
}

function reduceCheckoutRetryPaymentStatus(
  currentStatus: unknown,
  currentEventAt?: string | null,
  incomingEventAt?: string | null,
) {
  const normalizedCurrent = normalizePaymentStatus(currentStatus);
  const currentTime = currentEventAt ? Date.parse(currentEventAt) : Number.NaN;
  const incomingTime = incomingEventAt ? Date.parse(incomingEventAt) : Number.NaN;
  if (Number.isFinite(currentTime) && Number.isFinite(incomingTime) && incomingTime < currentTime) {
    return normalizedCurrent;
  }
  if (["confirmed", "paid", "refunded", "chargeback"].includes(normalizedCurrent)) {
    return normalizedCurrent;
  }
  return "pending";
}

async function cancelSupersededCheckout(checkoutId: string | null | undefined) {
  if (!checkoutId) return;
  try {
    await asaasFetch(`/checkouts/${checkoutId}/cancel`, { method: "POST" });
  } catch (error) {
    if (!(error instanceof AsaasApiError && error.status === 404)) throw error;
  }
}

function checkoutUrl(checkout: any) {
  if (checkout?.link || checkout?.url || checkout?.checkoutUrl) {
    return checkout.link || checkout.url || checkout.checkoutUrl;
  }
  if (!checkout?.id) return null;
  const base =
    Deno.env.get("ASAAS_CHECKOUT_URL_BASE") || "https://asaas.com/checkoutSession/show?id=";
  return `${base}${encodeURIComponent(checkout.id)}`;
}

async function recoverCheckoutForOperation(
  operation: any,
  cached?: any,
  persistedId?: string | null,
) {
  if (cached?.id) return cached;
  const providerId = persistedId || operation?.provider_id || operation?.provider_response?.id;
  if (!providerId) return null;
  return await asaasFetch(`/checkouts/${providerId}`);
}

function directCardPayload(body: Body, req: Request) {
  const card = body.creditCard || {};
  const holder = body.creditCardHolderInfo || {};
  if (!card.holderName || !card.number || !card.expiryMonth || !card.expiryYear || !card.ccv) {
    throw new HttpError(400, "Preencha todos os dados do cartao.");
  }
  if (
    !holder.name ||
    !holder.email ||
    !holder.cpfCnpj ||
    !holder.postalCode ||
    !holder.addressNumber ||
    !holder.phone
  ) {
    throw new HttpError(400, "Preencha os dados do titular do cartao.");
  }
  return {
    creditCard: {
      holderName: card.holderName,
      number: String(card.number).replace(/\s/g, ""),
      expiryMonth: card.expiryMonth,
      expiryYear: card.expiryYear,
      ccv: card.ccv,
    },
    creditCardHolderInfo: {
      name: holder.name,
      email: holder.email,
      cpfCnpj: String(holder.cpfCnpj).replace(/\D/g, ""),
      postalCode: String(holder.postalCode).replace(/\D/g, ""),
      addressNumber: holder.addressNumber,
      phone: String(holder.phone).replace(/\D/g, ""),
    },
    remoteIp: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1",
  };
}

async function loadSubscription(supabase: any, proposalId: string) {
  const { data } = await supabase
    .from("asaas_subscriptions")
    .select("*, initial_invoice:faturas_inquilino!asaas_subscriptions_initial_invoice_id_fkey(*)")
    .eq("consultation_id", proposalId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

async function subscriptionResponse(supabase: any, subscription: any, recipient: any) {
  const invoice =
    subscription.initial_invoice ||
    (subscription.initial_invoice_id
      ? (
          await supabase
            .from("faturas_inquilino")
            .select("*")
            .eq("id", subscription.initial_invoice_id)
            .maybeSingle()
        ).data
      : null);
  let payment: any = null;
  if (invoice?.asaas_payment_id) {
    payment = (
      await supabase
        .from("asaas_payments")
        .select("*")
        .eq("id", invoice.asaas_payment_id)
        .maybeSingle()
    ).data;
  }
  const notifications = invoice?.id
    ? await getInvoiceNotificationSummary(
        supabase,
        invoice.id,
        subscription.mode === "checkout" ? "card_registration_requested" : "payment_created",
      )
    : {
        email: { status: "skipped", sentAt: null, error: null },
        whatsapp: { status: "skipped", sentAt: null, error: null },
      };
  const raw = subscription.raw_response || {};
  const initialCheckout = raw?.initialCheckout || null;
  const paymentStatus = normalizePaymentStatus(invoice?.status || subscription.payment_status);
  return {
    success: true,
    mode: subscription.mode,
    localSubscriptionId: subscription.id,
    subscriptionId: subscription.asaas_subscription_id || null,
    checkoutId: subscription.asaas_checkout_id || null,
    checkoutUrl: subscription.checkout_url || null,
    status: subscription.status,
    initialCheckoutStatus: subscription.initial_checkout_status || "pending",
    checkoutStatus: subscription.checkout_status || "pending",
    cardRegistrationStatus: subscription.card_registration_status,
    paymentStatus,
    requiresCardResubmission:
      subscription.mode === "direct" &&
      !subscription.asaas_subscription_id &&
      (["confirmed", "paid", "refused"].includes(paymentStatus) || subscription.status === "error"),
    initialAmount: Number(subscription.initial_amount),
    monthlyAmount: Number(subscription.monthly_amount),
    nextDueDate: subscription.next_due_date,
    initialPayment: invoice
      ? {
          paymentId: payment?.asaas_payment_id || initialCheckout?.id || null,
          invoiceId: invoice.id,
          status: invoice.status,
          invoiceUrl: invoice.payment_url || payment?.boleto_url || checkoutUrl(initialCheckout),
          pix: null,
          boleto: null,
        }
      : null,
    split: {
      required: subscription.split_initial_payment === true,
      reason: subscription.split_initial_payment
        ? "O Checkout recorrente autoriza as mensalidades; a cobranca inicial e uma operacao oficial separada."
        : undefined,
      initialPaymentUrl:
        subscription.initial_checkout_url || invoice?.payment_url || checkoutUrl(initialCheckout),
    },
    recipient: publicRecipient(recipient),
    notifications,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") {
    return jsonResponse(req, { ok: false, error: "Metodo nao permitido." }, 405);
  }

  try {
    const { supabase, user } = await requireUser(req);
    const body = (await req.json()) as Body;
    const proposalId = body.proposalId;
    const mode = body.mode;
    const action = body.action || "create";
    const fireMode = body.selectedFireInsuranceMode || "embutido";
    if (!proposalId) {
      return jsonResponse(req, { ok: false, error: "Proposta nao encontrada." }, 400);
    }
    if (!mode || !["direct", "checkout"].includes(mode)) {
      return jsonResponse(req, { ok: false, error: "Escolha como cadastrar o cartao." }, 400);
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
    if (action !== "cancel") await assertContractAcceptsBilling(supabase, consulta);
    const recipient = await resolvePaymentRecipientFromContract(supabase, consulta);
    if (recipient.paymentResponsible !== "tenant") {
      return jsonResponse(
        req,
        {
          ok: false,
          error:
            "Cartao recorrente requer o inquilino como responsavel financeiro. Para imobiliaria, use a cobranca consolidada.",
        },
        409,
      );
    }

    let existing = await loadSubscription(supabase, proposalId);
    if (existing && (existing.mode !== mode || existing.fire_insurance_payment_mode !== fireMode)) {
      return jsonResponse(
        req,
        {
          ok: false,
          error:
            "Ja existe uma configuracao de cartao com outra modalidade. Atualize ou conclua a configuracao existente.",
        },
        409,
      );
    }
    if (action !== "create") {
      if (!existing) {
        return jsonResponse(
          req,
          { ok: false, error: "Assinatura recorrente nao encontrada." },
          404,
        );
      }
      if (action === "cancel") {
        await assertHasGlobalBillingRole(supabase, user.id);
        const result = await cancelContractSubscription(supabase, {
          consultationId: proposalId,
          actorId: user.id,
          reason: "cancelamento_solicitado_no_painel",
        });
        if (!result.cancelled) {
          return jsonResponse(
            req,
            {
              ok: false,
              success: false,
              error:
                "O cancelamento da recorrencia requer conciliacao com o Asaas. Encaminhe para revisao financeira.",
              manualReview: result.manualReview === true,
              operationState: result.operationState || null,
            },
            409,
          );
        }
        existing = result.subscription || (await loadSubscription(supabase, proposalId));
        return jsonResponse(req, {
          ...(await subscriptionResponse(supabase, existing, recipient)),
          cancelled: true,
          reused: result.reused === true,
        });
      }
      if (action === "reissue_initial") {
        if (existing.mode !== "checkout") {
          return jsonResponse(
            req,
            {
              ok: false,
              error: "Reemissao de Checkout inicial so se aplica ao cadastro hospedado.",
            },
            409,
          );
        }
        if (!["cancelled", "expired"].includes(existing.initial_checkout_status)) {
          return jsonResponse(
            req,
            {
              ok: false,
              error: "O Checkout inicial atual ainda e valido e nao pode ser substituido.",
            },
            409,
          );
        }
        if (
          existing.status === "cancelled" ||
          ["confirmed", "paid", "refunded", "chargeback"].includes(
            normalizePaymentStatus(existing.payment_status),
          )
        ) {
          return jsonResponse(
            req,
            {
              ok: false,
              error: "O estado financeiro mudou e o Checkout inicial nao pode mais ser reemitido.",
            },
            409,
          );
        }
        const contractMonths = strictContractPeriodMonths(consulta);
        assertStoredContractPeriod(existing, contractMonths);
        await acquireContractPeriodLock(supabase, proposalId, contractMonths);

        const attempt = Number(existing.raw_response?.initialCheckoutAttempt || 0) + 1;
        const retryKey = buildBillingKey(proposalId, "checkout", `initial-retry-${attempt}`);
        const frontend = (Deno.env.get("FRONTEND_URL") || "https://noxfianca.com").replace(
          /\/$/,
          "",
        );
        const retryPayload = {
          billingTypes: ["CREDIT_CARD"],
          chargeTypes: ["DETACHED"],
          minutesToExpire: 1440,
          customer: existing.asaas_customer_id,
          callback: {
            successUrl: `${frontend}/consultas/${proposalId}/finalizar?checkout=success`,
            cancelUrl: `${frontend}/consultas/${proposalId}/finalizar?checkout=cancelled`,
            expiredUrl: `${frontend}/consultas/${proposalId}/finalizar?checkout=expired`,
          },
          externalReference: retryKey,
          items: [
            {
              name: "NOX Fianca - valor inicial",
              description: "Reemissao da taxa de ativacao e primeira mensalidade",
              quantity: 1,
              value: Number(existing.initial_amount),
            },
          ],
        };
        const { operation: retryOperation, claimed: retryClaimed } = await claimBillingOperation(
          supabase,
          {
            consultationId: proposalId,
            invoiceId: existing.initial_invoice_id,
            operationType: "checkout",
            idempotencyKey: retryKey,
            request: retryPayload,
            userId: user.id,
          },
        );
        let replacement = await recoverCheckoutForOperation(retryOperation);
        if (!replacement && !retryClaimed) {
          return jsonResponse(
            req,
            {
              ok: false,
              success: false,
              error:
                "A reemissao do Checkout inicial esta em conciliacao. Nenhum link novo foi criado.",
              operationState: retryOperation.state,
              retryable: true,
            },
            409,
          );
        }
        if (!replacement) {
          try {
            replacement = await asaasFetch("/checkouts", {
              method: "POST",
              body: JSON.stringify(retryPayload),
            });
            await updateBillingOperation(supabase, retryOperation.id, {
              state: "provider_created",
              provider_id: replacement?.id || null,
              provider_response: sanitizeAsaasResponse(replacement),
            });
          } catch (error) {
            await updateBillingOperation(supabase, retryOperation.id, {
              state: error instanceof AsaasApiError && error.status < 500 ? "failed" : "ambiguous",
              last_error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        }
        const safeReplacement = sanitizeAsaasResponse(replacement);
        const replacementUrl = checkoutUrl(replacement);
        const retryStartedAt = new Date().toISOString();
        const subscriptionTransition = await persistProviderTransition({
          supabase,
          table: "asaas_subscriptions",
          rowId: existing.id,
          current: existing,
          incomingEventAt: retryStartedAt,
          statusColumn: "initial_checkout_status",
          eventAtColumn: null,
          readEventAt: (row) => row.provider_event_at,
          guardColumns: [
            "asaas_initial_checkout_id",
            "payment_status",
            "status",
            "provider_event_at",
          ],
          reduce: (currentStatus) =>
            ["cancelled", "expired"].includes(String(currentStatus || ""))
              ? "pending"
              : String(currentStatus),
          buildPatch: ({ current, nextStatus, staleEvent }) => {
            const retryApplied =
              !staleEvent &&
              nextStatus === "pending" &&
              ["cancelled", "expired"].includes(current.initial_checkout_status) &&
              current.status !== "cancelled" &&
              !["confirmed", "paid", "refunded", "chargeback"].includes(
                normalizePaymentStatus(current.payment_status),
              );
            return retryApplied
              ? {
                  asaas_initial_checkout_id: replacement?.id || null,
                  initial_checkout_url: replacementUrl,
                  payment_status: "pending",
                  raw_response: {
                    ...(current.raw_response || {}),
                    initialCheckout: safeReplacement,
                    initialCheckoutAttempt: attempt,
                  },
                }
              : {};
          },
        });
        const initialRetryApplied =
          !subscriptionTransition.staleEvent &&
          subscriptionTransition.nextStatus === "pending" &&
          ["cancelled", "expired"].includes(
            subscriptionTransition.current.initial_checkout_status,
          ) &&
          subscriptionTransition.current.status !== "cancelled" &&
          !["confirmed", "paid", "refunded", "chargeback"].includes(
            normalizePaymentStatus(subscriptionTransition.current.payment_status),
          );
        if (!initialRetryApplied) {
          await cancelSupersededCheckout(replacement?.id);
          await updateBillingOperation(supabase, retryOperation.id, {
            state: "failed",
            last_error: "superseded_by_newer_financial_state",
            completed_at: new Date().toISOString(),
          });
          return jsonResponse(
            req,
            {
              ok: false,
              error: "O estado financeiro mudou durante a reemissao. O novo link foi cancelado.",
            },
            409,
          );
        }
        const reissued = subscriptionTransition.row;
        if (existing.initial_invoice_id) {
          const invoice =
            existing.initial_invoice ||
            (
              await supabase
                .from("faturas_inquilino")
                .select("*")
                .eq("id", existing.initial_invoice_id)
                .maybeSingle()
            ).data;
          if (invoice) {
            await persistProviderTransition({
              supabase,
              table: "faturas_inquilino",
              rowId: invoice.id,
              current: invoice,
              incomingEventAt: retryStartedAt,
              reduce: (currentStatus, currentEventAt, incomingEventAt) =>
                reduceCheckoutRetryPaymentStatus(currentStatus, currentEventAt, incomingEventAt),
              buildPatch: ({ nextStatus }) =>
                nextStatus === "pending"
                  ? { vencimento: todayDate(), payment_url: replacementUrl }
                  : {},
            });
          }
        }
        await updateBillingOperation(supabase, retryOperation.id, {
          state: "persisted",
          provider_id: replacement?.id || null,
          provider_response: safeReplacement,
          completed_at: new Date().toISOString(),
          last_error: null,
        });
        existing = reissued;
        const invoice =
          existing.initial_invoice ||
          (
            await supabase
              .from("faturas_inquilino")
              .select("*")
              .eq("id", existing.initial_invoice_id)
              .maybeSingle()
          ).data;
        if (invoice) {
          await sendInvoiceNotifications(supabase, {
            invoice,
            recipient,
            paymentMethod: "credit_card",
            amount: Number(existing.initial_amount),
            dueDate: todayDate(),
            paymentUrl: replacementUrl,
            contractRef: String(proposalId).slice(0, 8).toUpperCase(),
            notificationType: "payment_reissued",
          });
        }
        return jsonResponse(req, await subscriptionResponse(supabase, existing, recipient));
      }
      if (action === "reissue_checkout") {
        if (existing.mode !== "checkout") {
          return jsonResponse(
            req,
            {
              ok: false,
              error: "Reemissao de Checkout recorrente so se aplica ao cadastro hospedado.",
            },
            409,
          );
        }
        if (!canReissueCheckout(existing.checkout_status)) {
          return jsonResponse(
            req,
            {
              ok: false,
              error: "O Checkout recorrente atual ainda e valido e nao pode ser substituido.",
            },
            409,
          );
        }
        if (["active", "cancelled", "expired"].includes(existing.status)) {
          return jsonResponse(
            req,
            {
              ok: false,
              error:
                "O estado da recorrencia mudou e o Checkout recorrente nao pode ser reemitido.",
            },
            409,
          );
        }
        const attempt = Number(existing.raw_response?.recurrentCheckoutAttempt || 0) + 1;
        const retryKey = buildBillingKey(proposalId, "checkout", `recurring-retry-${attempt}`);
        const frontend = (Deno.env.get("FRONTEND_URL") || "https://noxfianca.com").replace(
          /\/$/,
          "",
        );
        const dueDay = await resolveBillingDueDay(supabaseAdmin());
        const contractMonths = strictContractPeriodMonths(consulta);
        assertStoredContractPeriod(existing, contractMonths);
        const originalStartDate = existing.recurrence_start_date || existing.next_due_date;
        const originalEndDate =
          existing.recurrence_end_date ||
          addCalendarMonths(originalStartDate, Math.max(contractMonths - 2, 0), dueDay);
        const recurrencePlan = anchoredRecurrencePlan({
          originalStartDate,
          originalEndDate,
          today: todayDate(),
          dueDay,
        });
        if (!recurrencePlan.nextDueDate || recurrencePlan.remainingPayments < 1) {
          return jsonResponse(
            req,
            {
              ok: false,
              error: "O prazo original do contrato terminou; nao ha competencias para reemitir.",
            },
            409,
          );
        }
        await acquireContractPeriodLock(supabase, proposalId, contractMonths);

        const nextDueDate = recurrencePlan.nextDueDate;
        const recurrentPayload = {
          billingTypes: ["CREDIT_CARD"],
          chargeTypes: ["RECURRENT"],
          minutesToExpire: 1440,
          customer:
            existing.asaas_customer_id ||
            (await ensureAsaasCustomer(supabase, consulta, recipient)),
          callback: {
            successUrl: `${frontend}/consultas/${proposalId}/finalizar?checkout=success`,
            cancelUrl: `${frontend}/consultas/${proposalId}/finalizar?checkout=cancelled`,
            expiredUrl: `${frontend}/consultas/${proposalId}/finalizar?checkout=expired`,
          },
          externalReference: retryKey,
          items: [
            {
              name: "NOX Fianca - mensalidade",
              description: "Reemissao da autorizacao de cobranca mensal recorrente",
              quantity: 1,
              value: Number(existing.monthly_amount),
            },
          ],
          subscription: {
            cycle: "MONTHLY",
            nextDueDate: `${nextDueDate} 12:00:00`,
            endDate: `${recurrencePlan.endDate} 23:59:59`,
          },
        };
        const { operation: retryOperation, claimed: retryClaimed } = await claimBillingOperation(
          supabase,
          {
            consultationId: proposalId,
            invoiceId: existing.initial_invoice_id,
            operationType: "checkout",
            idempotencyKey: retryKey,
            request: recurrentPayload,
            userId: user.id,
          },
        );
        let replacement = await recoverCheckoutForOperation(retryOperation);
        if (!replacement && !retryClaimed) {
          return jsonResponse(
            req,
            {
              ok: false,
              success: false,
              error:
                "A reemissao do Checkout recorrente esta em conciliacao. Nenhum link novo foi criado.",
              operationState: retryOperation.state,
              retryable: true,
            },
            409,
          );
        }
        if (!replacement) {
          try {
            replacement = await asaasFetch("/checkouts", {
              method: "POST",
              body: JSON.stringify(recurrentPayload),
            });
            await updateBillingOperation(supabase, retryOperation.id, {
              state: "provider_created",
              provider_id: replacement?.id || null,
              provider_response: sanitizeAsaasResponse(replacement),
            });
          } catch (error) {
            await updateBillingOperation(supabase, retryOperation.id, {
              state: error instanceof AsaasApiError && error.status < 500 ? "failed" : "ambiguous",
              last_error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        }
        const safeReplacement = sanitizeAsaasResponse(replacement);
        const replacementUrl = checkoutUrl(replacement);
        const retryStartedAt = new Date().toISOString();
        const subscriptionTransition = await persistProviderTransition({
          supabase,
          table: "asaas_subscriptions",
          rowId: existing.id,
          current: existing,
          incomingEventAt: retryStartedAt,
          statusColumn: "checkout_status",
          eventAtColumn: null,
          readEventAt: (row) => row.provider_event_at,
          guardColumns: [
            "asaas_checkout_id",
            "asaas_subscription_id",
            "status",
            "provider_event_at",
          ],
          reduce: (currentStatus) =>
            canReissueCheckout(currentStatus) ? "pending" : String(currentStatus),
          buildPatch: ({ current, nextStatus, staleEvent }) => {
            const retryApplied =
              !staleEvent &&
              nextStatus === "pending" &&
              canReissueCheckout(current.checkout_status) &&
              !["active", "cancelled", "expired"].includes(current.status);
            return retryApplied
              ? {
                  asaas_subscription_id: null,
                  asaas_checkout_id: replacement?.id || null,
                  checkout_url: replacementUrl,
                  status: "pending",
                  card_registration_status: "awaiting_card",
                  next_due_date: nextDueDate,
                  cancelled_at: null,
                  raw_response: {
                    ...(current.raw_response || {}),
                    recurrentCheckout: safeReplacement,
                    recurrentCheckoutAttempt: attempt,
                    recurringCheckoutEventAt: retryStartedAt,
                  },
                }
              : {};
          },
        });
        const recurringRetryApplied =
          !subscriptionTransition.staleEvent &&
          subscriptionTransition.nextStatus === "pending" &&
          canReissueCheckout(subscriptionTransition.current.checkout_status) &&
          !["active", "cancelled", "expired"].includes(subscriptionTransition.current.status);
        if (!recurringRetryApplied) {
          await cancelSupersededCheckout(replacement?.id);
          await updateBillingOperation(supabase, retryOperation.id, {
            state: "failed",
            last_error: "superseded_by_newer_subscription_state",
            completed_at: new Date().toISOString(),
          });
          return jsonResponse(
            req,
            {
              ok: false,
              error: "A recorrencia mudou durante a reemissao. O novo link foi cancelado.",
            },
            409,
          );
        }
        const reissued = subscriptionTransition.row;
        await updateBillingOperation(supabase, retryOperation.id, {
          state: "persisted",
          provider_id: replacement?.id || null,
          provider_response: safeReplacement,
          completed_at: new Date().toISOString(),
          last_error: null,
        });
        existing = reissued;
        const invoice =
          existing.initial_invoice ||
          (
            await supabase
              .from("faturas_inquilino")
              .select("*")
              .eq("id", existing.initial_invoice_id)
              .maybeSingle()
          ).data;
        if (invoice) {
          for (const forceChannel of ["email", "whatsapp"] as const) {
            await sendInvoiceNotifications(supabase, {
              invoice,
              recipient,
              paymentMethod: "credit_card",
              amount: Number(existing.monthly_amount),
              dueDate: nextDueDate,
              paymentUrl: replacementUrl,
              contractRef: String(proposalId).slice(0, 8).toUpperCase(),
              forceChannel,
              cardRegistration: true,
              notificationType: "card_registration_requested",
            });
          }
        }
        return jsonResponse(req, await subscriptionResponse(supabase, existing, recipient));
      }
      if (action === "refresh") {
        let raw: any = null;
        if (existing.asaas_subscription_id) {
          raw = await asaasFetch(`/subscriptions/${existing.asaas_subscription_id}`);
          const incoming = subscriptionStatusFromEvent("SUBSCRIPTION_UPDATED", raw?.status);
          const eventAt = new Date().toISOString();
          const safeRaw = sanitizeAsaasResponse(raw);
          const transition = await persistProviderTransition({
            supabase,
            table: "asaas_subscriptions",
            rowId: existing.id,
            current: existing,
            incomingEventAt: eventAt,
            reduce: (currentStatus, currentEventAt, incomingEventAt) =>
              reduceSubscriptionStatus(
                currentStatus as string,
                incoming,
                currentEventAt,
                incomingEventAt,
              ),
            buildPatch: ({ current, nextStatus, staleEvent }) => {
              const incomingAccepted = !staleEvent && nextStatus === incoming;
              return {
                card_registration_status:
                  incomingAccepted && current.mode === "checkout" && nextStatus === "active"
                    ? "registered"
                    : current.card_registration_status,
                raw_response: incomingAccepted
                  ? current.mode === "checkout"
                    ? { ...(current.raw_response || {}), lastSubscriptionRefresh: safeRaw }
                    : safeRaw
                  : current.raw_response,
                activated_at:
                  incomingAccepted && nextStatus === "active"
                    ? current.activated_at || new Date().toISOString()
                    : current.activated_at,
              };
            },
          });
          existing = transition.row;
        } else if (existing.mode === "direct") {
          const recoveryKey = buildBillingKey(proposalId, "subscription", "direct");
          const { data: recoveryOperation } = await supabase
            .from("billing_operations")
            .select("*")
            .eq("idempotency_key", recoveryKey)
            .maybeSingle();
          raw = await recoverSubscriptionForOperation(recoveryOperation, recoveryKey);
          if (raw?.id) {
            const incoming = subscriptionStatusFromEvent("SUBSCRIPTION_UPDATED", raw?.status);
            const eventAt = new Date().toISOString();
            const safeRaw = sanitizeAsaasResponse(raw);
            const transition = await persistProviderTransition({
              supabase,
              table: "asaas_subscriptions",
              rowId: existing.id,
              current: existing,
              incomingEventAt: eventAt,
              reduce: (currentStatus, currentEventAt, incomingEventAt) =>
                reduceSubscriptionStatus(
                  currentStatus as string,
                  incoming,
                  currentEventAt,
                  incomingEventAt,
                ),
              buildPatch: ({ current, nextStatus, staleEvent }) => {
                const incomingAccepted = !staleEvent && nextStatus === incoming;
                return {
                  asaas_subscription_id: raw.id,
                  card_registration_status: incomingAccepted
                    ? "not_required"
                    : current.card_registration_status,
                  raw_response: incomingAccepted ? safeRaw : current.raw_response,
                  activated_at:
                    incomingAccepted && nextStatus === "active"
                      ? current.activated_at || new Date().toISOString()
                      : current.activated_at,
                };
              },
            });
            existing = transition.row;
            if (recoveryOperation?.id) {
              await updateBillingOperation(supabase, recoveryOperation.id, {
                state: "persisted",
                provider_id: raw.id,
                provider_response: safeRaw,
                completed_at: new Date().toISOString(),
                last_error: null,
              });
            }
          }
        } else if (existing.asaas_checkout_id) {
          raw = await asaasFetch(`/checkouts/${existing.asaas_checkout_id}`);
          const providerStatus = String(raw?.status || "").toUpperCase();
          const paid = ["PAID", "CONFIRMED", "COMPLETED"].includes(providerStatus);
          const eventAt = new Date().toISOString();
          const safeRaw = sanitizeAsaasResponse(raw);
          const transition = await persistProviderTransition({
            supabase,
            table: "asaas_subscriptions",
            rowId: existing.id,
            current: existing,
            incomingEventAt: eventAt,
            reduce: (currentStatus, currentEventAt, incomingEventAt) =>
              paid
                ? reduceSubscriptionStatus(
                    currentStatus as string,
                    "active",
                    currentEventAt,
                    incomingEventAt,
                  )
                : String(currentStatus || "pending"),
            buildPatch: ({ current, nextStatus, staleEvent }) => {
              const incomingAccepted = !staleEvent && (!paid || nextStatus === "active");
              return {
                card_registration_status:
                  incomingAccepted && nextStatus === "active"
                    ? "registered"
                    : current.card_registration_status,
                raw_response: incomingAccepted
                  ? { ...(current.raw_response || {}), lastCheckoutRefresh: safeRaw }
                  : current.raw_response,
              };
            },
          });
          existing = transition.row;
        }
      }
      if (action === "resend_email" || action === "resend_whatsapp") {
        const invoice =
          existing.initial_invoice ||
          (
            await supabase
              .from("faturas_inquilino")
              .select("*")
              .eq("id", existing.initial_invoice_id)
              .maybeSingle()
          ).data;
        if (invoice) {
          await sendInvoiceNotifications(supabase, {
            invoice,
            recipient,
            paymentMethod: "credit_card",
            amount: Number(
              existing.mode === "checkout" ? existing.monthly_amount : existing.initial_amount,
            ),
            dueDate: existing.mode === "checkout" ? existing.next_due_date : invoice.vencimento,
            paymentUrl: existing.mode === "checkout" ? existing.checkout_url : invoice.payment_url,
            contractRef: String(proposalId).slice(0, 8).toUpperCase(),
            forceChannel: action === "resend_email" ? "email" : "whatsapp",
            cardRegistration: existing.mode === "checkout",
            notificationType:
              existing.mode === "checkout" ? "card_registration_requested" : "payment_created",
          });
        }
      }
      return jsonResponse(req, await subscriptionResponse(supabase, existing, recipient));
    }

    const resumableExisting =
      existing &&
      ["pending", "error"].includes(existing.status) &&
      !existing.asaas_subscription_id &&
      !existing.asaas_checkout_id;
    if (existing && !resumableExisting) {
      const contractMonths = strictContractPeriodMonths(consulta);
      assertStoredContractPeriod(existing, contractMonths);
      await acquireContractPeriodLock(supabase, proposalId, contractMonths);
      queuePendingContractFlow(supabase, proposalId);
      return jsonResponse(req, await subscriptionResponse(supabase, existing, recipient));
    }

    const expectedInitial = calculateExpectedPayment(consulta, fireMode);
    const expectedMonthly = calculateMonthlyInstallmentValue(consulta, fireMode);
    if (
      Math.abs(toMoney(body.amount ?? expectedInitial) - expectedInitial) > 0.02 ||
      Math.abs(toMoney(body.monthlyAmount ?? expectedMonthly) - expectedMonthly) > 0.02
    ) {
      return jsonResponse(
        req,
        {
          ok: false,
          error: "Os valores do contrato mudaram. Atualize a pagina e tente novamente.",
          expectedInitialAmount: expectedInitial,
          expectedMonthlyAmount: expectedMonthly,
        },
        409,
      );
    }
    const contractMonths = strictContractPeriodMonths(consulta);
    if (existing) assertStoredContractPeriod(existing, contractMonths);
    if (contractMonths < 2) {
      return jsonResponse(
        req,
        {
          ok: false,
          error: "Este contrato tem apenas uma competencia. Use o pagamento avulso no cartao.",
        },
        409,
      );
    }
    // Cada criacao/tentativa direta exige que o navegador envie novamente os
    // dados do cartao; PAN/CVV nunca sao recuperados de banco, log ou resposta.
    const directSensitive = mode === "direct" ? directCardPayload(body, req) : null;
    const dueDay = await resolveBillingDueDay(supabaseAdmin());
    const computedRecurrenceStart = addCalendarMonths(todayDate(), 1, dueDay);
    const recurrenceStartDate = existing?.recurrence_start_date || computedRecurrenceStart;
    const recurrenceEndDate =
      existing?.recurrence_end_date ||
      addCalendarMonths(computedRecurrenceStart, Math.max(contractMonths - 2, 0), dueDay);
    const recurrencePlan = anchoredRecurrencePlan({
      originalStartDate: recurrenceStartDate,
      originalEndDate: recurrenceEndDate,
      today: todayDate(),
      dueDay,
    });
    if (!recurrencePlan.nextDueDate || recurrencePlan.remainingPayments < 1) {
      return jsonResponse(
        req,
        {
          ok: false,
          error:
            "O prazo original do contrato terminou; nao ha competencias recorrentes restantes.",
        },
        409,
      );
    }
    await acquireContractPeriodLock(supabase, proposalId, contractMonths);

    const customerId = await ensureAsaasCustomer(supabase, consulta, recipient);
    const nextDueDate = recurrencePlan.nextDueDate;
    const subscriptionKey = buildBillingKey(proposalId, "subscription", mode);
    const { operation, claimed } = await claimBillingOperation(supabase, {
      consultationId: proposalId,
      operationType: mode === "direct" ? "subscription" : "checkout",
      idempotencyKey: subscriptionKey,
      request: {
        proposalId,
        mode,
        fireMode,
        initialAmount: expectedInitial,
        monthlyAmount: expectedMonthly,
        recurrenceStartDate,
        recurrenceEndDate,
        recurrenceTotalPayments: contractMonths - 1,
      },
      userId: user.id,
    });
    let canProceed = claimed;
    let recoveredSubscriptionRaw: any = null;
    if (
      !canProceed &&
      mode === "direct" &&
      ["reserved", "provider_created", "ambiguous", "persisted"].includes(operation.state)
    ) {
      recoveredSubscriptionRaw = await recoverSubscriptionForOperation(operation, subscriptionKey);
      if (recoveredSubscriptionRaw?.id) {
        canProceed = true;
        await updateBillingOperation(supabase, operation.id, {
          state: "provider_created",
          provider_id: recoveredSubscriptionRaw.id,
          provider_response: sanitizeAsaasResponse(recoveredSubscriptionRaw),
          attempts: Number(operation.attempts || 0) + 1,
          last_error: null,
        });
      } else {
        // A listagem oficial por externalReference confirmou a ausencia da
        // assinatura. Somente uma reserva antiga pode ser retomada via CAS.
        canProceed = !!(await reclaimStaleBillingOperation(supabase, operation));
      }
    }
    if (
      !canProceed &&
      mode === "direct" &&
      existing?.initial_invoice_id &&
      !existing.asaas_subscription_id &&
      !operation.provider_id &&
      ["provider_created", "ambiguous"].includes(operation.state)
    ) {
      const { data: confirmedInitial } = await supabase
        .from("faturas_inquilino")
        .select("status")
        .eq("id", existing.initial_invoice_id)
        .maybeSingle();
      if (["confirmed", "paid"].includes(normalizePaymentStatus(confirmedInitial?.status))) {
        const { data: resumed, error: resumeError } = await supabase
          .from("billing_operations")
          .update({
            state: "reserved",
            attempts: Number(operation.attempts || 0) + 1,
            last_error: null,
            locked_at: new Date().toISOString(),
          })
          .eq("id", operation.id)
          .in("state", ["provider_created", "ambiguous"])
          .is("provider_id", null)
          .select("id")
          .maybeSingle();
        if (resumeError) throw resumeError;
        canProceed = !!resumed;
      }
    }
    if (!canProceed && mode === "checkout") {
      const saved = operation.provider_response || existing?.raw_response || {};
      const initialCheckout = saved?.initialCheckout || null;
      const recurrentCheckout = saved?.recurrentCheckout || null;
      if (initialCheckout?.id || recurrentCheckout?.id) {
        canProceed = true;
      }
    }
    // No Checkout hospedado a primeira operacao pode ter sido criada e a
    // segunda recusada de forma deterministica. Nesse caso retomamos somente
    // a etapa ausente; o id ja salvo impede recriar o Checkout inicial.
    if (
      !canProceed &&
      existing?.status === "error" &&
      mode === "checkout" &&
      existing.raw_response?.initialCheckout?.id &&
      ["failed", "ambiguous"].includes(operation.state)
    ) {
      const { data: resumed, error: resumeError } = await supabase
        .from("billing_operations")
        .update({
          state: "reserved",
          attempts: Number(operation.attempts || 0) + 1,
          last_error: null,
          locked_at: new Date().toISOString(),
        })
        .eq("id", operation.id)
        .eq("state", "failed")
        .select("id")
        .maybeSingle();
      if (resumeError) throw resumeError;
      canProceed = !!resumed;
    }
    if (!canProceed) {
      existing = await loadSubscription(supabase, proposalId);
      if (existing && existing.status !== "error") {
        return jsonResponse(req, await subscriptionResponse(supabase, existing, recipient));
      }
      return jsonResponse(
        req,
        {
          ok: false,
          error:
            "A assinatura ja esta sendo criada ou conciliada. Consulte o status antes de tentar novamente.",
          operationState: operation.state,
        },
        409,
      );
    }

    let localSubscription = existing;
    if (!localSubscription) {
      const { data, error: localError } = await supabase
        .from("asaas_subscriptions")
        .insert({
          consultation_id: proposalId,
          created_by: user.id,
          tenant_user_id: consulta.tenant_user_id,
          payment_responsible: recipient.paymentResponsible,
          recipient_type: recipient.recipientType,
          recipient_user_id: recipient.recipientUserId,
          recipient_tenant_id: recipient.recipientTenantId,
          recipient_name: recipient.recipientName,
          recipient_email: recipient.recipientEmail,
          recipient_phone: recipient.recipientPhone,
          mode,
          status: "pending",
          card_registration_status: mode === "direct" ? "not_required" : "awaiting_card",
          payment_status: "pending",
          asaas_customer_id: customerId,
          external_reference: subscriptionKey,
          idempotency_key: subscriptionKey,
          initial_amount: expectedInitial,
          monthly_amount: expectedMonthly,
          next_due_date: nextDueDate,
          recurrence_start_date: recurrenceStartDate,
          recurrence_end_date: recurrenceEndDate,
          recurrence_total_payments: contractMonths - 1,
          fire_insurance_payment_mode: fireMode,
          split_initial_payment: mode === "checkout",
        })
        .select("*")
        .maybeSingle();
      if (localError || !data) throw localError || new Error("subscription_reservation_failed");
      localSubscription = data;
    } else {
      const { data, error } = await supabase
        .from("asaas_subscriptions")
        .update({
          status: "pending",
          card_registration_status: mode === "direct" ? "not_required" : "awaiting_card",
        })
        .eq("id", localSubscription.id)
        .select("*")
        .maybeSingle();
      if (error || !data) throw error || new Error("subscription_resume_failed");
      localSubscription = data;
    }

    let invoice: any = null;
    let subscriptionRaw: any = null;
    if (mode === "direct") {
      const initialKey = buildBillingKey(proposalId, "initial", 1);
      const { operation: initialOperation, claimed: initialClaimed } = await claimBillingOperation(
        supabase,
        {
          consultationId: proposalId,
          operationType: "payment",
          idempotencyKey: initialKey,
          request: {
            proposalId,
            method: "credit_card",
            amount: expectedInitial,
            fireMode,
          },
          userId: user.id,
        },
      );
      const { data: existingInitial } = await supabase
        .from("faturas_inquilino")
        .select("*, asaas_payment:asaas_payments(*)")
        .eq("billing_key", initialKey)
        .maybeSingle();
      let initialRaw: any = null;
      let payment: any = existingInitial?.asaas_payment || null;
      if (existingInitial) {
        invoice = existingInitial;
        if (payment?.asaas_payment_id) {
          initialRaw = await asaasFetch(`/payments/${payment.asaas_payment_id}`);
          const incomingStatus = normalizePaymentStatus(mapAsaasStatus(initialRaw?.status));
          const providerEventAt = new Date().toISOString();
          const safeInitialRaw = sanitizeAsaasResponse(initialRaw);
          const paymentTransition = await persistProviderTransition({
            supabase,
            table: "asaas_payments",
            rowId: payment.id,
            current: payment,
            incomingEventAt: providerEventAt,
            reduce: (currentStatus, currentEventAt, incomingEventAt) =>
              reducePaymentStatus(
                currentStatus as string,
                incomingStatus,
                currentEventAt,
                incomingEventAt,
              ),
            buildPatch: ({ current, nextStatus, staleEvent }) => ({
              raw_response:
                !staleEvent && normalizePaymentStatus(nextStatus) === incomingStatus
                  ? safeInitialRaw
                  : current.raw_response,
            }),
          });
          payment = paymentTransition.row;
          const refreshedStatus = normalizePaymentStatus(payment.status);
          const invoiceTransition = await persistProviderTransition({
            supabase,
            table: "faturas_inquilino",
            rowId: invoice.id,
            current: invoice,
            incomingEventAt: providerEventAt,
            reduce: (currentStatus, currentEventAt, incomingEventAt) =>
              reducePaymentStatus(
                currentStatus as string,
                refreshedStatus,
                currentEventAt,
                incomingEventAt,
              ),
            buildPatch: () => ({}),
          });
          invoice = { ...invoiceTransition.row, asaas_payment: payment };

          // Uma recusa conhecida admite outra tentativa no MESMO recurso.
          // O endpoint oficial payWithCreditCard nao cria nova cobranca; cada
          // tentativa recebe reserva propria e sempre exige PAN/CVV novos.
          if (refreshedStatus === "refused") {
            const retryKey = `${initialKey}:card-retry:${providerEventAt}`;
            const { operation: retryOperation, claimed: retryClaimed } =
              await claimBillingOperation(supabase, {
                consultationId: proposalId,
                invoiceId: invoice.id,
                operationType: "payment",
                idempotencyKey: retryKey,
                request: {
                  proposalId,
                  providerPaymentId: payment.asaas_payment_id,
                  purpose: "retry_refused_card",
                },
                userId: user.id,
              });
            if (!retryClaimed) {
              return jsonResponse(
                req,
                {
                  ok: false,
                  success: false,
                  error:
                    "A nova tentativa do cartao esta em conciliacao. Atualize o status antes de repetir.",
                  paymentStatus: normalizePaymentStatus(invoice.status),
                  operationState: retryOperation.state,
                  retryable: true,
                },
                409,
              );
            }
            try {
              initialRaw = await asaasFetch(
                `/payments/${payment.asaas_payment_id}/payWithCreditCard`,
                {
                  method: "POST",
                  body: JSON.stringify(directSensitive),
                },
              );
              await updateBillingOperation(supabase, retryOperation.id, {
                state: "provider_created",
                provider_response: sanitizeAsaasResponse(initialRaw),
              });
            } catch (error) {
              const deterministic = error instanceof AsaasApiError && error.status < 500;
              await Promise.all([
                updateBillingOperation(supabase, retryOperation.id, {
                  state: deterministic ? "failed" : "ambiguous",
                  provider_id: deterministic ? null : payment.asaas_payment_id,
                  last_error: error instanceof Error ? error.message : String(error),
                }),
                updateBillingOperation(supabase, operation.id, {
                  state: deterministic ? "failed" : "ambiguous",
                  last_error: error instanceof Error ? error.message : String(error),
                }),
                supabase
                  .from("asaas_subscriptions")
                  .update({
                    status: deterministic ? "error" : "pending",
                    card_registration_status: "not_required",
                    payment_status: "refused",
                  })
                  .eq("id", localSubscription.id),
              ]);
              throw error;
            }
            const incomingRetryStatus = normalizePaymentStatus(mapAsaasStatus(initialRaw?.status));
            const retryEventAt = new Date().toISOString();
            const safeRetry = sanitizeAsaasResponse(initialRaw);
            let retriedPayment: any;
            try {
              const retryPaymentTransition = await persistProviderTransition({
                supabase,
                table: "asaas_payments",
                rowId: payment.id,
                current: payment,
                incomingEventAt: retryEventAt,
                reduce: (currentStatus, currentEventAt, incomingEventAt) =>
                  reduceCardRetryStatus(
                    currentStatus,
                    incomingRetryStatus,
                    currentEventAt,
                    incomingEventAt,
                  ),
                buildPatch: ({ current, nextStatus, staleEvent }) => ({
                  raw_response:
                    !staleEvent && normalizePaymentStatus(nextStatus) === incomingRetryStatus
                      ? safeRetry
                      : current.raw_response,
                }),
              });
              retriedPayment = retryPaymentTransition.row;
            } catch (retryPaymentError) {
              await updateBillingOperation(supabase, retryOperation.id, {
                state: "provider_created",
                provider_id: payment.asaas_payment_id,
                last_error:
                  retryPaymentError instanceof Error
                    ? retryPaymentError.message
                    : "card_retry_persist_failed",
              });
              throw retryPaymentError || new Error("card_retry_persist_failed");
            }
            payment = retriedPayment;
            const retryStatus = normalizePaymentStatus(payment.status);
            const retryInvoiceTransition = await persistProviderTransition({
              supabase,
              table: "faturas_inquilino",
              rowId: invoice.id,
              current: invoice,
              incomingEventAt: retryEventAt,
              reduce: (currentStatus, currentEventAt, incomingEventAt) =>
                reduceCardRetryStatus(currentStatus, retryStatus, currentEventAt, incomingEventAt),
              buildPatch: () => ({}),
            });
            invoice = { ...retryInvoiceTransition.row, asaas_payment: payment };
            await updateBillingOperation(supabase, retryOperation.id, {
              state: normalizePaymentStatus(retryStatus) === "refused" ? "failed" : "persisted",
              provider_id:
                normalizePaymentStatus(retryStatus) === "refused" ? null : payment.asaas_payment_id,
              invoice_id: invoice.id,
              completed_at: new Date().toISOString(),
              last_error: normalizePaymentStatus(retryStatus) === "refused" ? "card_refused" : null,
            });
          }
        }
      } else {
        let canCreateInitial = initialClaimed;
        if (!initialClaimed) {
          initialRaw = await recoverPaymentForOperation(initialOperation, initialKey);
          const reclaimedInitial = !initialRaw?.id
            ? await reclaimStaleBillingOperation(supabase, initialOperation)
            : null;
          canCreateInitial = !!reclaimedInitial;
          if (!initialRaw?.id && !reclaimedInitial) {
            throw new HttpError(
              409,
              "A cobranca inicial esta em conciliacao no Asaas. Nenhuma cobranca nova foi emitida.",
            );
          }
          if (initialRaw?.id) {
            await updateBillingOperation(supabase, initialOperation.id, {
              state: "provider_created",
              provider_id: initialRaw.id,
              provider_response: sanitizeAsaasResponse(initialRaw),
              attempts: Number(initialOperation.attempts || 0) + 1,
              last_error: null,
            });
          }
        }
        if (!initialRaw && canCreateInitial) {
          try {
            initialRaw = await asaasFetch("/payments", {
              method: "POST",
              body: JSON.stringify({
                customer: customerId,
                billingType: "CREDIT_CARD",
                value: expectedInitial,
                dueDate: todayDate(),
                description: `NOX Fianca - pagamento inicial ${String(proposalId).slice(0, 8)}`,
                externalReference: initialKey,
                ...(directSensitive || {}),
              }),
            });
            await updateBillingOperation(supabase, initialOperation.id, {
              state: "provider_created",
              provider_id: initialRaw?.id || null,
              provider_response: sanitizeAsaasResponse(initialRaw),
            });
          } catch (error) {
            const operationState =
              error instanceof AsaasApiError && error.status < 500 ? "failed" : "ambiguous";
            await Promise.all([
              updateBillingOperation(supabase, initialOperation.id, {
                state: operationState,
                last_error: error instanceof Error ? error.message : String(error),
              }),
              supabase
                .from("asaas_subscriptions")
                .update({
                  status: operationState === "failed" ? "error" : "pending",
                  card_registration_status: "not_required",
                })
                .eq("id", localSubscription.id),
              updateBillingOperation(supabase, operation.id, {
                state: operationState,
                last_error: error instanceof Error ? error.message : String(error),
              }),
            ]);
            throw error;
          }
        }

        const initialStatus = mapAsaasStatus(initialRaw?.status);
        const providerEventAt =
          initialRaw?.lastUpdated || initialRaw?.dateCreated || new Date().toISOString();
        const { data: persistedPayment, error: paymentError } = await supabase
          .from("asaas_payments")
          .upsert(
            {
              consultation_id: proposalId,
              proposal_id: proposalId,
              plan_id: consulta.plano_id,
              user_id: user.id,
              tenant_user_id: consulta.tenant_user_id,
              asaas_customer_id: customerId,
              asaas_payment_id: initialRaw?.id || null,
              external_reference: initialKey,
              idempotency_key: initialKey,
              billing_operation_id: initialOperation.id,
              charge_kind: "initial",
              payment_method: "credit_card",
              value: expectedInitial,
              status: initialStatus,
              due_date: todayDate(),
              raw_response: sanitizeAsaasResponse(initialRaw),
              provider_event_at: providerEventAt,
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
        if (paymentError || !persistedPayment) {
          await updateBillingOperation(supabase, initialOperation.id, {
            state: "provider_created",
            provider_id: initialRaw?.id || null,
            last_error: paymentError?.message || "initial_payment_persist_failed",
          });
          throw paymentError || new Error("initial_payment_persist_failed");
        }
        payment = persistedPayment;
        invoice = await materializeInvoice(supabase, {
          consultation: consulta,
          recipient,
          billingKey: initialKey,
          installmentNumber: 1,
          installmentTotal: contractMonths,
          dueDate: todayDate(),
          value: expectedInitial,
          status: initialStatus,
          chargeKind: "initial",
          paymentMethod: "credit_card",
          components: {
            fireMode,
            initialAmount: expectedInitial,
            monthlyAmount: expectedMonthly,
            includesFirstMonthlyPayment: true,
            contractMonths,
          },
          paymentUrl: initialRaw?.invoiceUrl || null,
          localPaymentId: payment.id,
        });
        await updateBillingOperation(supabase, initialOperation.id, {
          invoice_id: invoice.id,
          state: "persisted",
          completed_at: new Date().toISOString(),
          last_error: null,
        });
      }

      const { data: withInitial, error: initialLinkError } = await supabase
        .from("asaas_subscriptions")
        .update({
          initial_invoice_id: invoice.id,
          payment_status: invoice.status,
        })
        .eq("id", localSubscription.id)
        .select("*")
        .maybeSingle();
      if (initialLinkError || !withInitial) {
        throw initialLinkError || new Error("subscription_initial_link_failed");
      }
      localSubscription = withInitial;

      const initialPaymentState = normalizePaymentStatus(invoice.status);
      if (!["confirmed", "paid"].includes(initialPaymentState)) {
        const refused = initialPaymentState === "refused";
        await Promise.all([
          supabase
            .from("asaas_subscriptions")
            .update({
              status: refused ? "error" : "pending",
              card_registration_status: "not_required",
              payment_status: initialPaymentState,
            })
            .eq("id", localSubscription.id),
          updateBillingOperation(supabase, operation.id, {
            state: refused ? "failed" : "provider_created",
            last_error: refused ? "initial_card_refused" : "initial_payment_pending",
          }),
        ]);
        const waiting = await loadSubscription(supabase, proposalId);
        const response = await subscriptionResponse(supabase, waiting, recipient);
        return jsonResponse(
          req,
          {
            ...response,
            ok: false,
            success: false,
            paymentStatus: initialPaymentState,
            retryable: refused,
            requiresCardResubmission: true,
            recommendedMode: !refused ? "checkout" : undefined,
            error: refused
              ? "Cartao recusado. Revise os dados ou use outro cartao; nenhuma assinatura foi ativada."
              : "O pagamento inicial ainda aguarda confirmacao. A assinatura permanece pendente.",
          },
          refused ? 402 : 409,
        );
      }

      subscriptionRaw = recoveredSubscriptionRaw;
      if (!subscriptionRaw) {
        try {
          subscriptionRaw = await asaasFetch("/subscriptions", {
            method: "POST",
            body: JSON.stringify({
              customer: customerId,
              billingType: "CREDIT_CARD",
              value: expectedMonthly,
              nextDueDate,
              cycle: "MONTHLY",
              description: `NOX Fianca - mensalidade recorrente ${String(proposalId).slice(0, 8)}`,
              externalReference: subscriptionKey,
              maxPayments: recurrencePlan.remainingPayments,
              ...(directSensitive || {}),
            }),
          });
          // Checkpoint antes de qualquer persistencia derivada. Se a escrita
          // seguinte falhar, create/refresh recuperam por ID/externalReference.
          await updateBillingOperation(supabase, operation.id, {
            state: "provider_created",
            provider_id: subscriptionRaw?.id || null,
            provider_response: sanitizeAsaasResponse(subscriptionRaw),
          });
        } catch (error) {
          await supabase
            .from("asaas_subscriptions")
            .update({
              status: error instanceof AsaasApiError && error.status < 500 ? "error" : "pending",
              card_registration_status: "not_required",
              payment_status: invoice?.status || "pending",
            })
            .eq("id", localSubscription.id);
          await updateBillingOperation(supabase, operation.id, {
            state: error instanceof AsaasApiError && error.status < 500 ? "failed" : "ambiguous",
            last_error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      }
      const providerSubscriptionStatus = subscriptionStatusFromEvent(
        "SUBSCRIPTION_CREATED",
        subscriptionRaw?.status,
      );
      const { data: savedSubscription, error: saveSubscriptionError } = await supabase
        .from("asaas_subscriptions")
        .update({
          initial_invoice_id: invoice.id,
          asaas_subscription_id: subscriptionRaw?.id || null,
          status: providerSubscriptionStatus,
          card_registration_status: "not_required",
          payment_status: invoice.status,
          raw_response: sanitizeAsaasResponse(subscriptionRaw),
          activated_at:
            providerSubscriptionStatus === "active"
              ? localSubscription.activated_at || new Date().toISOString()
              : localSubscription.activated_at,
        })
        .eq("id", localSubscription.id)
        .select("*")
        .maybeSingle();
      if (saveSubscriptionError || !savedSubscription) {
        await updateBillingOperation(supabase, operation.id, {
          state: "provider_created",
          provider_id: subscriptionRaw?.id || null,
          provider_response: sanitizeAsaasResponse(subscriptionRaw),
          last_error: saveSubscriptionError?.message || "subscription_persist_failed",
        });
        throw saveSubscriptionError || new Error("subscription_persist_failed");
      }
      localSubscription = savedSubscription;
      await updateBillingOperation(supabase, operation.id, {
        state: "persisted",
        provider_id: subscriptionRaw?.id || null,
        provider_response: sanitizeAsaasResponse(subscriptionRaw),
        completed_at: new Date().toISOString(),
      });
    } else {
      // O Checkout recorrente nao representa a taxa/total inicial. Criamos
      // dois Checkouts oficiais e devolvemos o split explicitamente.
      const frontend = (Deno.env.get("FRONTEND_URL") || "https://noxfianca.com").replace(/\/$/, "");
      const callback = {
        successUrl: `${frontend}/consultas/${proposalId}/finalizar?checkout=success`,
        cancelUrl: `${frontend}/consultas/${proposalId}/finalizar?checkout=cancelled`,
        expiredUrl: `${frontend}/consultas/${proposalId}/finalizar?checkout=expired`,
      };
      const checkoutNextDueDate = `${nextDueDate} 12:00:00`;
      const checkoutEndDate = `${recurrencePlan.endDate} 23:59:59`;
      const initialCheckoutKey = buildBillingKey(proposalId, "checkout", "initial");
      const recurrentCheckoutKey = buildBillingKey(proposalId, "checkout", "recurring");
      const initialPayload = {
        billingTypes: ["CREDIT_CARD"],
        chargeTypes: ["DETACHED"],
        minutesToExpire: 1440,
        customer: customerId,
        callback,
        externalReference: initialCheckoutKey,
        items: [
          {
            name: "NOX Fianca - valor inicial",
            description: "Taxa de ativacao e primeira mensalidade",
            quantity: 1,
            value: expectedInitial,
          },
        ],
      };
      const recurrentPayload = {
        billingTypes: ["CREDIT_CARD"],
        chargeTypes: ["RECURRENT"],
        minutesToExpire: 1440,
        customer: customerId,
        callback,
        externalReference: recurrentCheckoutKey,
        items: [
          {
            name: "NOX Fianca - mensalidade",
            description: "Autorizacao de cobranca mensal recorrente",
            quantity: 1,
            value: expectedMonthly,
          },
        ],
        subscription: {
          cycle: "MONTHLY",
          nextDueDate: checkoutNextDueDate,
          endDate: checkoutEndDate,
        },
      };
      let initialCheckout: any =
        localSubscription.raw_response?.initialCheckout ||
        operation.provider_response?.initialCheckout ||
        null;
      let recurrentCheckout: any =
        localSubscription.raw_response?.recurrentCheckout ||
        operation.provider_response?.recurrentCheckout ||
        null;
      try {
        const { operation: initialCheckoutOperation, claimed: initialCheckoutClaimed } =
          await claimBillingOperation(supabase, {
            consultationId: proposalId,
            operationType: "checkout",
            idempotencyKey: initialCheckoutKey,
            request: initialPayload,
            userId: user.id,
          });
        initialCheckout = await recoverCheckoutForOperation(
          initialCheckoutOperation,
          initialCheckout,
          localSubscription.asaas_initial_checkout_id,
        );
        if (!initialCheckout && !initialCheckoutClaimed) {
          return jsonResponse(
            req,
            {
              ok: false,
              success: false,
              error: "O Checkout inicial esta em conciliacao. Nenhum novo Checkout foi criado.",
              operationState: initialCheckoutOperation.state,
              retryable: true,
            },
            409,
          );
        }
        if (!initialCheckout) {
          try {
            initialCheckout = await asaasFetch("/checkouts", {
              method: "POST",
              body: JSON.stringify(initialPayload),
            });
          } catch (error) {
            await updateBillingOperation(supabase, initialCheckoutOperation.id, {
              state: error instanceof AsaasApiError && error.status < 500 ? "failed" : "ambiguous",
              last_error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
          await updateBillingOperation(supabase, initialCheckoutOperation.id, {
            state: "provider_created",
            provider_id: initialCheckout?.id || null,
            provider_response: sanitizeAsaasResponse(initialCheckout),
          });
        }
        const safeInitial = sanitizeAsaasResponse(initialCheckout);
        const safeInitialUrl = checkoutUrl(initialCheckout);
        const { data: initialCheckpoint, error: initialCheckpointError } = await supabase
          .from("asaas_subscriptions")
          .update({
            asaas_initial_checkout_id: initialCheckout?.id || null,
            initial_checkout_url: safeInitialUrl,
            raw_response: {
              ...(localSubscription.raw_response || {}),
              initialCheckout: safeInitial,
            },
          })
          .eq("id", localSubscription.id)
          .select("*")
          .maybeSingle();
        if (initialCheckpointError || !initialCheckpoint) {
          throw initialCheckpointError || new Error("initial_checkout_persist_failed");
        }
        localSubscription = initialCheckpoint;
        await updateBillingOperation(supabase, initialCheckoutOperation.id, {
          state: "persisted",
          provider_id: initialCheckout?.id || null,
          provider_response: safeInitial,
          completed_at: new Date().toISOString(),
          last_error: null,
        });
        await updateBillingOperation(supabase, operation.id, {
          state: "provider_created",
          provider_id: initialCheckout?.id || null,
          provider_response: {
            ...(operation.provider_response || {}),
            initialCheckout: safeInitial,
          },
        });

        const initialUrl = checkoutUrl(initialCheckout);
        if (localSubscription.initial_invoice_id) {
          invoice = (
            await supabase
              .from("faturas_inquilino")
              .select("*")
              .eq("id", localSubscription.initial_invoice_id)
              .maybeSingle()
          ).data;
        }
        if (!invoice) {
          invoice = await materializeInvoice(supabase, {
            consultation: consulta,
            recipient,
            billingKey: buildBillingKey(proposalId, "initial", 1),
            installmentNumber: 1,
            installmentTotal: contractMonths,
            dueDate: todayDate(),
            value: expectedInitial,
            status: "pending",
            chargeKind: "initial",
            paymentMethod: "credit_card",
            components: {
              fireMode,
              initialAmount: expectedInitial,
              monthlyAmount: expectedMonthly,
              includesFirstMonthlyPayment: true,
              contractMonths,
              checkoutSplit: true,
            },
            paymentUrl: initialUrl,
          });
          const { data: invoiceCheckpoint, error: invoiceCheckpointError } = await supabase
            .from("asaas_subscriptions")
            .update({
              initial_invoice_id: invoice.id,
              payment_status: invoice.status,
            })
            .eq("id", localSubscription.id)
            .select("*")
            .maybeSingle();
          if (invoiceCheckpointError || !invoiceCheckpoint) {
            throw invoiceCheckpointError || new Error("checkout_invoice_persist_failed");
          }
          localSubscription = invoiceCheckpoint;
        }

        const { operation: recurrentCheckoutOperation, claimed: recurrentCheckoutClaimed } =
          await claimBillingOperation(supabase, {
            consultationId: proposalId,
            invoiceId: invoice.id,
            operationType: "checkout",
            idempotencyKey: recurrentCheckoutKey,
            request: recurrentPayload,
            userId: user.id,
          });
        recurrentCheckout = await recoverCheckoutForOperation(
          recurrentCheckoutOperation,
          recurrentCheckout,
          localSubscription.asaas_checkout_id,
        );
        if (!recurrentCheckout && !recurrentCheckoutClaimed) {
          return jsonResponse(
            req,
            {
              ok: false,
              success: false,
              error: "O Checkout recorrente esta em conciliacao. Nenhum novo Checkout foi criado.",
              operationState: recurrentCheckoutOperation.state,
              retryable: true,
              initialPaymentUrl: initialUrl,
            },
            409,
          );
        }
        if (!recurrentCheckout) {
          try {
            recurrentCheckout = await asaasFetch("/checkouts", {
              method: "POST",
              body: JSON.stringify(recurrentPayload),
            });
          } catch (error) {
            await updateBillingOperation(supabase, recurrentCheckoutOperation.id, {
              state: error instanceof AsaasApiError && error.status < 500 ? "failed" : "ambiguous",
              last_error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
          await updateBillingOperation(supabase, recurrentCheckoutOperation.id, {
            state: "provider_created",
            provider_id: recurrentCheckout?.id || null,
            provider_response: sanitizeAsaasResponse(recurrentCheckout),
          });
        }
        await updateBillingOperation(supabase, recurrentCheckoutOperation.id, {
          invoice_id: invoice.id,
          state: "persisted",
          provider_id: recurrentCheckout?.id || null,
          provider_response: sanitizeAsaasResponse(recurrentCheckout),
          completed_at: new Date().toISOString(),
          last_error: null,
        });
      } catch (error) {
        const deterministic = error instanceof AsaasApiError && error.status < 500;
        await supabase
          .from("asaas_subscriptions")
          .update({
            status: deterministic ? "error" : "pending",
          })
          .eq("id", localSubscription.id);
        await updateBillingOperation(supabase, operation.id, {
          state: deterministic ? "failed" : "ambiguous",
          provider_id: recurrentCheckout?.id || initialCheckout?.id || null,
          last_error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      const recurrentUrl = checkoutUrl(recurrentCheckout);
      subscriptionRaw = {
        initialCheckout: sanitizeAsaasResponse(initialCheckout),
        recurrentCheckout: sanitizeAsaasResponse(recurrentCheckout),
      };
      const { data: savedCheckout, error: saveCheckoutError } = await supabase
        .from("asaas_subscriptions")
        .update({
          initial_invoice_id: invoice.id,
          asaas_initial_checkout_id: initialCheckout?.id || null,
          asaas_checkout_id: recurrentCheckout?.id || null,
          initial_checkout_url: checkoutUrl(initialCheckout),
          checkout_url: recurrentUrl,
          status: "pending",
          card_registration_status: "awaiting_card",
          payment_status: "pending",
          raw_response: subscriptionRaw,
        })
        .eq("id", localSubscription.id)
        .select("*")
        .maybeSingle();
      if (saveCheckoutError || !savedCheckout) {
        await updateBillingOperation(supabase, operation.id, {
          state: "provider_created",
          provider_id: recurrentCheckout?.id || initialCheckout?.id || null,
          provider_response: subscriptionRaw,
          last_error: saveCheckoutError?.message || "checkout_persist_failed",
        });
        throw saveCheckoutError || new Error("checkout_persist_failed");
      }
      localSubscription = savedCheckout;
      await updateBillingOperation(supabase, operation.id, {
        invoice_id: invoice.id,
        state: "persisted",
        provider_id: recurrentCheckout?.id || null,
        provider_response: subscriptionRaw,
        completed_at: new Date().toISOString(),
      });
    }

    const { data: currentConsultation, error: currentConsultationError } = await supabase
      .from("consultas_credito")
      .select("*")
      .eq("id", proposalId)
      .maybeSingle();
    if (currentConsultationError || !currentConsultation) {
      throw currentConsultationError || new Error("consultation_not_found");
    }
    const incomingPaymentStatus = normalizePaymentStatus(invoice.status);
    await persistProviderTransition({
      supabase,
      table: "consultas_credito",
      rowId: proposalId,
      current: currentConsultation,
      incomingEventAt: new Date().toISOString(),
      statusColumn: "payment_state",
      eventAtColumn: "payment_provider_event_at",
      reduce: (currentStatus, currentEventAt, incomingEventAt) =>
        reducePaymentStatus(
          currentStatus as string,
          incomingPaymentStatus,
          currentEventAt,
          incomingEventAt,
        ),
      buildPatch: ({ current, nextStatus }) => ({
        payment_method: "credit_card",
        payment_status: nextStatus,
        payment_value: expectedInitial,
        payment_due_date: invoice.vencimento,
        fire_insurance_payment_mode: fireMode,
        card_setup_mode: mode,
        policy_status: ["active", "cancelled"].includes(current.policy_status)
          ? current.policy_status
          : "issued_pending",
      }),
    });
    try {
      await ensurePendingPolicy(supabase, proposalId);
    } catch (error) {
      console.error("[asaas-create-subscription] apolice pendente sera retomada", {
        proposalId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    const updated = await loadSubscription(supabase, proposalId);
    if (!updated) throw new Error("subscription_persist_failed");
    if (updated && invoice) {
      const notificationPlan = buildSubscriptionNotificationPlan({
        mode,
        initialAmount: expectedInitial,
        monthlyAmount: expectedMonthly,
        initialDueDate: invoice.vencimento,
        nextDueDate,
        initialPaymentUrl: invoice.payment_url,
        recurringCheckoutUrl: updated.checkout_url,
      });
      for (const notification of notificationPlan) {
        await sendInvoiceNotifications(supabase, {
          invoice,
          recipient,
          paymentMethod: "credit_card",
          amount: notification.amount,
          dueDate: notification.dueDate,
          paymentUrl: notification.paymentUrl,
          contractRef: String(proposalId).slice(0, 8).toUpperCase(),
          cardRegistration: notification.cardRegistration,
          notificationType: notification.notificationType,
        });
      }
    }
    queuePendingContractFlow(supabase, proposalId);
    return jsonResponse(req, await subscriptionResponse(supabase, updated, recipient));
  } catch (error) {
    console.error("[asaas-create-subscription] erro", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(
      req,
      {
        ok: false,
        error: describePaymentError(error, "Nao foi possivel configurar o cartao recorrente."),
      },
      paymentErrorStatus(error, 500),
    );
  }
});
