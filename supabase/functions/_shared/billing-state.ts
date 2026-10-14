export type CanonicalPaymentStatus =
  | "pending"
  | "awaiting_consolidation"
  | "processing"
  | "overdue"
  | "confirmed"
  | "paid"
  | "refused"
  | "cancelled"
  | "refunded"
  | "chargeback";

export type CanonicalSubscriptionStatus =
  "pending" | "active" | "suspended" | "cancelled" | "expired" | "error";

export type CanonicalCheckoutStatus = "pending" | "paid" | "cancelled" | "expired";

export type ContractSignatureWorkflowStatus =
  "pending" | "sent" | "signed" | "active" | "cancelled" | "error";

export function normalizeContractSignatureStatus(value: unknown): ContractSignatureWorkflowStatus {
  const status = String(value || "").toLowerCase();
  if (status === "active") return "active";
  if (status === "signed") return "signed";
  if (["cancelled", "canceled"].includes(status)) return "cancelled";
  if (["awaiting_signature", "sent"].includes(status)) return "sent";
  if (status === "error") return "error";
  return "pending";
}

export function reduceContractSignatureStatus(
  current: unknown,
  incoming: ContractSignatureWorkflowStatus,
  currentEventAt?: string | null,
  incomingEventAt?: string | null,
) {
  const normalized = normalizeContractSignatureStatus(current);
  const currentTime = timestamp(currentEventAt);
  const incomingTime = timestamp(incomingEventAt);
  if (currentTime !== null && incomingTime !== null && incomingTime < currentTime)
    return normalized;
  if (normalized === "active") return "active";
  if (normalized === "signed" && incoming !== "active") return "signed";
  if (normalized === "cancelled") return "cancelled";
  const rank: Record<ContractSignatureWorkflowStatus, number> = {
    pending: 10,
    error: 15,
    sent: 20,
    cancelled: 30,
    signed: 40,
    active: 50,
  };
  return rank[incoming] >= rank[normalized] ? incoming : normalized;
}

export function canReissueCheckout(status: unknown) {
  return ["cancelled", "expired"].includes(String(status || "").toLowerCase());
}

export function checkoutRetryStage(reference: unknown): "initial" | "recurring" | null {
  const value = String(reference || "");
  if (/:checkout:initial-retry-\d+$/i.test(value)) return "initial";
  if (/:checkout:recurring-retry-\d+$/i.test(value)) return "recurring";
  return null;
}

export function checkoutRetryAttempt(reference: unknown) {
  const match = /:checkout:(?:initial|recurring)-retry-(\d+)$/i.exec(String(reference || ""));
  return match ? Number(match[1]) : null;
}

export function webhookEventCanBeClaimed(
  existingStatus: unknown,
  options: { lockedAt?: string | null; nextAttemptAt?: string | null; now?: string } = {},
) {
  if (existingStatus == null) return true;
  const status = String(existingStatus).toLowerCase();
  const now = Date.parse(options.now || new Date().toISOString());
  if (["error", "retry"].includes(status)) {
    const nextAttempt = options.nextAttemptAt ? Date.parse(options.nextAttemptAt) : null;
    return nextAttempt === null || !Number.isFinite(nextAttempt) || nextAttempt <= now;
  }
  if (status !== "processing" || !options.lockedAt) return false;
  const lockedAt = Date.parse(options.lockedAt);
  return Number.isFinite(lockedAt) && lockedAt <= now - 5 * 60_000;
}

export function providerReservationDecision(input: {
  claimed: boolean;
  recoveredProviderId?: unknown;
}): "create" | "reuse" | "wait" {
  if (input.recoveredProviderId) return "reuse";
  return input.claimed ? "create" : "wait";
}

export function billingOperationCanBeReclaimed(
  operation: { state?: unknown; provider_id?: unknown; locked_at?: string | null } | null,
  now = new Date().toISOString(),
  staleAfterMs = 5 * 60_000,
) {
  if (!operation || operation.state !== "reserved" || operation.provider_id) return false;
  const lockedAt = operation.locked_at ? Date.parse(operation.locked_at) : Number.NaN;
  const current = Date.parse(now);
  return (
    Number.isFinite(lockedAt) && Number.isFinite(current) && lockedAt <= current - staleAfterMs
  );
}

export function shouldApplyConsolidatedEvent(input: {
  currentStatus: unknown;
  currentEventAt?: string | null;
  incomingEventAt?: string | null;
}) {
  if (String(input.currentStatus || "").toLowerCase() === "paid") return false;
  const current = timestamp(input.currentEventAt);
  const incoming = timestamp(input.incomingEventAt);
  return current === null || incoming === null || incoming >= current;
}

export function reduceConsolidatedBatchStatus(
  current: unknown,
  incoming: "active" | "partial" | "paid" | "cancelled",
  currentEventAt?: string | null,
  incomingEventAt?: string | null,
) {
  const normalized = ["active", "partial", "paid", "cancelled"].includes(
    String(current || "").toLowerCase(),
  )
    ? (String(current).toLowerCase() as "active" | "partial" | "paid" | "cancelled")
    : "active";
  const currentTime = timestamp(currentEventAt);
  const incomingTime = timestamp(incomingEventAt);
  if (currentTime !== null && incomingTime !== null && incomingTime < currentTime) {
    return normalized;
  }
  const rank = { active: 10, partial: 20, cancelled: 30, paid: 40 } as const;
  return rank[incoming] >= rank[normalized] ? incoming : normalized;
}

export function hasDirectBillingOwnership(consultation: any, userId: string) {
  const agencyPays =
    consultation?.payment_type === "imobiliaria" ||
    consultation?.billing_responsible_role === "imobiliaria";
  if (consultation?.profile_id_solicitante === userId) return true;
  if (consultation?.billing_responsible_user_id === userId) return true;
  return !agencyPays && consultation?.tenant_user_id === userId;
}

export function hasGlobalBillingRole(...roles: unknown[]) {
  return roles.some((role) =>
    ["admin", "admin_master", "financeiro"].includes(String(role || "").toLowerCase()),
  );
}

export function canManageIndividualInvoiceAction(
  invoice: any,
  action: "refresh" | "resend_email" | "resend_whatsapp" | "reissue",
) {
  if (action === "refresh") return true;
  const agencyPays =
    invoice?.payment_responsible === "agency" || invoice?.status === "awaiting_consolidation";
  return !agencyPays;
}

export function shouldAttemptNotification(
  previousStatus: string | null | undefined,
  explicitResend = false,
) {
  if (explicitResend) return true;
  return !["queued", "sent", "delivered", "read"].includes(
    String(previousStatus || "").toLowerCase(),
  );
}

export function contractActivationDecision(input: {
  paymentStatus: unknown;
  signatureStatus: unknown;
  policyStatus?: unknown;
}) {
  if (String(input.policyStatus || "").toLowerCase() === "cancelled") {
    return { activate: false, reason: "policy_cancelled" as const };
  }
  const paymentStatus = normalizePaymentStatus(input.paymentStatus);
  if (!["confirmed", "paid"].includes(paymentStatus)) {
    return { activate: false, reason: "payment_not_confirmed" as const };
  }
  const signatureStatus = String(input.signatureStatus || "").toLowerCase();
  if (!["signed", "active"].includes(signatureStatus)) {
    return { activate: false, reason: "signature_not_signed" as const };
  }
  return { activate: true, reason: "requirements_met" as const };
}

export function recurringSetupAllowsContractActivation(
  consultation: { card_setup_mode?: unknown; payment_method?: unknown } | null,
  subscription: {
    mode?: unknown;
    status?: unknown;
    checkout_status?: unknown;
    card_registration_status?: unknown;
    asaas_subscription_id?: unknown;
  } | null,
) {
  const usesCard =
    consultation?.payment_method === "credit_card" ||
    ["direct", "checkout"].includes(String(consultation?.card_setup_mode || ""));
  if (!usesCard) return true;
  if (!subscription?.asaas_subscription_id || subscription.status !== "active") return false;
  return (
    subscription.mode !== "checkout" ||
    (subscription.checkout_status === "paid" &&
      subscription.card_registration_status === "registered")
  );
}

/**
 * O convite de assinatura só pode sair quando a primeira cobrança estiver
 * confirmada e, no cartão, a recorrência já estiver pronta. Para Pix/boleto,
 * `recurringReady` é sempre verdadeiro.
 */
export function shouldDispatchContractAfterPayment(input: {
  paymentStatus: unknown;
  recurringReady: boolean;
}) {
  return (
    ["confirmed", "paid"].includes(normalizePaymentStatus(input.paymentStatus)) &&
    input.recurringReady
  );
}

export function shouldReconcileBillingOperation(state: unknown) {
  return ["reserved", "provider_created", "ambiguous", "persisted"].includes(String(state || ""));
}

const PAYMENT_RANK: Record<CanonicalPaymentStatus, number> = {
  pending: 10,
  awaiting_consolidation: 10,
  processing: 20,
  overdue: 25,
  refused: 25,
  confirmed: 30,
  paid: 40,
  cancelled: 50,
  refunded: 60,
  chargeback: 70,
};

const PAYMENT_TERMINAL = new Set<CanonicalPaymentStatus>(["cancelled", "refunded", "chargeback"]);

const SUBSCRIPTION_TERMINAL = new Set<CanonicalSubscriptionStatus>(["cancelled", "expired"]);

const SUBSCRIPTION_RANK: Record<CanonicalSubscriptionStatus, number> = {
  pending: 10,
  active: 20,
  suspended: 30,
  error: 35,
  cancelled: 40,
  expired: 40,
};

function timestamp(value?: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function latestProviderEventAt(current?: string | null, incoming?: string | null) {
  const currentTime = timestamp(current);
  const incomingTime = timestamp(incoming);
  if (currentTime !== null && incomingTime !== null && incomingTime < currentTime) {
    return current as string;
  }
  return incoming || current || null;
}

type ProviderTransitionContext = {
  current: Record<string, any>;
  currentEventAt: string | null;
  incomingEventAt: string;
  nextStatus: string;
  acceptedEventAt: string | null;
  staleEvent: boolean;
};

/**
 * Persiste uma transicao recebida por webhook usando compare-and-swap.
 *
 * A deduplicacao por event_id impede duas execucoes do mesmo evento, mas nao
 * serializa eventos diferentes do mesmo recurso. Sem este CAS, dois workers
 * podem ler `pending` ao mesmo tempo e o ultimo UPDATE rebaixar um `paid` que
 * o primeiro acabou de gravar. O loop relê o vencedor e reaplica o redutor,
 * mantendo a operacao segura mesmo quando o Asaas entrega em paralelo.
 */
export async function persistProviderTransition(input: {
  supabase: any;
  table: string;
  rowId: string;
  current: Record<string, any>;
  incomingEventAt: string;
  statusColumn?: string;
  eventAtColumn?: string | null;
  readEventAt?: (row: Record<string, any>) => string | null | undefined;
  reduce: (
    currentStatus: unknown,
    currentEventAt: string | null,
    incomingEventAt: string,
  ) => string;
  buildPatch: (context: ProviderTransitionContext) => Record<string, unknown>;
  guardColumns?: string[];
  maxAttempts?: number;
}) {
  const statusColumn = input.statusColumn || "status";
  const eventAtColumn =
    input.eventAtColumn === undefined ? "provider_event_at" : input.eventAtColumn;
  const maxAttempts = Math.max(1, input.maxAttempts || 6);
  let current = input.current;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const currentEventAt = input.readEventAt
      ? input.readEventAt(current) || null
      : eventAtColumn
        ? current[eventAtColumn] || null
        : null;
    const nextStatus = input.reduce(current[statusColumn], currentEventAt, input.incomingEventAt);
    const acceptedEventAt = latestProviderEventAt(currentEventAt, input.incomingEventAt);
    const currentTime = timestamp(currentEventAt);
    const incomingTime = timestamp(input.incomingEventAt);
    const staleEvent = currentTime !== null && incomingTime !== null && incomingTime < currentTime;
    const context: ProviderTransitionContext = {
      current,
      currentEventAt,
      incomingEventAt: input.incomingEventAt,
      nextStatus,
      acceptedEventAt,
      staleEvent,
    };
    const patch: Record<string, unknown> = {
      ...input.buildPatch(context),
      [statusColumn]: nextStatus,
    };
    if (eventAtColumn) patch[eventAtColumn] = acceptedEventAt;

    let update = input.supabase.from(input.table).update(patch).eq("id", input.rowId);
    update =
      current[statusColumn] == null
        ? update.is(statusColumn, null)
        : update.eq(statusColumn, current[statusColumn]);
    if (eventAtColumn) {
      update =
        current[eventAtColumn] == null
          ? update.is(eventAtColumn, null)
          : update.eq(eventAtColumn, current[eventAtColumn]);
    }
    for (const column of input.guardColumns || []) {
      update =
        current[column] == null ? update.is(column, null) : update.eq(column, current[column]);
    }

    const { data, error } = await update.select("*").maybeSingle();
    if (error) throw error;
    if (data) return { row: data, ...context };

    const { data: refreshed, error: refreshError } = await input.supabase
      .from(input.table)
      .select("*")
      .eq("id", input.rowId)
      .maybeSingle();
    if (refreshError) throw refreshError;
    if (!refreshed) throw new Error(`provider_transition_row_not_found:${input.table}`);
    current = refreshed;
  }

  throw new Error(`provider_transition_concurrency_exhausted:${input.table}`);
}

/**
 * Redutor conservador para entregas repetidas/fora de ordem do provedor.
 * Estados de progresso nunca voltam para `pending`/`overdue`; cancelamento,
 * estorno e chargeback continuam sendo aceitos como fatos posteriores.
 */
export function reducePaymentStatus(
  current: CanonicalPaymentStatus | string | null | undefined,
  incoming: CanonicalPaymentStatus,
  currentEventAt?: string | null,
  incomingEventAt?: string | null,
): CanonicalPaymentStatus {
  const normalizedCurrent = normalizePaymentStatus(current);
  if (normalizedCurrent === incoming) return normalizedCurrent;

  const currentTime = timestamp(currentEventAt);
  const incomingTime = timestamp(incomingEventAt);
  if (currentTime !== null && incomingTime !== null && incomingTime < currentTime) {
    return normalizedCurrent;
  }

  if (PAYMENT_TERMINAL.has(normalizedCurrent)) {
    if (!PAYMENT_TERMINAL.has(incoming)) return normalizedCurrent;
    return PAYMENT_RANK[incoming] >= PAYMENT_RANK[normalizedCurrent] ? incoming : normalizedCurrent;
  }
  if (PAYMENT_TERMINAL.has(incoming)) return incoming;
  return PAYMENT_RANK[incoming] >= PAYMENT_RANK[normalizedCurrent] ? incoming : normalizedCurrent;
}

/**
 * Assinaturas podem voltar de suspensa para ativa apenas com um evento mais
 * novo. Cancelamento/expiracao sao terminais e nunca sao desfeitos por uma
 * redelivery atrasada do Asaas.
 */
export function reduceSubscriptionStatus(
  current: CanonicalSubscriptionStatus | string | null | undefined,
  incoming: CanonicalSubscriptionStatus,
  currentEventAt?: string | null,
  incomingEventAt?: string | null,
): CanonicalSubscriptionStatus {
  const normalizedCurrent = normalizeSubscriptionStatus(current);
  if (normalizedCurrent === incoming) return normalizedCurrent;

  const currentTime = timestamp(currentEventAt);
  const incomingTime = timestamp(incomingEventAt);
  if (currentTime !== null && incomingTime !== null) {
    if (incomingTime < currentTime) return normalizedCurrent;
    if (incomingTime > currentTime) {
      return SUBSCRIPTION_TERMINAL.has(normalizedCurrent) && !SUBSCRIPTION_TERMINAL.has(incoming)
        ? normalizedCurrent
        : incoming;
    }
  }

  if (SUBSCRIPTION_TERMINAL.has(normalizedCurrent)) return normalizedCurrent;
  return SUBSCRIPTION_RANK[incoming] >= SUBSCRIPTION_RANK[normalizedCurrent]
    ? incoming
    : normalizedCurrent;
}

export function normalizeSubscriptionStatus(value: unknown): CanonicalSubscriptionStatus {
  const status = String(value || "")
    .trim()
    .toLowerCase();
  if (["active", "activated", "ativo"].includes(status)) return "active";
  if (["inactive", "inactivated", "suspended", "past_due", "suspenso"].includes(status)) {
    return "suspended";
  }
  if (["cancelled", "canceled", "deleted", "cancelado"].includes(status)) return "cancelled";
  if (["expired", "expirado"].includes(status)) return "expired";
  if (["error", "failed", "erro"].includes(status)) return "error";
  return "pending";
}

export function normalizePaymentStatus(value: unknown): CanonicalPaymentStatus {
  const status = String(value || "")
    .trim()
    .toLowerCase();
  if (["paid", "received", "recebido"].includes(status)) return "paid";
  if (["confirmed", "confirmado", "aprovado"].includes(status)) return "confirmed";
  if (["overdue", "vencido"].includes(status)) return "overdue";
  if (["refused", "failed", "falhou", "recusado"].includes(status)) return "refused";
  if (["cancelled", "canceled", "deleted", "cancelado"].includes(status)) return "cancelled";
  if (["refunded", "partially_refunded", "estornado"].includes(status)) return "refunded";
  if (["chargeback", "chargeback_dispute"].includes(status)) return "chargeback";
  if (status === "awaiting_consolidation") return "awaiting_consolidation";
  if (
    [
      "processing",
      "risk_analysis",
      "awaiting_risk_analysis",
      "approved",
      "in_analysis",
      "in_analysis_by_risk",
    ].includes(status)
  )
    return "processing";
  return "pending";
}

export function paymentStatusFromEvent(eventType: unknown, providerStatus?: unknown) {
  const event = String(eventType || "").toUpperCase();
  const map: Record<string, CanonicalPaymentStatus> = {
    PAYMENT_CREATED: "pending",
    PAYMENT_UPDATED: "pending",
    PAYMENT_AWAITING_RISK_ANALYSIS: "processing",
    PAYMENT_APPROVED_BY_RISK_ANALYSIS: "processing",
    PAYMENT_CONFIRMED: "confirmed",
    PAYMENT_RECEIVED: "paid",
    PAYMENT_OVERDUE: "overdue",
    PAYMENT_DELETED: "cancelled",
    PAYMENT_BANK_SLIP_CANCELLED: "cancelled",
    PAYMENT_REFUNDED: "refunded",
    PAYMENT_PARTIALLY_REFUNDED: "refunded",
    PAYMENT_CHARGEBACK_REQUESTED: "chargeback",
    PAYMENT_CHARGEBACK_DISPUTE: "chargeback",
    PAYMENT_CREDIT_CARD_CAPTURE_REFUSED: "refused",
    PAYMENT_REPROVED_BY_RISK_ANALYSIS: "refused",
  };
  // Eventos de transicao sao mais especificos do que snapshots atrasados no
  // corpo (o Asaas pode, por exemplo, entregar REPROVED com status PENDING).
  if (map[event] && !["PAYMENT_CREATED", "PAYMENT_UPDATED"].includes(event)) {
    return map[event];
  }
  if (providerStatus) return normalizePaymentStatus(providerStatus);
  return map[event] || "pending";
}

export function subscriptionStatusFromEvent(
  eventType: unknown,
  providerStatus?: unknown,
): CanonicalSubscriptionStatus {
  const provider = String(providerStatus || "").toUpperCase();
  if (["ACTIVE", "RECEIVED", "CONFIRMED"].includes(provider)) return "active";
  if (["INACTIVE", "SUSPENDED", "PAST_DUE"].includes(provider)) return "suspended";
  if (["CANCELLED", "CANCELED", "DELETED"].includes(provider)) return "cancelled";
  if (provider === "EXPIRED") return "expired";

  const event = String(eventType || "").toUpperCase();
  if (/DELETED|CANCELLED|CANCELED/.test(event)) return "cancelled";
  if (/INACTIVATED|SUSPENDED/.test(event)) return "suspended";
  if (/EXPIRED/.test(event)) return "expired";
  if (/CREATED|ACTIVATED|UPDATED/.test(event))
    return event.includes("CREATED") ? "pending" : "active";
  return "pending";
}

export function checkoutStatusFromEvent(eventType: unknown): CanonicalCheckoutStatus {
  const event = String(eventType || "").toUpperCase();
  if (event === "CHECKOUT_PAID") return "paid";
  if (/CANCELLED|CANCELED/.test(event)) return "cancelled";
  if (event === "CHECKOUT_EXPIRED") return "expired";
  return "pending";
}

export function reduceCheckoutStatus(
  current: CanonicalCheckoutStatus | string | null | undefined,
  incoming: CanonicalCheckoutStatus,
  currentEventAt?: string | null,
  incomingEventAt?: string | null,
): CanonicalCheckoutStatus {
  const normalizedCurrent: CanonicalCheckoutStatus = ["paid", "cancelled", "expired"].includes(
    String(current),
  )
    ? (current as CanonicalCheckoutStatus)
    : "pending";
  const currentTime = timestamp(currentEventAt);
  const incomingTime = timestamp(incomingEventAt);
  if (currentTime !== null && incomingTime !== null && incomingTime < currentTime) {
    return normalizedCurrent;
  }
  if (["paid", "cancelled", "expired"].includes(normalizedCurrent)) {
    return normalizedCurrent;
  }
  return incoming;
}

export function buildBillingKey(
  consultationId: string,
  kind: "initial" | "monthly" | "activation" | "subscription" | "checkout",
  discriminator: string | number,
) {
  return `nox:${consultationId}:${kind}:${String(discriminator).toLowerCase()}`;
}

export function resolveContractMonths(consultation: any) {
  const documents =
    consultation?.documentos && typeof consultation.documentos === "object"
      ? consultation.documentos
      : {};
  const candidates = [
    consultation?.contract_period_months,
    consultation?.contract_months,
    consultation?.periodo_contrato_meses,
    documents?.contract_period_months,
    documents?.periodo_contrato_meses,
    12,
  ];
  const found = candidates
    .map((candidate) => Number(candidate))
    .find((candidate) => Number.isSafeInteger(candidate) && candidate >= 1 && candidate <= 120);
  return found || 12;
}

export function addCalendarMonths(isoDate: string, months: number, preferredDay = 10) {
  const [year, month] = isoDate.split("-").map(Number);
  const index = month - 1 + months;
  const targetYear = year + Math.floor(index / 12);
  const targetMonthIndex = ((index % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  const day = Math.min(Math.max(preferredDay, 1), lastDay);
  return `${targetYear}-${String(targetMonthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function anchoredRecurrencePlan(input: {
  originalStartDate: string;
  originalEndDate: string;
  today: string;
  dueDay: number;
}) {
  let nextDueDate = input.originalStartDate;
  if (nextDueDate <= input.today) {
    const [year, month] = input.today.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const sameMonthDue = `${year}-${String(month).padStart(2, "0")}-${String(
      Math.min(Math.max(input.dueDay, 1), lastDay),
    ).padStart(2, "0")}`;
    nextDueDate =
      sameMonthDue > input.today ? sameMonthDue : addCalendarMonths(input.today, 1, input.dueDay);
  }
  if (nextDueDate < input.originalStartDate) nextDueDate = input.originalStartDate;
  if (nextDueDate > input.originalEndDate) {
    return { nextDueDate: null, endDate: input.originalEndDate, remainingPayments: 0 };
  }
  const [nextYear, nextMonth] = nextDueDate.split("-").map(Number);
  const [endYear, endMonth] = input.originalEndDate.split("-").map(Number);
  const remainingPayments = (endYear - nextYear) * 12 + endMonth - nextMonth + 1;
  return {
    nextDueDate,
    endDate: input.originalEndDate,
    remainingPayments: Math.max(0, remainingPayments),
  };
}

export function billingDueDateError(value: unknown, minimumDate: string) {
  const dueDate = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return "Informe o vencimento no formato YYYY-MM-DD.";
  }
  const parsed = new Date(`${dueDate}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dueDate) {
    return "Informe uma data de vencimento valida.";
  }
  if (dueDate < minimumDate) return "O vencimento nao pode estar no passado.";
  return null;
}

export type BillingScheduleItem = {
  installmentNumber: number;
  kind: "initial" | "monthly";
  dueDate: string;
  referenceMonth: string;
  billingKey: string;
};

export type InitialBillingDecision = {
  createInvoice: true;
  createIndividualProviderCharge: boolean;
  invoiceStatus: "pending" | "awaiting_consolidation";
  dispatchPendingDocuments: true;
  notificationChannels: readonly ["email", "whatsapp"];
};

/** Regra pura compartilhada pela matriz Pix/boleto do checkout. */
export function planInitialBilling(input: {
  paymentMethod: "pix" | "boleto";
  deferPayment: boolean;
  payer: "tenant" | "agency";
  fireMode: "avista" | "embutido";
}): InitialBillingDecision {
  // `deferPayment` muda a navegacao, nao a identidade da cobranca: nos dois
  // casos a fatura deve existir para segunda via, notificacao e conciliacao.
  void input.paymentMethod;
  void input.deferPayment;
  void input.fireMode;
  const consolidated = input.payer === "agency";
  return {
    createInvoice: true,
    createIndividualProviderCharge: !consolidated,
    invoiceStatus: consolidated ? "awaiting_consolidation" : "pending",
    dispatchPendingDocuments: true,
    notificationChannels: ["email", "whatsapp"],
  };
}

/** A parcela 1 já está contida na cobrança inicial; só N-1 mensais são futuras. */
export function buildBillingSchedule(params: {
  consultationId: string;
  months: number;
  initialDueDate: string;
  monthlyDueDay?: number;
}): BillingScheduleItem[] {
  const count = Math.max(1, Math.trunc(params.months));
  const items: BillingScheduleItem[] = [
    {
      installmentNumber: 1,
      kind: "initial",
      dueDate: params.initialDueDate,
      referenceMonth: params.initialDueDate.slice(0, 7) + "-01",
      billingKey: buildBillingKey(params.consultationId, "initial", 1),
    },
  ];
  for (let installmentNumber = 2; installmentNumber <= count; installmentNumber += 1) {
    const dueDate = addCalendarMonths(
      params.initialDueDate,
      installmentNumber - 1,
      params.monthlyDueDay ?? 10,
    );
    items.push({
      installmentNumber,
      kind: "monthly",
      dueDate,
      referenceMonth: dueDate.slice(0, 7) + "-01",
      billingKey: buildBillingKey(params.consultationId, "monthly", installmentNumber),
    });
  }
  return items;
}

export function calculateBillingAmounts(input: {
  guaranteeMonthly: number;
  paintingMonthly?: number;
  fireAnnual?: number;
  activationFee?: number;
  fireMode: "avista" | "embutido";
}) {
  const money = (value: number) => Math.round((Number(value) || 0) * 100) / 100;
  const fireAnnual = money(input.fireAnnual || 0);
  const fireMonthly = money(fireAnnual / 12);
  const monthlyAmount = money(
    input.guaranteeMonthly +
      (input.paintingMonthly || 0) +
      (input.fireMode === "embutido" ? fireMonthly : 0),
  );
  const initialAmount = money(
    monthlyAmount + (input.activationFee || 0) + (input.fireMode === "avista" ? fireAnnual : 0),
  );
  return {
    initialAmount,
    monthlyAmount,
    components: {
      guaranteeMonthly: money(input.guaranteeMonthly),
      paintingMonthly: money(input.paintingMonthly || 0),
      fireMonthly: input.fireMode === "embutido" ? fireMonthly : 0,
      fireUpfront: input.fireMode === "avista" ? fireAnnual : 0,
      activationFee: money(input.activationFee || 0),
    },
  };
}

/** Annual is rounded first; monthly is then derived from that frozen amount. */
export function calculateFireInsuranceAmounts(rent: number, percentage: number) {
  const money = (value: number) => Math.round((Number(value) || 0) * 100) / 100;
  const annual = money(money(rent) * (Number(percentage) / 100));
  return { annual, monthly: money(annual / 12) };
}

export type SubscriptionNotificationTarget = {
  notificationType: "payment_created" | "card_registration_requested";
  amount: number;
  dueDate: string;
  paymentUrl: string | null;
  cardRegistration: boolean;
};

/** Mantem os links inicial e recorrente explicitamente separados. */
export function buildSubscriptionNotificationPlan(input: {
  mode: "direct" | "checkout";
  initialAmount: number;
  monthlyAmount: number;
  initialDueDate: string;
  nextDueDate: string;
  initialPaymentUrl?: string | null;
  recurringCheckoutUrl?: string | null;
}): SubscriptionNotificationTarget[] {
  const targets: SubscriptionNotificationTarget[] = [
    {
      notificationType: "payment_created",
      amount: input.initialAmount,
      dueDate: input.initialDueDate,
      paymentUrl: input.initialPaymentUrl || null,
      cardRegistration: false,
    },
  ];
  if (input.mode === "checkout") {
    targets.push({
      notificationType: "card_registration_requested",
      amount: input.monthlyAmount,
      dueDate: input.nextDueDate,
      paymentUrl: input.recurringCheckoutUrl || null,
      cardRegistration: true,
    });
  }
  return targets;
}
