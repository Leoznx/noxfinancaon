import { Link } from "@tanstack/react-router";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CalendarDays,
  DollarSign,
  FileText,
  Search,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState, type ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchImobiliariaDashboard,
  formatCurrency,
  type ImobiliariaDashboardData,
} from "@/lib/imobiliaria-dashboard";

type Icon = ComponentType<{ className?: string; size?: number; strokeWidth?: number }>;

export function ImobiliariaDashboard({ profileId, email }: { profileId: string; email: string }) {
  const [data, setData] = useState<ImobiliariaDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartPeriod, setChartPeriod] = useState("6");

  const load = useCallback(async () => {
    setError(null);
    try {
      const dashboardData = await fetchImobiliariaDashboard(profileId, email);
      setData(dashboardData);
    } catch (cause) {
      const failure = cause as { message?: string; details?: string; hint?: string; code?: string };
      console.error(
        `[ImobiliariaDashboard] ${failure.code || "erro"}: ${failure.message || "falha desconhecida"}${failure.details ? ` | ${failure.details}` : ""}${failure.hint ? ` | ${failure.hint}` : ""}`,
      );
      setError("Não foi possível carregar os dados da imobiliária agora.");
    } finally {
      setLoading(false);
    }
  }, [email, profileId]);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    const channel = supabase
      .channel(`agency-dashboard-live-${profileId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "consultas_credito" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "apolices" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "comissoes" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "documentos_contrato" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "faturas_inquilino" }, () => void load())
      .subscribe();
    return () => {
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [load, profileId]);

  if (loading) return <DashboardSkeleton />;
  if (error || !data) return <DashboardError message={error ?? "Dados indisponíveis."} onRetry={load} />;

  const displayedMonths = data.months.slice(-Number(chartPeriod));

  return (
    <div className="mx-auto w-full max-w-[1580px] space-y-3.5 animate-in fade-in duration-300 xl:grid xl:h-full xl:min-h-0 xl:grid-rows-[260px_84px_minmax(0,1fr)] xl:gap-2.5 xl:space-y-0">
      <HeroBanner />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:h-full xl:grid-cols-4 xl:gap-2.5">
        <MetricCard icon={Search} label="Consultas pendentes" value={String(data.stats.consultasPendentes)} trend={data.trends.consultas} />
        <MetricCard icon={FileText} label="Apólices ativas" value={String(data.stats.apolicesAtivas)} trend={data.trends.apolices} />
        <MetricCard icon={Users} label="Inquilinos sob gestão" value={String(data.stats.inquilinosGestao)} trend={data.trends.inquilinos} />
        <MetricCard icon={DollarSign} label="Comissões acumuladas" value={formatCurrency(data.stats.comissoesAcumuladas)} trend={data.trends.comissoes} />
      </section>

      <section className="grid gap-3 xl:min-h-0 xl:grid-cols-[1.18fr_0.9fr_1fr] xl:gap-2.5">
        <DashboardPanel className="min-h-[480px] xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:overflow-hidden">
          <PanelHeader title="Consultas e contratos por mês">
            <CompactSelect value={chartPeriod} onValueChange={setChartPeriod} items={[{ value: "6", label: "Últimos 6 meses" }, { value: "12", label: "Últimos 12 meses" }]} />
          </PanelHeader>
          <div className="mt-3 h-[410px] min-h-0 xl:mt-2 xl:h-auto xl:flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={displayedMonths} margin={{ top: 20, right: 14, left: -18, bottom: 12 }}>
                <CartesianGrid stroke="#EEEEEE" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#858585", fontSize: 10 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "#A3A3A3", fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
                <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 10, paddingTop: 8 }} />
                <Line type="monotone" dataKey="consultas" name="Consultas" stroke="#FFC400" strokeWidth={2.5} dot={{ r: 3, fill: "#FFC400", strokeWidth: 0 }} activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey="contratos" name="Contratos fechados" stroke="#171717" strokeWidth={2.5} dot={{ r: 3, fill: "#171717", strokeWidth: 0 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </DashboardPanel>

        <DashboardPanel className="min-h-[520px] xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:overflow-hidden">
          <PanelHeader title="Status das apólices" />
          <PolicyStatusChart data={data.policyStatus} />
        </DashboardPanel>

        <InvoicePanel invoices={data.invoices} />
      </section>
    </div>
  );
}

function HeroBanner() {
  return (
    <section className="relative min-h-[380px] overflow-hidden rounded-[24px] border border-amber-100 bg-[radial-gradient(circle_at_88%_85%,rgba(255,196,0,0.2),transparent_34%),linear-gradient(112deg,#fffdf8_0%,#ffffff_54%,#fff7d8_100%)] shadow-[0_8px_30px_rgba(0,0,0,0.035)] sm:min-h-[300px] xl:h-full xl:min-h-0">
      <img
        src="/dashboard/agency-panel-art.png"
        alt="Equipe da imobiliária NOX diante de um empreendimento"
        className="pointer-events-none absolute bottom-0 left-1/2 z-10 max-h-[62%] w-[96%] max-w-[370px] -translate-x-1/2 select-none object-contain object-bottom sm:left-[2%] sm:h-[96%] sm:max-h-none sm:w-[50%] sm:max-w-none sm:translate-x-0 xl:h-full xl:w-[48%]"
      />
      <img
        src="/dashboard/agency-panel-copy.png"
        alt="Sua imobiliária mais ágil, mais profissional"
        className="pointer-events-none absolute right-1/2 top-4 z-20 w-[90%] max-w-[360px] translate-x-1/2 select-none object-contain sm:right-[3%] sm:top-1/2 sm:w-[52%] sm:max-w-[560px] sm:translate-x-0 sm:-translate-y-1/2 xl:right-[4%] xl:w-[46%] xl:max-w-[650px]"
      />
    </section>
  );
}

function MetricCard({ icon: Icon, label, value, trend: trendValue }: { icon: Icon; label: string; value: string; trend: number }) {
  const positive = trendValue >= 0;
  return (
    <article className="group rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-[0_5px_22px_rgba(0,0,0,0.035)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgba(0,0,0,0.06)] xl:h-full xl:overflow-hidden xl:p-2.5">
      <div className="flex items-center gap-4 xl:h-full xl:gap-2.5">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-[#E7B300] transition-colors group-hover:bg-[#FFC400] group-hover:text-neutral-950 xl:h-9 xl:w-9">
          <Icon size={22} strokeWidth={1.8} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-neutral-500">{label}</p>
          <p className="mt-0.5 truncate text-2xl font-black tracking-tight tabular-nums text-neutral-950 xl:text-xl">{value}</p>
          <p className={`mt-1 flex items-center gap-1 text-[10px] font-semibold xl:mt-0.5 xl:text-[9px] ${positive ? "text-emerald-600" : "text-red-500"}`}>
            <TrendingUp size={11} className={positive ? "" : "rotate-180"} />
            {positive ? "+" : ""}{trendValue}% <span className="font-normal text-neutral-400">vs mês anterior</span>
          </p>
        </div>
      </div>
    </article>
  );
}

function DashboardPanel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <article className={`rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-[0_5px_22px_rgba(0,0,0,0.035)] xl:p-3 ${className}`}>{children}</article>;
}

function PanelHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-sm font-black text-neutral-950">{title}</h3>
      {children}
    </div>
  );
}

function CompactSelect({ value, onValueChange, items }: { value: string; onValueChange: (value: string) => void; items: { value: string; label: string }[] }) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="h-8 w-auto min-w-[112px] rounded-lg border-neutral-200 bg-white px-2.5 text-[10px] shadow-none">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => <SelectItem key={item.value} value={item.value} className="text-xs">{item.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function PolicyStatusChart({ data }: { data: ImobiliariaDashboardData["policyStatus"] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <div className="mt-3 flex min-h-[440px] flex-1 flex-col xl:mt-2 xl:min-h-0">
      <div className="relative min-h-[250px] flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius="55%" outerRadius="78%" paddingAngle={1} stroke="#FFFFFF" strokeWidth={2} animationDuration={650}>
              {data.map((item) => <Cell key={item.key} fill={item.color} />)}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <strong className="text-2xl font-black tabular-nums text-neutral-950">{total}</strong>
          <span className="text-[10px] text-neutral-500">Total</span>
        </div>
      </div>
      <div className="mx-auto mb-3 w-full max-w-[330px] shrink-0 divide-y divide-amber-100 overflow-hidden rounded-2xl border border-amber-300 bg-[linear-gradient(145deg,#fffef9,#fff8dc)] p-2.5 shadow-[0_8px_24px_rgba(217,169,0,0.08)]">
        {data.map((item) => (
          <div key={item.key} className="flex items-center gap-2.5 px-3 py-2.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: item.color }} />
            <p className="min-w-0 text-[11px] text-neutral-600">
              <strong className="font-extrabold text-neutral-800">{item.label}</strong>{" "}
              <span className="tabular-nums">{item.value} ({total ? Math.round((item.value / total) * 100) : 0}%)</span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function InvoicePanel({ invoices }: { invoices: ImobiliariaDashboardData["invoices"] }) {
  return (
    <DashboardPanel className="flex min-h-[520px] flex-col overflow-hidden xl:h-full xl:min-h-0">
      <PanelHeader title="Próximos vencimentos">
        <Button asChild variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-[10px] text-neutral-500">
          <Link to="/faturas-inquilinos">Ver todos</Link>
        </Button>
      </PanelHeader>
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-color:#d4d4d4_transparent] [scrollbar-width:thin]">
        {invoices.length ? (
          <div className="space-y-2.5">
            {invoices.map((invoice) => (
              <article key={invoice.id} className="flex items-center gap-3 rounded-xl border border-neutral-100 bg-neutral-50/70 p-3 transition-colors hover:border-amber-200 hover:bg-amber-50/40">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700">
                  <CalendarDays size={17} strokeWidth={1.8} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-bold text-neutral-800">Fatura #{invoice.number}</p>
                  <p className="mt-0.5 text-[10px] text-neutral-400">Vencimento: {formatDate(invoice.dueDate)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[11px] font-black tabular-nums text-neutral-900">{formatCurrency(invoice.value)}</p>
                  <span className="mt-1 inline-flex rounded-full bg-amber-50 px-2 py-1 text-[9px] font-bold text-amber-700">
                    {invoice.daysUntilDue <= 0 ? "Vence hoje" : `Em ${invoice.daysUntilDue} ${invoice.daysUntilDue === 1 ? "dia" : "dias"}`}
                  </span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="flex h-full min-h-[330px] flex-col items-center justify-center px-6 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 text-[#D9A900]">
              <CalendarDays size={27} strokeWidth={1.6} />
            </div>
            <p className="text-sm font-black text-neutral-800">Nenhum vencimento futuro</p>
            <p className="mt-1 max-w-[240px] text-[11px] leading-relaxed text-neutral-400">As próximas faturas aparecerão aqui em ordem de vencimento.</p>
          </div>
        )}
      </div>
    </DashboardPanel>
  );
}

function ChartTooltip({ active, payload, label, currency = false }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 shadow-xl">
      {label && <p className="mb-1.5 text-[10px] font-bold text-neutral-500">{label}</p>}
      {payload.map((item: any) => (
        <p key={item.dataKey || item.name} className="text-[11px] font-semibold" style={{ color: item.color || item.payload?.color }}>
          {item.name}: {currency ? formatCurrency(Number(item.value || 0)) : item.value}
        </p>
      ))}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-[1580px] animate-pulse space-y-3.5">
      <div className="h-[380px] rounded-[24px] bg-neutral-100 sm:h-[300px] xl:h-[260px]" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-24 rounded-2xl bg-neutral-100" />)}</div>
      <div className="grid gap-3 xl:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <div key={index} className="h-[520px] rounded-2xl bg-neutral-100" />)}</div>
    </div>
  );
}

function DashboardError({ message, onRetry }: { message: string; onRetry: () => Promise<void> }) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-red-100 bg-white p-8 text-center">
      <ShieldCheck className="mb-3 h-10 w-10 text-neutral-300" />
      <h2 className="font-black text-neutral-950">Não foi possível abrir o painel</h2>
      <p className="mt-1 text-sm text-neutral-500">{message}</p>
      <Button onClick={() => void onRetry()} className="mt-4 rounded-lg bg-neutral-950 text-white">Tentar novamente</Button>
    </div>
  );
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR");
}
