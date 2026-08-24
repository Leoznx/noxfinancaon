import { useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, LockKeyhole, ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  COMMISSION_PERIOD_OPTIONS,
  COMMISSION_STATUS_LABELS,
  filterCommissionHistory,
  getCommissionContractNumber,
  getCommissionCustomerName,
  getCommissionType,
  type CommissionHistoryFilter,
  type CommissionPeriod,
  type SellerCommissionRow,
} from "@/lib/seller-commissions-view";
import { formatDateTime, formatMoney } from "@/lib/vendedor-portal";

type CommissionHistoryProps = { rows: SellerCommissionRow[] };

const FILTERS: Array<{ value: CommissionHistoryFilter; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "paid", label: "Pagas" },
  { value: "retained", label: "Retidas" },
];

function statusClass(status: string) {
  if (["liberada_parcial", "liberada_total", "paga", "pago"].includes(status)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "retida") return "border-amber-200 bg-amber-50 text-amber-800";
  if (["estornada", "cancelada"].includes(status)) return "border-red-200 bg-red-50 text-red-700";
  return "border-neutral-200 bg-neutral-50 text-neutral-700";
}

export function CommissionHistory({ rows }: CommissionHistoryProps) {
  const [filter, setFilter] = useState<CommissionHistoryFilter>("all");
  const [period, setPeriod] = useState<CommissionPeriod>("current");
  const filteredRows = useMemo(
    () => filterCommissionHistory(rows, filter, period),
    [filter, period, rows],
  );

  return (
    <section className="rounded-[18px] border border-[#E9E9E9] bg-white p-5 shadow-[0_5px_20px_rgba(0,0,0,0.05)] sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-black tracking-[-0.015em] text-[#151515]">Histórico de comissões</h2>
          <div className="mt-3 inline-flex rounded-xl border border-[#E3E3E3] bg-[#FAFAFA] p-0.5" role="tablist" aria-label="Filtrar histórico por situação">
            {FILTERS.map((option) => {
              const selected = filter === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setFilter(option.value)}
                  className={`rounded-[9px] px-4 py-1.5 text-xs font-bold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD400] ${
                    selected ? "bg-[#111] text-white shadow-sm" : "text-[#707070] hover:text-[#111]"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
        <Select value={period} onValueChange={(value) => setPeriod(value as CommissionPeriod)}>
          <SelectTrigger className="h-10 w-full rounded-xl border-[#DEDEDE] bg-white text-sm font-semibold shadow-none sm:w-[180px]" aria-label="Selecionar período do histórico">
            <span className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-[#777]" aria-hidden="true" />
              <SelectValue />
            </span>
          </SelectTrigger>
          <SelectContent>
            {COMMISSION_PERIOD_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filteredRows.length === 0 ? (
        <CommissionEmptyState />
      ) : (
        <div className="mt-4">
          <div className="space-y-3 md:hidden">
            {filteredRows.map((row) => (
              <article key={row.id} className="rounded-2xl border border-[#ECECEC] bg-[#FCFCFC] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-[#111]">{getCommissionCustomerName(row)}</p>
                    <p className="mt-0.5 truncate text-xs text-[#777]">Contrato {getCommissionContractNumber(row)}</p>
                  </div>
                  <CommissionStatus status={row.status} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <HistoryValue label="Data" value={new Date(row.created_at).toLocaleDateString("pt-BR")} />
                  <HistoryValue label="Tipo" value={getCommissionType(row)} />
                  <HistoryValue label="Comissão" value={formatMoney(row.commission_amount)} strong />
                  <HistoryValue label="Bônus" value={formatMoney(row.bonus_amount)} strong />
                </div>
                <p className="mt-3 border-t border-[#E9E9E9] pt-3 text-[11px] text-[#777]">
                  Liberação: {formatDateTime(row.released_at || row.reserve_release_at) || "—"}
                </p>
              </article>
            ))}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow className="border-[#ECECEC] hover:bg-transparent">
                  <TableHead>Data</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Comissão</TableHead>
                  <TableHead>Bônus</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Liberação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => (
                  <TableRow key={row.id} className="border-[#F0F0F0]">
                    <TableCell className="whitespace-nowrap text-[#5F5F5F]">{new Date(row.created_at).toLocaleDateString("pt-BR")}</TableCell>
                    <TableCell className="max-w-[180px] truncate font-bold text-[#1B1B1B]">{getCommissionCustomerName(row)}</TableCell>
                    <TableCell className="max-w-[145px] truncate">{getCommissionContractNumber(row)}</TableCell>
                    <TableCell className="whitespace-nowrap text-[#5F5F5F]">{getCommissionType(row)}</TableCell>
                    <TableCell className="font-bold text-[#171717]">{formatMoney(row.commission_amount)}</TableCell>
                    <TableCell className="font-bold text-[#171717]">{formatMoney(row.bonus_amount)}</TableCell>
                    <TableCell><CommissionStatus status={row.status} /></TableCell>
                    <TableCell className="whitespace-nowrap text-[#5F5F5F]">{formatDateTime(row.released_at || row.reserve_release_at) || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </section>
  );
}

function CommissionStatus({ status }: { status: string }) {
  const normalized = String(status ?? "").toLowerCase();
  const paid = ["liberada_parcial", "liberada_total", "paga", "pago"].includes(normalized);
  return (
    <Badge variant="outline" className={`w-fit gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${statusClass(normalized)}`}>
      {paid ? <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> : normalized === "retida" ? <LockKeyhole className="h-3 w-3" aria-hidden="true" /> : null}
      {COMMISSION_STATUS_LABELS[normalized] ?? status}
    </Badge>
  );
}

function HistoryValue({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-wide text-[#999]">{label}</p>
      <p className={`mt-0.5 ${strong ? "font-black text-[#111]" : "font-semibold text-[#555]"}`}>{value}</p>
    </div>
  );
}

function CommissionEmptyState() {
  const linePoints = [
    [0, 65], [32, 54], [64, 31], [96, 52], [130, 37], [164, 12], [196, 28], [228, 5], [260, 19],
  ];
  return (
    <div className="relative mt-4 flex min-h-[145px] items-center justify-center overflow-hidden rounded-2xl border border-dashed border-[#E2E2E2] bg-white px-5 py-4 text-center">
      <svg className="absolute bottom-5 left-3 hidden h-20 w-64 text-[#E6E6E6] opacity-65 sm:block" viewBox="0 0 260 80" fill="none" aria-hidden="true">
        <path d="M0 65L32 54L64 31L96 52L130 37L164 12L196 28L228 5L260 19" stroke="currentColor" strokeWidth="2" />
        {linePoints.map(([x, y]) => <circle key={x} cx={x} cy={y} r="3.5" fill="currentColor" />)}
      </svg>
      <div className="absolute bottom-5 right-5 hidden items-end gap-2 opacity-55 sm:flex" aria-hidden="true">
        {[28, 52, 38, 57, 76, 44, 65].map((height, index) => <span key={`${height}-${index}`} className="w-3 bg-[#E7E7E7]" style={{ height }} />)}
      </div>
      <div className="relative z-10 max-w-3xl">
        <div className="mx-auto flex h-13 w-13 items-center justify-center rounded-full bg-[#F4F4F4]">
          <ReceiptText className="h-7 w-7 text-[#8A8A8A]" strokeWidth={1.7} aria-hidden="true" />
        </div>
        <h3 className="mt-3 text-lg font-black text-[#111]">Nenhuma comissão registrada</h3>
        <p className="mt-2 text-sm font-medium text-[#888]">
          Comissões aparecem após contrato vinculado e primeira parcela conforme o fluxo financeiro.
        </p>
      </div>
    </div>
  );
}
