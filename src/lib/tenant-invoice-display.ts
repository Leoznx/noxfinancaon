export type TenantInvoiceDisplayStatus =
  "paid" | "pending" | "overdue" | "cancelled" | "processing";

export type TenantInvoiceDisplayRow = {
  id: string;
  installmentNumber: number;
  installmentTotal: number | null;
  dueDate: string | null;
  amount: number;
  status: TenantInvoiceDisplayStatus;
  rawStatus: string;
  paidAt: string | null;
  boletoUrl: string | null;
  barcode: string | null;
  receiptUrl: string | null;
  paymentUrl: string | null;
  chargeKind: string | null;
  components: Record<string, unknown> | null;
};

type CanonicalInvoiceRow = {
  id: string;
  numero_parcela?: number | null;
  installment_total?: number | null;
  vencimento?: string | null;
  valor?: number | string | null;
  status?: string | null;
  pago_em?: string | null;
  confirmed_at?: string | null;
  boleto_url?: string | null;
  linha_digitavel?: string | null;
  payment_url?: string | null;
  charge_kind?: string | null;
  components?: Record<string, unknown> | null;
};

type LegacyInvoiceRow = {
  id: string;
  numero_parcela?: number | null;
  data_vencimento?: string | null;
  valor?: number | string | null;
  status?: string | null;
  data_pagamento?: string | null;
  boleto_url?: string | null;
  linha_digitavel?: string | null;
  comprovante_url?: string | null;
};

const PAID_STATUSES = new Set(["pago", "paid", "received", "confirmed", "received_in_cash"]);
const CANCELLED_STATUSES = new Set(["cancelado", "cancelled", "canceled", "refunded", "deleted"]);
const PROCESSING_STATUSES = new Set(["processing", "processamento", "risk_analysis"]);

function dateAtStartOfDay(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeTenantInvoiceStatus(
  status: string | null | undefined,
  dueDate: string | null | undefined,
  today = new Date(),
): TenantInvoiceDisplayStatus {
  const normalized = String(status || "pending").toLowerCase();
  if (PAID_STATUSES.has(normalized)) return "paid";
  if (CANCELLED_STATUSES.has(normalized)) return "cancelled";
  if (PROCESSING_STATUSES.has(normalized)) return "processing";

  const due = dateAtStartOfDay(dueDate);
  const reference = new Date(today);
  reference.setHours(0, 0, 0, 0);
  return due && due < reference ? "overdue" : "pending";
}

export function normalizeCanonicalTenantInvoices(
  rows: CanonicalInvoiceRow[],
  today = new Date(),
): TenantInvoiceDisplayRow[] {
  return rows
    .map((row, index) => ({
      id: row.id,
      installmentNumber: Number(row.numero_parcela || index + 1),
      installmentTotal: row.installment_total ? Number(row.installment_total) : null,
      dueDate: row.vencimento || null,
      amount: Number(row.valor || 0),
      status: normalizeTenantInvoiceStatus(row.status, row.vencimento, today),
      rawStatus: String(row.status || "pending"),
      paidAt: row.pago_em || row.confirmed_at || null,
      boletoUrl: row.boleto_url || null,
      barcode: row.linha_digitavel || null,
      receiptUrl: null,
      paymentUrl: row.payment_url || row.boleto_url || null,
      chargeKind: row.charge_kind || null,
      components: row.components || null,
    }))
    .sort((a, b) => a.installmentNumber - b.installmentNumber);
}

export function normalizeLegacyTenantInvoices(
  rows: LegacyInvoiceRow[],
  today = new Date(),
): TenantInvoiceDisplayRow[] {
  return rows
    .map((row, index) => {
      const installmentNumber = Number(row.numero_parcela || index + 1);
      return {
        id: row.id,
        installmentNumber,
        installmentTotal: null,
        dueDate: row.data_vencimento || null,
        amount: Number(row.valor || 0),
        status: normalizeTenantInvoiceStatus(row.status, row.data_vencimento, today),
        rawStatus: String(row.status || "pendente"),
        paidAt: row.data_pagamento || null,
        boletoUrl: row.boleto_url || null,
        barcode: row.linha_digitavel || null,
        receiptUrl: row.comprovante_url || null,
        paymentUrl: row.boleto_url || null,
        chargeKind: installmentNumber === 1 ? "initial" : "monthly",
        components: null,
      };
    })
    .sort((a, b) => a.installmentNumber - b.installmentNumber);
}

export function isTenantInvoiceOpen(row: TenantInvoiceDisplayRow) {
  return row.status === "pending" || row.status === "overdue" || row.status === "processing";
}

export function pickRecurringInvoiceValue(rows: TenantInvoiceDisplayRow[]) {
  const activeRows = rows.filter((row) => row.status !== "cancelled");
  const recurring = activeRows.find((row) => row.chargeKind === "monthly" && row.amount > 0);
  const laterInstallment = activeRows.find((row) => row.installmentNumber > 1 && row.amount > 0);
  return (
    recurring?.amount ??
    laterInstallment?.amount ??
    activeRows.find((row) => row.amount > 0)?.amount ??
    0
  );
}

export function pickNextOpenInvoice(rows: TenantInvoiceDisplayRow[]) {
  return rows.filter(isTenantInvoiceOpen).sort((a, b) => {
    const aTime = dateAtStartOfDay(a.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bTime = dateAtStartOfDay(b.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return aTime - bTime || a.installmentNumber - b.installmentNumber;
  })[0];
}

export function tenantInvoiceKindLabel(row: TenantInvoiceDisplayRow) {
  return row.chargeKind === "initial" ? "Cobrança inicial" : "Mensalidade";
}

export function tenantInvoiceInitialBreakdown(row: TenantInvoiceDisplayRow) {
  if (row.chargeKind !== "initial") return null;
  const monthlyAmount = Number(row.components?.monthlyAmount || 0);
  if (!(monthlyAmount > 0) || monthlyAmount > row.amount) return null;
  return {
    monthlyAmount,
    initialExtrasAmount: Math.max(0, Number((row.amount - monthlyAmount).toFixed(2))),
  };
}
