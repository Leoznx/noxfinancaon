export const PAYMENT_DUE_DAYS = [5, 10, 15, 20, 25, 28] as const;

export type PaymentDueDay = (typeof PAYMENT_DUE_DAYS)[number];

export function normalizePaymentDueDay(value: unknown): PaymentDueDay | null {
  const parsed = Number(value);
  return PAYMENT_DUE_DAYS.includes(parsed as PaymentDueDay) ? (parsed as PaymentDueDay) : null;
}

export function paymentDueDayLabel(day: PaymentDueDay) {
  return `Dia ${day}`;
}

function isoDate(year: number, month: number, day: number) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function saoPauloToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function nextInvoiceDueDate(
  currentDueDate: string | null | undefined,
  day: PaymentDueDay,
  today = saoPauloToday(),
) {
  const current = String(currentDueDate || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(current)) {
    const [year, month] = current.split("-").map(Number);
    const sameCompetence = isoDate(year, month, day);
    if (sameCompetence >= today) return sameCompetence;
  }
  const [year, month] = today.split("-").map(Number);
  const sameMonth = isoDate(year, month, day);
  if (sameMonth >= today) return sameMonth;
  return isoDate(year + Math.floor(month / 12), (month % 12) + 1, day);
}
