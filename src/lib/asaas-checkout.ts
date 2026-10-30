import { supabase } from "@/integrations/supabase/client";
import {
  getEdgeFunctionErrorDetails,
  hasIncompleteInstallmentPlan,
  isInactivePaymentStatus,
  type AsaasPaymentMethod,
  type CardSetupMode,
  type CheckoutIntent,
  type NormalizedAsaasPayment,
  type NormalizedAsaasSubscription,
} from "@/lib/asaas-payment";

export class AsaasCheckoutError extends Error {
  status: number | null;
  payload: Record<string, unknown> | null;

  constructor(message: string, status: number | null, payload: Record<string, unknown> | null) {
    super(message);
    this.name = "AsaasCheckoutError";
    this.status = status;
    this.payload = payload;
  }
}

type CreditCardPayload = {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
};

type CreditCardHolderPayload = {
  name: string;
  email: string;
  cpfCnpj: string;
  postalCode: string;
  addressNumber: string;
  phone: string;
};

export type PaymentManagementAction =
  | "refresh"
  | "resend_email"
  | "resend_whatsapp"
  | "reissue";
export type SubscriptionAction =
  | "create"
  | "refresh"
  | "resend_email"
  | "resend_whatsapp"
  | "reissue_initial"
  | "reissue_checkout"
  | "cancel";

export type AsaasPaymentRequest = {
  proposalId: string;
  paymentMethod: AsaasPaymentMethod;
  selectedFireInsuranceMode: "avista" | "embutido";
  deferPayment: boolean;
  amount?: number;
  billingDueDay?: number;
  dueDate?: string;
  creditCard?: CreditCardPayload;
  creditCardHolderInfo?: CreditCardHolderPayload;
};

export type AsaasPaymentManagementRequest = {
  invoiceId?: string | null;
  paymentId?: string | null;
  consultationId?: string | null;
  action: PaymentManagementAction;
  paymentMethod?: "pix" | "boleto";
};

type ManagedPaymentEnvelope = {
  payment: Record<string, any>;
  invoice?: Record<string, any> | null;
  notifications?: NormalizedAsaasPayment["notifications"] | Array<Record<string, any>> | null;
  reused: true;
};

export type AsaasSubscriptionRequest = {
  proposalId: string;
  mode: CardSetupMode;
  selectedFireInsuranceMode: "avista" | "embutido";
  amount: number;
  monthlyAmount: number;
  billingDueDay?: number;
  creditCard?: CreditCardPayload;
  creditCardHolderInfo?: CreditCardHolderPayload;
  action?: SubscriptionAction;
};

export type CheckoutPreferences = {
  paymentMethod: AsaasPaymentMethod | "";
  fireMode: "a_vista" | "parcelado";
  cardMode: CardSetupMode | null;
  paymentOpen: boolean;
  billingDueDay?: number | null;
};

export type RehydratedCheckout = {
  payment: NormalizedAsaasPayment | null;
  subscription: NormalizedAsaasSubscription | null;
  installmentPlanPending: boolean;
};

async function invokeCheckoutFunction<T>(name: string, body: Record<string, unknown>, fallback: string) {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) {
    const details = await getEdgeFunctionErrorDetails(error, fallback);
    throw new AsaasCheckoutError(details.message, details.status, details.payload);
  }
  if ((data as { error?: unknown } | null)?.error) {
    throw new Error(String((data as { error: unknown }).error));
  }
  if (!data) throw new Error(fallback);
  return data;
}

export function createAsaasPayment(request: AsaasPaymentRequest) {
  return invokeCheckoutFunction<NormalizedAsaasPayment>(
    "asaas-create-payment",
    request,
    "Não foi possível gerar o pagamento agora. Tente novamente.",
  );
}

function notificationSummary(value: ManagedPaymentEnvelope["notifications"]) {
  if (!value || !Array.isArray(value)) return value || null;
  const latest = (channel: "email" | "whatsapp") =>
    [...value].reverse().find((item) => item.channel === channel);
  const normalize = (item: Record<string, any> | undefined) => ({
    status: (item?.status || "skipped") as "queued" | "sent" | "failed" | "skipped",
    sentAt: item?.sent_at || item?.sentAt || null,
    error: item?.last_error || item?.error || null,
  });
  return { email: normalize(latest("email")), whatsapp: normalize(latest("whatsapp")) };
}

export async function managePersistedAsaasPayment(request: AsaasPaymentManagementRequest) {
  const envelope = await invokeCheckoutFunction<ManagedPaymentEnvelope>(
    "asaas-manage-payment",
    request,
    request.action === "refresh"
      ? "Não foi possível atualizar a cobrança agora."
      : request.action === "reissue"
        ? "Não foi possível gerar a segunda via agora."
        : "Não foi possível reenviar a cobrança agora.",
  );
  const payment = envelope.payment || {};
  const invoice = envelope.invoice || null;
  if (payment.paymentMethod || payment.paymentId !== undefined) {
    return {
      ...(payment as NormalizedAsaasPayment),
      invoiceId: payment.invoiceId || invoice?.id || request.invoiceId || null,
      notifications: notificationSummary(envelope.notifications),
    } satisfies NormalizedAsaasPayment;
  }
  return {
    ...normalizePersistedPayment(payment, invoice),
    notifications: notificationSummary(envelope.notifications),
  };
}

export function manageAsaasSubscription(request: AsaasSubscriptionRequest) {
  return invokeCheckoutFunction<NormalizedAsaasSubscription>(
    "asaas-create-subscription",
    request,
    request.action === "refresh"
      ? "Não foi possível atualizar a assinatura agora."
      : request.action === "reissue_initial"
        ? "Não foi possível gerar um novo link para a cobrança inicial."
      : request.action === "reissue_checkout"
        ? "Não foi possível gerar um novo link para o cadastro recorrente."
      : request.action?.startsWith("resend_")
        ? "Não foi possível reenviar o link agora."
        : "Não foi possível preparar a cobrança recorrente agora.",
  );
}

export async function ensureFutureInstallments(params: {
  proposalId: string;
  paymentMethod: "pix" | "boleto";
  selectedFireInsuranceMode: "avista" | "embutido";
  billingDueDay: number;
}) {
  return invokeCheckoutFunction<Record<string, unknown>>(
    "asaas-create-installment-plan",
    params,
    "A cobrança inicial foi criada, mas não foi possível preparar as mensalidades futuras.",
  );
}

function normalizePersistedPayment(payment: any, invoice: any): NormalizedAsaasPayment {
  const method = (payment?.payment_method || invoice?.payment_method || "pix") as AsaasPaymentMethod;
  const raw = payment?.raw_response && typeof payment.raw_response === "object" ? payment.raw_response : {};
  return {
    success: true,
    paymentId: payment?.asaas_payment_id ?? null,
    localPaymentId: payment?.id ?? invoice?.asaas_payment_id ?? null,
    invoiceId: invoice?.id ?? null,
    externalReference: payment?.external_reference ?? null,
    status: payment?.status || invoice?.status || "pending",
    paymentStatus: payment?.status || invoice?.status || "pending",
    paymentMethod: method,
    amount: Number(payment?.value ?? invoice?.valor ?? 0),
    dueDate: payment?.due_date || invoice?.vencimento || null,
    invoiceUrl: invoice?.payment_url || payment?.invoice_url || payment?.boleto_url || null,
    deferPayment: Boolean(
      raw?.deferPayment ?? raw?.defer_payment ?? invoice?.components?.deferred,
    ),
    signatureStatus: "pending",
    policyStatus: "draft",
    selectedFireInsuranceMode:
      payment?.selected_fire_insurance_mode ||
      raw?.selectedFireInsuranceMode ||
      invoice?.components?.fireMode ||
      null,
    pix:
      method === "pix"
        ? {
            qrCode: payment?.pix_copy_paste || "",
            qrCodeBase64: payment?.pix_qr_code || "",
            expiresAt: payment?.pix_expires_at || null,
          }
        : null,
    boleto:
      method === "boleto"
        ? {
            barcode: payment?.boleto_barcode || invoice?.linha_digitavel || "",
            pdfUrl: payment?.boleto_url || invoice?.boleto_url || invoice?.payment_url || "",
            dueDate: payment?.due_date || invoice?.vencimento || null,
          }
        : null,
    recipient:
      payment?.payment_responsible || invoice?.payment_responsible
        ? {
            responsible: payment?.payment_responsible || invoice?.payment_responsible || null,
            type: payment?.recipient_type || invoice?.recipient_type || null,
            userId: payment?.recipient_user_id || invoice?.recipient_user_id || null,
            tenantId: payment?.recipient_tenant_id || invoice?.recipient_tenant_id || null,
            name: payment?.recipient_name || invoice?.recipient_name || null,
            emailMasked: payment?.recipient_email_masked || null,
            phoneMasked: payment?.recipient_phone_masked || null,
          }
        : null,
    notifications: notificationSummary(invoice?.notifications || null),
  };
}

function normalizePersistedSubscription(row: any): NormalizedAsaasSubscription {
  return {
    success: true,
    mode: row?.mode === "direct" ? "direct" : "checkout",
    localSubscriptionId: String(row?.id || ""),
    subscriptionId: row?.asaas_subscription_id || row?.subscription_id || null,
    checkoutId: row?.asaas_checkout_id || row?.checkout_id || null,
    checkoutUrl: row?.checkout_url || null,
    initialCheckoutStatus: row?.initial_checkout_status || "pending",
    checkoutStatus: row?.checkout_status || "pending",
    status: row?.status || "pending",
    cardRegistrationStatus: row?.card_registration_status || "awaiting_card",
    paymentStatus: row?.payment_status || "pending",
    initialAmount: Number(row?.initial_amount || 0),
    monthlyAmount: Number(row?.monthly_amount || 0),
    nextDueDate: row?.next_due_date || null,
    selectedFireInsuranceMode: row?.fire_insurance_payment_mode || null,
    initialPayment: null,
    split: {
      required: row?.split_initial_payment === true,
      reason: row?.split_initial_payment
        ? "O Checkout recorrente autoriza as mensalidades; a cobrança inicial é uma operação oficial separada."
        : undefined,
      initialPaymentUrl: row?.initial_checkout_url || null,
    },
    recipient: null,
    notifications: null,
  };
}

/**
 * Descobre progresso já persistido antes de pedir refresh ao provedor. Assim,
 * atualizar a página nunca dispara uma nova cobrança ou assinatura.
 */
export async function rehydrateAsaasCheckout(
  proposalId: string,
  preferences: CheckoutPreferences,
  options: { refreshProvider?: boolean } = {},
): Promise<RehydratedCheckout> {
  const client = supabase as any;
  const [paymentsResult, invoicesResult, subscriptionsResult] = await Promise.all([
    client
      .from("asaas_payments")
      .select("*")
      .eq("consultation_id", proposalId)
      .eq("charge_kind", "initial")
      .order("created_at", { ascending: false })
      .limit(1),
    client
      .from("faturas_inquilino")
      .select("*, notifications:financial_notifications(*)")
      .eq("consulta_id", proposalId)
      .order("created_at", { ascending: false })
      .limit(24),
    client
      .from("asaas_subscriptions")
      .select("*")
      .eq("consultation_id", proposalId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const rawPaymentRow = paymentsResult.data?.[0] ?? null;
  const subscriptionRow = subscriptionsResult.data?.[0] ?? null;
  const invoiceRows = invoicesResult.data ?? [];

  // Uma cobrança terminada (cancelada, estornada, recusada...) não pode voltar à
  // tela como "cobrança atual" — isso trava o seletor de vencimento e induz o
  // backend a devolvê-la de novo quando o usuário clica em "Pagar agora". Para a
  // reidratação, só consideramos faturas e pagamentos ativos.
  const activePaymentRow =
    rawPaymentRow && !isInactivePaymentStatus(rawPaymentRow.status) ? rawPaymentRow : null;
  const activeInvoiceRows = invoiceRows.filter(
    (row: any) => !isInactivePaymentStatus(row.status),
  );
  const initialInvoice =
    activeInvoiceRows.find(
      (row: any) =>
        row.charge_kind === "initial" || String(row.billing_key || "").includes(":initial:"),
    ) || null;
  const invoiceRow = activePaymentRow
    ? activeInvoiceRows.find((row: any) => row.asaas_payment_id === activePaymentRow.id) ||
      initialInvoice ||
      activeInvoiceRows[0] ||
      null
    : initialInvoice || activeInvoiceRows[0] || null;

  const installmentPlanPending = hasIncompleteInstallmentPlan(invoiceRows);

  const paymentRow = activePaymentRow;
  let payment = paymentRow || invoiceRow ? normalizePersistedPayment(paymentRow, invoiceRow) : null;
  let subscription = subscriptionRow ? normalizePersistedSubscription(subscriptionRow) : null;

  // A tela deve abrir usando o estado persistido. Consultar Asaas/D4Sign aqui
  // colocava rede externa no caminho crítico e repetia processamento a cada
  // troca de período ou dado. Os modais/polling fazem o refresh quando ele é
  // realmente necessário.
  if (options.refreshProvider && subscriptionRow) {
    try {
      subscription = await manageAsaasSubscription({
        proposalId,
        mode: subscription?.mode || preferences.cardMode || "checkout",
        selectedFireInsuranceMode:
          subscription?.selectedFireInsuranceMode ||
          (preferences.fireMode === "a_vista" ? "avista" : "embutido"),
        amount: subscription?.initialAmount || 0,
        monthlyAmount: subscription?.monthlyAmount || 0,
        action: "refresh",
      });
    } catch {
      // O snapshot local ainda permite retomar a tela quando o provedor falha.
    }
  } else if (options.refreshProvider && (paymentRow || invoiceRow)) {
    try {
      payment = await managePersistedAsaasPayment({
        consultationId: proposalId,
        invoiceId: payment?.invoiceId,
        paymentId: payment?.paymentId,
        action: "refresh",
      });
    } catch {
      // Não cria uma nova cobrança; conserva os dados persistidos para consulta.
    }
  }

  return { payment, subscription, installmentPlanPending };
}

export function readCheckoutPreferences(proposalId: string): CheckoutPreferences | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`nox:checkout:${proposalId}`);
    if (!raw) return null;
    return JSON.parse(raw) as CheckoutPreferences;
  } catch {
    return null;
  }
}

export function writeCheckoutPreferences(proposalId: string, value: CheckoutPreferences) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`nox:checkout:${proposalId}`, JSON.stringify(value));
}

export function checkoutIntentLabel(intent: CheckoutIntent) {
  return intent === "pay_later" ? "Pagar depois" : "Pagar agora";
}
