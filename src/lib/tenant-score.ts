export const TENANT_SCORE_BASE = 824;
export const TENANT_SCORE_MAX = 950;

export type TenantScoreInvoice = {
  id: string;
  status: string;
  dueDate: string | null;
  paidAt: string | null;
};

export type TenantScoreEventKind =
  | "paid_early"
  | "paid_on_time"
  | "late_1_3"
  | "late_4_5"
  | "late_6_30"
  | "late_over_30";

export type TenantScoreEvent = {
  invoiceId: string;
  kind: TenantScoreEventKind;
  points: number;
  days: number;
  dueDate: string;
  paidAt: string | null;
};

export type TenantScoreResult = {
  score: number;
  baseScore: number;
  maxScore: number;
  earnedPoints: number;
  lostPoints: number;
  earlyPayments: number;
  onTimePayments: number;
  latePayments: number;
  events: TenantScoreEvent[];
  lastEvent: TenantScoreEvent | null;
};

const PAID_STATUSES = new Set(["paid", "confirmed", "paid_via_consolidated"]);
const IGNORED_STATUSES = new Set([
  "cancelled",
  "refunded",
  "partially_refunded",
  "refund_processing",
  "refund_denied",
]);
const DAY_MS = 86_400_000;

function calendarDay(value: string | Date | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) {
    return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stablePoints(seed: string, minimum: number, maximum: number) {
  return minimum + (stableHash(seed) % (maximum - minimum + 1));
}

function penaltyFor(invoiceId: string, daysLate: number) {
  if (daysLate > 30) {
    return {
      kind: "late_over_30" as const,
      points: stablePoints(`${invoiceId}:late_over_30`, 123, 342),
    };
  }
  if (daysLate > 5) {
    return {
      kind: "late_6_30" as const,
      points: stablePoints(`${invoiceId}:late_6_30`, 56, 123),
    };
  }
  if (daysLate > 3) {
    return {
      kind: "late_4_5" as const,
      points: stablePoints(`${invoiceId}:late_4_5`, 21, 56),
    };
  }
  return {
    kind: "late_1_3" as const,
    points: stablePoints(`${invoiceId}:late_1_3`, 15, 21),
  };
}

export function calculateTenantScore(
  invoices: TenantScoreInvoice[],
  today: Date = new Date(),
): TenantScoreResult {
  const todayDay = calendarDay(today) ?? Date.now();
  const events: TenantScoreEvent[] = [];

  for (const invoice of invoices) {
    const status = String(invoice.status || "").toLocaleLowerCase("pt-BR");
    if (IGNORED_STATUSES.has(status)) continue;
    const dueDay = calendarDay(invoice.dueDate);
    if (dueDay === null || !invoice.dueDate) continue;

    if (PAID_STATUSES.has(status)) {
      const paidDay = calendarDay(invoice.paidAt) ?? dueDay;
      const days = Math.round((paidDay - dueDay) / DAY_MS);
      if (days < 0) {
        events.push({
          invoiceId: invoice.id,
          kind: "paid_early",
          points: stablePoints(`${invoice.id}:paid_early`, 15, 22),
          days: Math.abs(days),
          dueDate: invoice.dueDate,
          paidAt: invoice.paidAt,
        });
      } else if (days === 0) {
        events.push({
          invoiceId: invoice.id,
          kind: "paid_on_time",
          points: stablePoints(`${invoice.id}:paid_on_time`, 7, 22),
          days: 0,
          dueDate: invoice.dueDate,
          paidAt: invoice.paidAt,
        });
      } else {
        const penalty = penaltyFor(invoice.id, days);
        events.push({
          invoiceId: invoice.id,
          kind: penalty.kind,
          points: -penalty.points,
          days,
          dueDate: invoice.dueDate,
          paidAt: invoice.paidAt,
        });
      }
      continue;
    }

    const daysLate = Math.floor((todayDay - dueDay) / DAY_MS);
    if (daysLate < 1) continue;
    const penalty = penaltyFor(invoice.id, daysLate);
    events.push({
      invoiceId: invoice.id,
      kind: penalty.kind,
      points: -penalty.points,
      days: daysLate,
      dueDate: invoice.dueDate,
      paidAt: null,
    });
  }

  events.sort((first, second) => first.dueDate.localeCompare(second.dueDate));
  const earnedPoints = events.reduce(
    (total, event) => total + Math.max(0, event.points),
    0,
  );
  const lostPoints = events.reduce(
    (total, event) => total + Math.abs(Math.min(0, event.points)),
    0,
  );
  const rawScore = TENANT_SCORE_BASE + earnedPoints - lostPoints;

  return {
    score: Math.max(0, Math.min(TENANT_SCORE_MAX, rawScore)),
    baseScore: TENANT_SCORE_BASE,
    maxScore: TENANT_SCORE_MAX,
    earnedPoints,
    lostPoints,
    earlyPayments: events.filter((event) => event.kind === "paid_early").length,
    onTimePayments: events.filter((event) => event.kind === "paid_on_time").length,
    latePayments: events.filter((event) => event.points < 0).length,
    events,
    lastEvent: events.at(-1) ?? null,
  };
}

export function tenantScoreLevel(score: number) {
  if (score >= 900) return { label: "Excepcional", color: "#10845B" };
  if (score >= 800) return { label: "Muito bom", color: "#17845F" };
  if (score >= 700) return { label: "Bom", color: "#B87800" };
  if (score >= 600) return { label: "Em construção", color: "#C56A11" };
  return { label: "Atenção", color: "#C23B3B" };
}
