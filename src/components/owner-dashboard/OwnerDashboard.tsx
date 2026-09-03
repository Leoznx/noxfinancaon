import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  DollarSign,
  FileCheck2,
  FileText,
  Home,
  House,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import {
  fetchOwnerDashboard,
  filterMonthlyRevenue,
  type OwnerDashboardActivity,
  type OwnerDashboardContract,
  type OwnerDashboardData,
  type OwnerDashboardPeriod,
} from "@/lib/owner-dashboard";

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 2,
});

const BRL_COMPACT = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

const MONTH = new Intl.DateTimeFormat("pt-BR", { month: "short" });
const MONTH_YEAR = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });

const DONUT_COLORS = ["#FFCA0A", "#31B846", "#3185E7", "#202020", "#A3A3A3"];

function dateAtNoon(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`);
}

function formatMonth(value: string) {
  if (!value) return "—";
  return MONTH.format(dateAtNoon(value)).replace(".", "");
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return dateAtNoon(value).toLocaleDateString("pt-BR");
}

function formatRelativeDate(value: string) {
  const date = new Date(value);
  const elapsed = Date.now() - date.getTime();
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Agora";
  if (minutes < 60) return `Há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Ontem";
  if (days < 7) return `Há ${days} dias`;
  return date.toLocaleDateString("pt-BR");
}

export function OwnerDashboard() {
  const [data, setData] = useState<OwnerDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<OwnerDashboardPeriod>("6");

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await fetchOwnerDashboard());
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Não foi possível carregar o dashboard.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    return () => {
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, [load]);

  const chartRows = useMemo(() => {
    if (!data) return [];
    return filterMonthlyRevenue(data.monthlyRevenue, period).map((row) => ({
      ...row,
      label: formatMonth(row.monthStart),
      fullLabel: MONTH_YEAR.format(dateAtNoon(row.monthStart)),
    }));
  }, [data, period]);

  return (
    <DashboardLayout lockDesktopViewport>
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-3 xl:grid xl:h-full xl:min-h-0 xl:grid-cols-[minmax(0,1.12fr)_minmax(280px,0.88fr)] xl:grid-rows-[clamp(118px,15vh,150px)_clamp(76px,9vh,94px)_minmax(190px,1.15fr)_minmax(170px,0.95fr)] xl:gap-3">
        <OwnerDashboardHero />

        {loading ? (
          <OwnerDashboardSkeleton />
        ) : error || !data ? (
          <OwnerDashboardError message={error} onRetry={() => void load()} />
        ) : (
          <>
            <OwnerSummaryGrid data={data} />

            <div className="grid gap-3 xl:contents" aria-label="Detalhes do dashboard">
              <div className="min-h-[300px] xl:h-auto xl:min-h-0">
                <OwnerRevenueChart rows={chartRows} period={period} onPeriodChange={setPeriod} />
              </div>
              <div className="min-h-[300px] xl:h-auto xl:min-h-0">
                <OwnerPropertyRevenue data={data} />
              </div>
              <div className="min-h-[280px] xl:h-auto xl:min-h-0">
                <OwnerActiveContracts contracts={data.contracts} />
              </div>
              <div className="min-h-[260px] xl:h-auto xl:min-h-0">
                <OwnerRecentActivity activities={data.activities} />
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function OwnerDashboardHero() {
  return (
    <section className="relative isolate min-h-[148px] shrink-0 overflow-hidden rounded-2xl border border-amber-100 bg-[#fffaf0] shadow-[0_10px_35px_rgba(82,65,0,0.05)] sm:min-h-[132px] xl:col-span-2 xl:h-full xl:min-h-0">
      <img
        src="/assets/nox-hero-casa-chaves-banner.webp"
        alt="Casa moderna protegida pela NOX Fiança"
        className="absolute inset-y-0 right-0 -z-20 h-full w-[46%] object-cover object-[68%_center] opacity-55 sm:w-[58%] sm:opacity-100"
      />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,#fffaf0_0%,#fffaf0_43%,rgba(255,250,240,0.92)_52%,rgba(255,250,240,0.08)_85%)]" />
      <div className="absolute -bottom-24 -left-10 -z-10 h-56 w-80 rounded-full bg-yellow-300/25 blur-3xl" />

      <div className="flex h-full min-h-[148px] max-w-[78%] flex-col items-start justify-center px-4 py-3 sm:min-h-[132px] sm:max-w-2xl sm:px-6 xl:h-full xl:min-h-0 xl:px-8">
        <div className="mb-1.5 hidden items-center gap-2 text-[9px] font-semibold text-neutral-500 sm:flex xl:text-[10px]">
          <ShieldCheck size={14} className="text-[#e9ad00]" strokeWidth={1.8} />
          Segurança e tranquilidade para seus imóveis
        </div>
        <h1 className="max-w-xl text-[19px] font-black leading-[1.05] tracking-[-0.035em] text-neutral-950 sm:text-xl xl:text-[28px]">
          Acompanhe seus imóveis
          <br />e recebimentos <span className="text-[#f0b400]">em um só lugar.</span>
        </h1>
        <Button
          asChild
          variant="outline"
          className="mt-2 h-7 rounded-lg border-neutral-200 bg-white px-3 text-[10px] font-bold text-neutral-900 shadow-sm hover:border-yellow-300 hover:bg-yellow-50 xl:h-8"
        >
          <Link to="/imoveis">
            Ver meus imóveis <ArrowRight size={15} />
          </Link>
        </Button>
      </div>

      <div className="absolute bottom-3 right-[24%] hidden h-11 w-11 items-center justify-center rounded-xl border border-white/80 bg-gradient-to-br from-yellow-300 to-amber-500 text-white shadow-xl shadow-amber-500/20 lg:flex">
        <ShieldCheck size={24} strokeWidth={2.4} />
      </div>
      <div className="absolute right-6 top-1/2 hidden w-28 -translate-y-1/2 rounded-xl border border-white/80 bg-white/90 p-3 shadow-xl shadow-amber-950/10 backdrop-blur-sm lg:block">
        <div className="mb-2 flex items-center gap-2 text-[8px] font-bold uppercase tracking-wider text-neutral-400">
          <TrendingUp size={13} className="text-amber-500" /> Evolução
        </div>
        <div className="flex h-8 items-end gap-1.5">
          {[28, 38, 32, 50, 68].map((height, index) => (
            <span
              key={height + index}
              className="flex-1 rounded-t bg-gradient-to-t from-amber-500 to-yellow-300"
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

type SummaryCardProps = {
  label: string;
  value: string;
  helper: React.ReactNode;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  tone?: "default" | "success" | "warning";
};

function SummaryCard({ label, value, helper, icon: Icon, tone = "default" }: SummaryCardProps) {
  return (
    <article className="flex min-h-[104px] items-start gap-2 rounded-xl border border-neutral-200/80 bg-white p-3 shadow-[0_8px_28px_rgba(18,18,18,0.035)] sm:min-h-[96px] xl:h-full xl:min-h-0 xl:items-center xl:gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#fff6cf] text-[#efb500]">
        <Icon size={18} strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase leading-tight tracking-[0.06em] text-neutral-500">
          {label}
        </p>
        <p className="mt-1 break-words text-base font-black leading-tight tracking-tight text-neutral-950 tabular-nums xl:text-lg">
          {value}
        </p>
        <div
          className={`mt-1 line-clamp-2 text-[11px] font-semibold leading-snug ${
            tone === "success"
              ? "text-emerald-600"
              : tone === "warning"
                ? "text-amber-600"
                : "text-neutral-500"
          }`}
        >
          {helper}
        </div>
      </div>
    </article>
  );
}

function OwnerSummaryGrid({ data }: { data: OwnerDashboardData }) {
  const { summary } = data;
  const change = summary.monthChangePercent;
  return (
    <div className="grid shrink-0 grid-cols-2 gap-2 xl:col-span-2 xl:h-full xl:grid-cols-4 xl:gap-3">
      <SummaryCard
        label="Imóveis cadastrados"
        value={String(summary.propertyCount)}
        helper={
          summary.propertyCount > 0 ? (
            `${summary.activePropertyCount} com contrato ativo`
          ) : (
            <span>
              Você ainda não possui imóveis cadastrados.{" "}
              <Link
                to="/imoveis"
                className="font-extrabold text-amber-600 hover:text-amber-700"
              >
                Cadastrar imóvel
              </Link>
            </span>
          )
        }
        icon={House}
        tone={summary.activePropertyCount > 0 ? "success" : "default"}
      />
      <SummaryCard
        label="Recebimentos no mês"
        value={BRL.format(summary.currentMonthReceived)}
        helper={
          change === null ? (
            "Sem base para comparar"
          ) : (
            <span className="inline-flex items-center gap-1">
              {change >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {change > 0 ? "+" : ""}
              {change.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs mês anterior
            </span>
          )
        }
        icon={DollarSign}
        tone={change !== null && change >= 0 ? "success" : "default"}
      />
      <SummaryCard
        label="Recebimentos acumulados"
        value={BRL.format(summary.yearReceived)}
        helper={String(new Date().getFullYear())}
        icon={TrendingUp}
      />
      <SummaryCard
        label="Sinistros ativos"
        value={String(summary.activeClaimCount)}
        helper={summary.activeClaimCount === 0 ? "Tudo em dia!" : "Acompanhe os chamados"}
        icon={AlertTriangle}
        tone={summary.activeClaimCount === 0 ? "success" : "warning"}
      />
    </div>
  );
}

function DashboardCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`h-full min-h-0 overflow-hidden rounded-xl border border-neutral-200/80 bg-white p-3 shadow-[0_8px_28px_rgba(18,18,18,0.035)] xl:p-4 ${className}`}
    >
      {children}
    </section>
  );
}

function OwnerRevenueChart({
  rows,
  period,
  onPeriodChange,
}: {
  rows: Array<{ monthStart: string; amount: number; label: string; fullLabel: string }>;
  period: OwnerDashboardPeriod;
  onPeriodChange: (period: OwnerDashboardPeriod) => void;
}) {
  const hasRevenue = rows.some((row) => row.amount > 0);
  return (
    <DashboardCard>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-extrabold text-neutral-950">
            Recebimentos nos últimos meses
          </h2>
          <p className="mt-0.5 hidden text-[10px] text-neutral-400 sm:block">
            Somente valores com baixa efetiva.
          </p>
        </div>
        <label className="sr-only" htmlFor="owner-revenue-period">
          Período do gráfico
        </label>
        <select
          id="owner-revenue-period"
          value={period}
          onChange={(event) => onPeriodChange(event.target.value as OwnerDashboardPeriod)}
          className="h-7 max-w-[138px] rounded-lg border border-neutral-200 bg-white px-2 text-[9px] font-semibold text-neutral-700 outline-none focus:border-yellow-400 focus:ring-2 focus:ring-yellow-400/20 sm:max-w-none"
        >
          <option value="3">Últimos 3 meses</option>
          <option value="6">Últimos 6 meses</option>
          <option value="year">Este ano</option>
          <option value="12">Últimos 12 meses</option>
        </select>
      </div>

      {hasRevenue ? (
        <div className="h-[calc(100%-42px)] min-h-[120px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 16, right: 12, bottom: 0, left: 2 }}>
              <CartesianGrid vertical={false} stroke="#eeeeee" strokeDasharray="0" />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#8a8a8a", fontSize: 10, fontWeight: 600 }}
                dy={10}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                width={56}
                tick={{ fill: "#9a9a9a", fontSize: 9 }}
                tickFormatter={(value) => BRL_COMPACT.format(Number(value))}
              />
              <Tooltip
                content={<RevenueTooltip />}
                cursor={{ stroke: "#dedede", strokeDasharray: "4 4" }}
              />
              <Line
                type="monotone"
                dataKey="amount"
                stroke="#f2b800"
                strokeWidth={2.5}
                dot={{ r: 3.5, fill: "#ffc400", stroke: "#ffffff", strokeWidth: 2 }}
                activeDot={{ r: 5, fill: "#ffc400", stroke: "#111111", strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <EmptyState
          icon={BarChart3}
          title="Nenhum recebimento registrado neste período."
          description="O gráfico será preenchido quando houver pagamentos com baixa efetiva."
        />
      )}
    </DashboardCard>
  );
}

function RevenueTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-white shadow-xl">
      <p className="text-[10px] capitalize text-neutral-400">{row.fullLabel}</p>
      <p className="mt-1 text-xs font-bold">{BRL.format(Number(row.amount || 0))}</p>
    </div>
  );
}

function OwnerPropertyRevenue({ data }: { data: OwnerDashboardData }) {
  const items = data.propertyRevenue.slice(0, 5);
  const total = data.summary.currentMonthReceived;
  return (
    <DashboardCard>
      <h2 className="text-sm font-extrabold text-neutral-950">Recebimentos por imóvel</h2>
      <p className="mt-1 text-[11px] text-neutral-400">Participação no mês atual.</p>

      {items.length > 0 && total > 0 ? (
        <>
          <div className="mt-2 grid grid-cols-[112px_minmax(0,1fr)] items-center gap-3 xl:grid-cols-[132px_minmax(0,1fr)]">
            <div className="relative mx-auto h-[112px] w-[112px] xl:h-[132px] xl:w-[132px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={items}
                    dataKey="amount"
                    nameKey="propertyName"
                    innerRadius="53%"
                    outerRadius="74%"
                    paddingAngle={1.5}
                    stroke="none"
                  >
                    {items.map((item, index) => (
                      <Cell
                        key={item.propertyId || item.propertyName}
                        fill={DONUT_COLORS[index % DONUT_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => BRL.format(Number(value))} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="max-w-[88px] truncate text-[11px] font-black tracking-tight text-neutral-950 xl:text-xs">
                  {BRL.format(total)}
                </span>
                <span className="mt-0.5 text-[9px] font-medium text-neutral-400">Total do mês</span>
              </div>
            </div>

            <div className="space-y-1.5">
              {items.map((item, index) => (
                <div
                  key={item.propertyId || item.propertyName}
                  className="grid grid-cols-[7px_minmax(0,1fr)_auto] items-center gap-1.5 text-[9px] xl:text-[10px]"
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: DONUT_COLORS[index % DONUT_COLORS.length] }}
                  />
                  <span
                    className="truncate font-semibold text-neutral-700"
                    title={item.propertyName}
                  >
                    {item.propertyName}
                  </span>
                  <span className="whitespace-nowrap text-right font-bold text-neutral-900">
                    {BRL.format(item.amount)}{" "}
                    <small className="ml-1 font-medium text-neutral-400">
                      {item.percentage.toLocaleString("pt-BR")}%
                    </small>
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-2 flex justify-end border-t border-neutral-100 pt-2">
            <Link
              to="/carteira-cobrancas"
              className="inline-flex items-center gap-2 text-[11px] font-bold text-neutral-700 hover:text-neutral-950"
            >
              Ver detalhamento completo <ArrowRight size={13} />
            </Link>
          </div>
        </>
      ) : (
        <EmptyState
          icon={CircleDollarSign}
          title="Nenhum recebimento registrado neste período."
          description="A distribuição aparecerá após a primeira baixa."
        />
      )}
    </DashboardCard>
  );
}

function OwnerActiveContracts({ contracts }: { contracts: OwnerDashboardContract[] }) {
  const visibleContracts = contracts.slice(0, 3);
  return (
    <DashboardCard>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-extrabold text-neutral-950">Meus contratos ativos</h2>
          <p className="mt-1 text-[11px] text-neutral-400">Próximos vencimentos em destaque.</p>
        </div>
        <Link
          to="/apolices"
          className="hidden items-center gap-2 text-[11px] font-bold text-neutral-600 hover:text-neutral-950 sm:inline-flex"
        >
          Ver todos <ArrowRight size={13} />
        </Link>
      </div>

      {visibleContracts.length === 0 ? (
        <EmptyState
          icon={FileCheck2}
          title="Nenhum contrato ativo no momento."
          description="Os contratos vinculados aos seus imóveis aparecerão aqui."
        />
      ) : (
        <>
          <div className="mt-2 hidden overflow-hidden md:block">
            <table className="w-full table-fixed">
              <thead>
                <tr className="text-left text-[9px] font-bold uppercase tracking-[0.1em] text-neutral-400">
                  <th className="w-[28%] pb-1.5">Imóvel</th>
                  <th className="w-[22%] pb-1.5">Inquilino</th>
                  <th className="w-[17%] pb-1.5">Aluguel</th>
                  <th className="w-[18%] pb-1.5">Vencimento</th>
                  <th className="w-[15%] pb-1.5 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleContracts.map((contract) => (
                  <ContractTableRow key={contract.id} contract={contract} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 space-y-1.5 md:hidden">
            {visibleContracts.map((contract) => (
              <ContractMobileCard key={contract.id} contract={contract} />
            ))}
          </div>
          <div className="mt-2 flex justify-end border-t border-neutral-100 pt-2 sm:hidden">
            <Link
              to="/apolices"
              className="inline-flex items-center gap-2 text-[11px] font-bold text-neutral-700"
            >
              Ver todos os contratos <ArrowRight size={13} />
            </Link>
          </div>
        </>
      )}
    </DashboardCard>
  );
}

function ContractTableRow({ contract }: { contract: OwnerDashboardContract }) {
  return (
    <tr className="border-t border-neutral-100 text-[10px] text-neutral-600 first:border-t-0">
      <td className="py-2 pr-3 align-top">
        <p className="truncate font-bold text-neutral-900" title={contract.propertyName}>
          {contract.propertyName}
        </p>
        <p className="mt-0.5 truncate text-[9px] text-neutral-400" title={contract.location}>
          {contract.location || `Contrato ${contract.number || "—"}`}
        </p>
      </td>
      <td className="py-2 pr-3 align-top font-semibold text-neutral-700">
        <p className="truncate" title={contract.tenantName}>
          {contract.tenantName}
        </p>
      </td>
      <td className="py-2 pr-3 align-top font-semibold tabular-nums text-neutral-900">
        {BRL.format(contract.rentValue)}
      </td>
      <td className="py-2 pr-3 align-top">{formatDate(contract.nextDueDate)}</td>
      <td className="py-2 text-right align-top">
        <StatusPill status={contract.status} />
      </td>
    </tr>
  );
}

function ContractMobileCard({ contract }: { contract: OwnerDashboardContract }) {
  return (
    <article className="rounded-lg border border-neutral-100 bg-neutral-50/70 p-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[10px] font-bold text-neutral-900">{contract.propertyName}</p>
          <p className="mt-0.5 truncate text-[9px] text-neutral-500">{contract.tenantName}</p>
        </div>
        <StatusPill status={contract.status} />
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-2 border-t border-neutral-200/70 pt-1.5 text-[8px] text-neutral-500">
        <span>
          <strong className="block text-[10px] text-neutral-900">
            {BRL.format(contract.rentValue)}
          </strong>
          Aluguel
        </span>
        <span>
          <strong className="block text-[10px] text-neutral-900">
            {formatDate(contract.nextDueDate)}
          </strong>
          Próximo vencimento
        </span>
      </div>
    </article>
  );
}

function StatusPill({ status }: { status: string }) {
  const active = ["ativa", "active"].includes(status.toLowerCase());
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-[9px] font-bold ${active ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
    >
      {active ? "Ativo" : status}
    </span>
  );
}

const ACTIVITY_STYLE: Record<
  string,
  { icon: typeof CheckCircle2; background: string; color: string }
> = {
  payment: { icon: CheckCircle2, background: "bg-emerald-50", color: "text-emerald-600" },
  contract: { icon: FileText, background: "bg-blue-50", color: "text-blue-500" },
  invoice: { icon: ReceiptText, background: "bg-amber-50", color: "text-amber-500" },
  claim: { icon: AlertTriangle, background: "bg-red-50", color: "text-red-500" },
};

function OwnerRecentActivity({ activities }: { activities: OwnerDashboardActivity[] }) {
  const visibleActivities = activities.slice(0, 4);
  return (
    <DashboardCard>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-extrabold text-neutral-950">Atividades recentes</h2>
          <p className="mt-1 text-[11px] text-neutral-400">Movimentações mais importantes.</p>
        </div>
        <CalendarDays size={18} className="text-neutral-300" />
      </div>

      {visibleActivities.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="Nenhuma atividade recente."
          description="As próximas movimentações aparecerão aqui."
        />
      ) : (
        <div className="mt-2 divide-y divide-neutral-100">
          {visibleActivities.map((activity) => {
            const style = ACTIVITY_STYLE[activity.type] || ACTIVITY_STYLE.contract;
            const Icon = style.icon;
            return (
              <article key={activity.id} className="flex gap-2 py-1.5 first:pt-0">
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${style.background} ${style.color}`}
                >
                  <Icon size={13} strokeWidth={2} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="truncate text-[11px] font-bold text-neutral-900">
                      {activity.title}
                    </p>
                    <time className="shrink-0 text-[9px] text-neutral-400">
                      {formatRelativeDate(activity.occurredAt)}
                    </time>
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-[9px] leading-relaxed text-neutral-500">
                    {activity.description}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </DashboardCard>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Home;
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-[calc(100%-36px)] min-h-0 flex-col items-center justify-center px-5 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-50 text-neutral-300">
        <Icon size={22} strokeWidth={1.7} />
      </div>
      <p className="mt-3 text-xs font-bold text-neutral-800">{title}</p>
      <p className="mt-1 max-w-xs text-[10px] leading-relaxed text-neutral-400">{description}</p>
    </div>
  );
}

function OwnerDashboardError({
  message,
  onRetry,
}: {
  message: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-2xl border border-red-100 bg-white px-6 py-6 text-center shadow-sm lg:col-span-2 lg:row-span-3">
      <AlertTriangle className="mx-auto text-red-500" size={30} />
      <h2 className="mt-4 text-base font-bold text-neutral-900">
        Não foi possível carregar o dashboard.
      </h2>
      <p className="mx-auto mt-2 max-w-lg text-sm text-neutral-500">
        {message || "Tente novamente em alguns instantes."}
      </p>
      <Button
        onClick={onRetry}
        className="mt-5 gap-2 rounded-xl bg-neutral-950 text-white hover:bg-neutral-800"
      >
        <RefreshCw size={15} /> Tentar novamente
      </Button>
    </div>
  );
}

function OwnerDashboardSkeleton() {
  return (
    <div
      className="grid gap-3 xl:col-span-2 xl:row-span-3 xl:min-h-0 xl:grid-cols-2 xl:grid-rows-[94px_minmax(0,1fr)_minmax(0,0.9fr)]"
      aria-label="Carregando dashboard"
    >
      <div className="grid grid-cols-2 gap-2 xl:col-span-2 xl:grid-cols-4 xl:gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="min-h-[104px] animate-pulse rounded-xl border border-neutral-200 bg-white p-3 xl:h-full xl:min-h-0"
          >
            <div className="h-10 w-10 rounded-xl bg-neutral-100" />
            <div className="ml-14 -mt-9 h-3 w-28 rounded bg-neutral-100" />
            <div className="ml-14 mt-3 h-6 w-32 rounded bg-neutral-100" />
          </div>
        ))}
      </div>
      <div className="grid gap-3 xl:contents">
        <div className="h-[300px] animate-pulse rounded-xl border border-neutral-200 bg-white xl:h-full" />
        <div className="h-[300px] animate-pulse rounded-xl border border-neutral-200 bg-white xl:h-full" />
      </div>
      <div className="h-[280px] animate-pulse rounded-xl border border-neutral-200 bg-white xl:h-full" />
      <div className="h-[260px] animate-pulse rounded-xl border border-neutral-200 bg-white xl:h-full" />
    </div>
  );
}
