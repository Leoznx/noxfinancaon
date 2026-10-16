export const PAYMENT_DUE_DAYS = [5, 10, 15, 20, 25, 28] as const;

export type PaymentDueDay = (typeof PAYMENT_DUE_DAYS)[number];

export function normalizePaymentDueDay(value: unknown): PaymentDueDay | null {
  const parsed = Number(value);
  return PAYMENT_DUE_DAYS.includes(parsed as PaymentDueDay) ? (parsed as PaymentDueDay) : null;
}

export function paymentDueDayLabel(day: PaymentDueDay) {
  return `Dia ${day}`;
}
