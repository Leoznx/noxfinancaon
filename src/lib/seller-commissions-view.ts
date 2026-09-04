export type SellerCommissionRow = {
  id: string;
  month: number;
  year: number;
  commission_amount: number | null;
  bonus_amount: number | null;
  reserve_amount: number | null;
  released_amount: number | null;
  status: string;
  created_at: string;
  released_at: string | null;
  reserve_release_at: string | null;
  apolice_id: string | null;
  contract_id: string | null;
  apolices: {
    numero: string | null;
    status: string | null;
    consulta: {
      tenant_name: string | null;
      inquilino: { nome: string | null; razao_social: string | null } | null;
    } | null;
  } | null;
};

export type CommissionHistoryFilter = "all" | "paid" | "retained";
export type CommissionPeriod = "current" | "previous" | "last3" | "last6" | "year";

export const COMMISSION_STATUS_LABELS: Record<string, string> = {
  aguardando_primeira_parcela: "Aguardando 1ª parcela",
  pendente: "Pendente",
  elegivel: "Elegível",
  retida: "Retida",
  liberada_parcial: "Liberada parcial",
  liberada_total: "Liberada total",
  paga: "Paga",
  pago: "Pago",
  estornada: "Estornada",
  cancelada: "Cancelada",
};

export const COMMISSION_PERIOD_OPTIONS: Array<{ value: CommissionPeriod; label: string }> = [
  { value: "current", label: "Este mês" },
  { value: "previous", label: "Mês anterior" },
  { value: "last3", label: "Últimos 3 meses" },
  { value: "last6", label: "Últimos 6 meses" },
  { value: "year", label: "Este ano" },
];

const PAID_STATUSES = new Set(["liberada_parcial", "liberada_total", "paga", "pago"]);
const RETAINED_STATUSES = new Set(["retida", "liberada_parcial"]);

function monthIndex(month: number, year: number) {
  return year * 12 + month - 1;
}

export function filterCommissionHistory(
  rows: SellerCommissionRow[],
  filter: CommissionHistoryFilter,
  period: CommissionPeriod,
  referenceDate = new Date(),
) {
  const referenceMonth = referenceDate.getMonth() + 1;
  const referenceYear = referenceDate.getFullYear();
  const referenceIndex = monthIndex(referenceMonth, referenceYear);

  return rows.filter((row) => {
    const normalizedStatus = String(row.status ?? "").toLowerCase();
    if (filter === "paid" && !PAID_STATUSES.has(normalizedStatus)) return false;
    if (filter === "retained" && !RETAINED_STATUSES.has(normalizedStatus)) return false;

    const rowIndex = monthIndex(Number(row.month), Number(row.year));
    if (period === "current") return rowIndex === referenceIndex;
    if (period === "previous") return rowIndex === referenceIndex - 1;
    if (period === "last3") return rowIndex <= referenceIndex && rowIndex >= referenceIndex - 2;
    if (period === "last6") return rowIndex <= referenceIndex && rowIndex >= referenceIndex - 5;
    return Number(row.year) === referenceYear;
  });
}

export function summarizeCommissions(rows: SellerCommissionRow[]) {
  return rows.reduce(
    (summary, row) => ({
      comissao: summary.comissao + Number(row.commission_amount ?? 0),
      bonus: summary.bonus + Number(row.bonus_amount ?? 0),
      retido: summary.retido + Number(row.reserve_amount ?? 0),
      liberado: summary.liberado + Number(row.released_amount ?? 0),
    }),
    { comissao: 0, bonus: 0, retido: 0, liberado: 0 },
  );
}

export function getCommissionEntryAmount(row: SellerCommissionRow) {
  const released = Number(row.released_amount ?? 0);
  const commission = Number(row.commission_amount ?? 0);
  return released > 0 ? released : commission;
}

export function getCommissionCustomerName(row: SellerCommissionRow) {
  const tenant = row.apolices?.consulta;
  return (
    tenant?.tenant_name?.trim() ||
    tenant?.inquilino?.razao_social?.trim() ||
    tenant?.inquilino?.nome?.trim() ||
    "—"
  );
}

export function getCommissionContractNumber(row: SellerCommissionRow) {
  return row.apolices?.numero || row.apolice_id || row.contract_id || "—";
}

export function getCommissionType(_row: SellerCommissionRow) {
  return "Comissão";
}
