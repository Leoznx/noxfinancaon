export type ExistingSubscriptionSummary = {
  id: string;
  customer: string;
  billingType: string;
  cycle: string;
  status: string;
  value: number;
  description: string;
  nextDueDate: string | null;
  endDate: string | null;
  maxPayments: number | null;
};

function digits(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function providerRows(response: any): any[] {
  if (Array.isArray(response?.data)) return response.data;
  return Array.isArray(response) ? response : [];
}

export function selectCustomerByDocument(response: any, document: string) {
  const expected = digits(document);
  return providerRows(response).filter((customer) => digits(customer?.cpfCnpj) === expected);
}

export function selectNoxCardSubscriptions(response: any, customerId: string) {
  return providerRows(response)
    .filter((subscription) => String(subscription?.customer || "") === customerId)
    .filter(
      (subscription) => String(subscription?.billingType || "").toUpperCase() === "CREDIT_CARD",
    )
    .filter((subscription) => String(subscription?.cycle || "").toUpperCase() === "MONTHLY")
    .filter((subscription) => String(subscription?.status || "").toUpperCase() === "ACTIVE")
    .filter((subscription) => normalizeText(subscription?.description).includes("nox fianca"));
}

export function countMonthlyInstallments(firstDueDate: string, endDate: string) {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(firstDueDate)
    ? new Date(`${firstDueDate}T00:00:00Z`)
    : new Date(Number.NaN);
  const end = /^\d{4}-\d{2}-\d{2}$/.test(endDate)
    ? new Date(`${endDate}T00:00:00Z`)
    : new Date(Number.NaN);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) return 0;
  return (
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    end.getUTCMonth() -
    start.getUTCMonth() +
    1
  );
}

export function subscriptionInstallmentCount(input: { subscription: any; firstDueDate: string }) {
  const maxPayments = Number(input.subscription?.maxPayments || 0);
  if (Number.isSafeInteger(maxPayments) && maxPayments > 0) return maxPayments;
  return countMonthlyInstallments(input.firstDueDate, String(input.subscription?.endDate || ""));
}

export function isCompatibleSubscriptionAmount(providerValue: unknown, contractualValue: unknown) {
  const provider = Math.round(Number(providerValue || 0) * 100) / 100;
  const contractual = Math.round(Number(contractualValue || 0) * 100) / 100;
  if (!(provider > 0) || !(contractual > 0) || provider < contractual) return false;
  const maximumPassThrough = Math.max(10, contractual * 0.15);
  return provider - contractual <= maximumPassThrough + 0.001;
}

export function buildImportedMonthlySchedule(input: {
  firstDueDate: string;
  totalInstallments: number;
}) {
  const [year, month, day] = input.firstDueDate.split("-").map(Number);
  if (!year || !month || !day || input.totalInstallments < 1) return [];
  return Array.from({ length: input.totalInstallments }, (_, index) => {
    const targetMonth = month - 1 + index;
    const targetYear = year + Math.floor(targetMonth / 12);
    const monthIndex = ((targetMonth % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(targetYear, monthIndex + 1, 0)).getUTCDate();
    const targetDay = Math.min(day, lastDay);
    return {
      installmentNumber: index + 1,
      dueDate: `${targetYear}-${String(monthIndex + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`,
    };
  });
}
