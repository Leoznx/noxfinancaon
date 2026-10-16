export const BILLING_TIME_ZONE = "America/Sao_Paulo";
export const BILLING_DUE_DAY = 10;
export const CONTRACT_BILLING_DUE_DAYS = [5, 10, 15, 20, 25, 28] as const;
export const BILLING_FINE_PERCENT = 2;
export const BILLING_MONTHLY_INTEREST_PERCENT = 1;
export const BOLETO_ISSUANCE_LEAD_DAYS = 7;
export const CONSOLIDATABLE_INVOICE_STATUSES = [
  "awaiting_consolidation",
  "pending",
  "processing",
  "overdue",
  "risk_analysis",
  "approved",
  "created",
  "waiting_payment",
];

export function isConsolidatableInvoiceStatus(status: unknown) {
  return CONSOLIDATABLE_INVOICE_STATUSES.includes(String(status || "").toLowerCase());
}

export function normalizeBillingDueDay(value: unknown, fallback = BILLING_DUE_DAY) {
  const parsed = Number(value);
  if (Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 28) return parsed;
  return fallback;
}

export function normalizeContractBillingDueDay(value: unknown) {
  const parsed = Number(value);
  return CONTRACT_BILLING_DUE_DAYS.includes(
    parsed as (typeof CONTRACT_BILLING_DUE_DAYS)[number],
  )
    ? parsed
    : null;
}

/**
 * Reads the canonical monthly due day with a safe fallback. Billing entry
 * points use a service-role client here because tenant RLS intentionally does
 * not expose automation settings to contract payers.
 */
export async function resolveBillingDueDay(supabase: any) {
  try {
    const { data, error } = await supabase
      .from("billing_automation_settings")
      .select("due_day")
      .eq("id", true)
      .maybeSingle();
    if (error) {
      console.warn("[billing-automation] due_day_fallback", error.message || error);
      return BILLING_DUE_DAY;
    }
    return normalizeBillingDueDay(data?.due_day);
  } catch (error) {
    console.warn(
      "[billing-automation] due_day_fallback",
      error instanceof Error ? error.message : String(error),
    );
    return BILLING_DUE_DAY;
  }
}

export type BillingCadence =
  | { kind: "pre_due"; slot: 1; overdueDays: -1 }
  | { kind: "overdue_week_1"; slot: 1 | 2; overdueDays: number }
  | { kind: "overdue_week_2"; slot: 1 | 2 | 3 | 4; overdueDays: number };

export type SaoPauloClock = {
  date: string;
  hour: number;
  weekday: number;
};

export function saoPauloClock(now = new Date()): SaoPauloClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BILLING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
    weekday: weekdays[value("weekday")] ?? -1,
  };
}

export function addIsoDays(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function initialBoletoDueDate(now = new Date()) {
  return addIsoDays(saoPauloClock(now).date, BOLETO_ISSUANCE_LEAD_DAYS);
}

export function scheduledBoletoIssueDate(dueDate: string) {
  return addIsoDays(dueDate, -BOLETO_ISSUANCE_LEAD_DAYS);
}

export function shouldMaterializeScheduledBoleto(dueDate: string, now = new Date()) {
  return scheduledBoletoIssueDate(dueDate) <= saoPauloClock(now).date;
}

export function differenceInIsoDays(later: string, earlier: string) {
  const toUtc = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(later) - toUtc(earlier)) / 86_400_000);
}

export function monthlyDueDate(year: number, month: number, dueDay = BILLING_DUE_DAY) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(dueDay, lastDay)).padStart(
    2,
    "0",
  )}`;
}

export function nextContractBillingDueDate(today: string, dueDay: number) {
  const [year, month] = today.split("-").map(Number);
  const sameMonth = monthlyDueDate(year, month, dueDay);
  if (sameMonth >= today) return sameMonth;
  const nextMonthIndex = month;
  return monthlyDueDate(
    year + Math.floor(nextMonthIndex / 12),
    (nextMonthIndex % 12) + 1,
    dueDay,
  );
}

function addBusinessDaysFrom(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  let added = 0;
  while (added < days) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) added += 1;
  }
  return date.toISOString().slice(0, 10);
}

export function consolidatedDueDate(
  year: number,
  month: number,
  dueDay = BILLING_DUE_DAY,
  today = saoPauloClock().date,
) {
  const configured = monthlyDueDate(year, month, dueDay);
  return configured > today ? configured : addBusinessDaysFrom(today, 3);
}

export function nextMonthlyDueDate(now = new Date(), monthsAhead = 1) {
  const clock = saoPauloClock(now);
  const [year, month] = clock.date.split("-").map(Number);
  const index = month - 1 + monthsAhead;
  return monthlyDueDate(year + Math.floor(index / 12), (index % 12) + 1);
}

// The scheduler runs hourly during business hours. Only these four local
// hours are dispatch windows; the notification idempotency key prevents a
// retry from becoming a duplicate contact.
export function collectionCadence(params: { dueDate: string; now?: Date }): BillingCadence | null {
  const clock = saoPauloClock(params.now);
  const overdueDays = differenceInIsoDays(clock.date, params.dueDate);
  if (overdueDays === -1 && clock.hour === 9) {
    return { kind: "pre_due", slot: 1, overdueDays: -1 };
  }
  if (clock.weekday === 0 || clock.weekday === 6) return null;
  if (overdueDays >= 1 && overdueDays <= 7) {
    const slots: Record<number, 1 | 2> = { 9: 1, 14: 2 };
    const slot = slots[clock.hour];
    return slot ? { kind: "overdue_week_1", slot, overdueDays } : null;
  }
  if (overdueDays >= 8 && overdueDays <= 14) {
    const slots: Record<number, 1 | 2 | 3 | 4> = { 9: 1, 11: 2, 14: 3, 17: 4 };
    const slot = slots[clock.hour];
    return slot ? { kind: "overdue_week_2", slot, overdueDays } : null;
  }
  return null;
}

export function notificationKey(cadence: BillingCadence, date: string) {
  return `${cadence.kind}:${date}:slot_${cadence.slot}`;
}

export function asaasLateFeePayload() {
  return {
    interest: { value: BILLING_MONTHLY_INTEREST_PERCENT },
    fine: { value: BILLING_FINE_PERCENT },
  };
}

export function isCollectableStatus(status: string | null | undefined) {
  return ["pending", "created", "waiting_payment", "overdue", "risk_analysis", "approved"].includes(
    String(status || "").toLowerCase(),
  );
}

export function buildCollectionMessage(params: {
  name?: string | null;
  amount: number;
  dueDate: string;
  cadence: BillingCadence;
  consolidated?: boolean;
  invoiceCount?: number;
}) {
  const amount = params.amount.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
  const [year, month, day] = params.dueDate.split("-");
  const dueDate = `${day}/${month}/${year}`;
  const reference = params.consolidated
    ? `cobrança consolidada${
        params.invoiceCount ? ` de ${params.invoiceCount} contratos ativos` : ""
      }`
    : "mensalidade";
  const firstName =
    String(params.name || "cliente")
      .trim()
      .split(/\s+/u)[0] || "cliente";
  const greeting = `Olá, ${firstName}! 👋`;

  if (params.cadence.kind === "pre_due") {
    return `${greeting}\n\nSua ${reference} de ${amount} vence amanhã (${dueDate}).\n\nToque em *Pagar* para abrir o boleto ou Pix. 🔒`;
  }

  return `${greeting}\n\nSua ${reference} de ${amount}, vencida em ${dueDate}, está em aberto há ${params.cadence.overdueDays} dia${
    params.cadence.overdueDays === 1 ? "" : "s"
  }.\n\nToque em *Pagar* para abrir o boleto atualizado ou Pix. 🔒`;
}
