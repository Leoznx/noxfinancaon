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
  ArrowRight,
  CalendarDays,
  Crown,
  DollarSign,
  FileCheck2,
  Search,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchCorretorDashboard,
  formatCurrency,
  type ImobiliariaDashboardData,
} from "@/lib/imobiliaria-dashboard";
import { fetchNivelInfo, type NivelInfo } from "@/lib/niveis-parceria";

type Icon = ComponentType<{ className?: string; size?: number; strokeWidth?: number }>;

const LEVEL_BADGE_ASSETS: Record<string, string> = {
  BRONZE: "/assets/nox-icon-nivel-bronze.webp",
  PRATA: "/assets/nox-icon-nivel-prata.webp",
  OURO: "/assets/nox-icon-nivel-ouro.webp",
  DIAMANTE: "/assets/nox-icon-nivel-diamante.webp",
};

function levelBadge(level: string) {
  const normalized = level.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
  return LEVEL_BADGE_ASSETS[normalized] ?? LEVEL_BADGE_ASSETS.BRONZE;
}

export function CorretorDashboard({ profileId }: { profileId: string }) {
  const [data, setData] = useState<ImobiliariaDashboardData | null>(null);
  const [nivel, setNivel] = useState<NivelInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartPeriod, setChartPeriod] = useState(6);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [dashboardData, levelData] = await Promise.all([
        fetchCorretorDashboard(profileId),
        fetchNivelInfo(profileId, "corretor"),
      ]);
      setData(dashboardData);
      setNivel(levelData);
    } catch (cause) {
      console.error("[CorretorDashboard] falha ao carregar painel", cause);
      setError("Não foi possível carregar os indicadores do corretor agora.");
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    const channel = supabase
      .channel(`broker-dashboard-live-${profileId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "consultas_credito" }, onFocus)
      .on("postgres_changes", { event: "*", schema: "public", table: "apolices" }, onFocus)
      .on("postgres_changes", { event: "*", schema: "public", table: "comissoes" }, onFocus)
      .on("postgres_changes", { event: "*", schema: "public", table: "faturas_inquilino" }, onFocus)
      .subscribe();
    return () => {
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [load, profileId]);

  const overview = useMemo(() => {
    if (!data) return null;
    const current = data.months.at(-1) ?? { comissoes: 0, contratos: 0 };
    const ticket = current.contratos > 0 ? current.comissoes / current.contratos : 0;
    return { commission: current.comissoes, contracts: current.contratos, ticket };
  }, [data]);

  if (loading) return <DashboardSkeleton />;
  if (error || !data || !overview) return <DashboardError message={error ?? "Dados indisponíveis."} onRetry={load} />;

  const months = data.months.slice(-chartPeriod);

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-3.5 animate-in fade-in duration-300 xl:grid xl:h-full xl:min-h-0 xl:grid-rows-[220px_84px_minmax(330px,1fr)_70px] xl:gap-2.5 xl:space-y-0 xl:overflow-hidden">
      <HeroBanner data={data} overview={overview} />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:h-full xl:grid-cols-4 xl:gap-2.5">
        <MetricCard to="/consultas" icon={Search} label="Consultas pendentes" value={String(data.stats.consultasPendentes)} trend={data.trends.consultas} />
        <MetricCard to="/apolices" icon={FileCheck2} label="Apólices ativas" value={String(data.stats.apolicesAtivas)} trend={data.trends.apolices} />
        <MetricCard to="/apolices" icon={Users} label="Inquilinos sob gestão" value={String(data.stats.inquilinosGestao)} trend={data.trends.inquilinos} />
        <MetricCard to="/minhas-comissoes" icon={DollarSign} label="Comissões acumuladas" value={formatCurrency(data.stats.comissoesAcumuladas)} trend={data.trends.comissoes} />
      </section>

      <section className="grid gap-3 xl:min-h-0 xl:grid-cols-[1.22fr_0.78fr_0.98fr] xl:gap-2.5">
        <Panel className="min-h-[430px] xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:overflow-hidden">
          <PanelHeader title="Consultas e contratos por mês">
            <div className="flex rounded-lg border border-neutral-200 bg-neutral-50 p-0.5" role="radiogroup" aria-label="Período do gráfico">
              {[6, 12].map((period) => (
                <button
                  key={period}
                  type="button"
                  role="radio"
                  aria-checked={chartPeriod === period}
                  onClick={() => setChartPeriod(period)}
                  className={`rounded-md px-2.5 py-1 text-[9px] font-bold transition ${chartPeriod === period ? "bg-neutral-950 text-white" : "text-neutral-500 hover:text-neutral-900"}`}
                >
                  {period} meses
                </button>
              ))}
            </div>
          </PanelHeader>
          <div className="mt-2 h-[350px] min-h-0 xl:flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={months} margin={{ top: 20, right: 12, left: -20, bottom: 6 }}>
                <CartesianGrid stroke="#EEEEEE" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#858585", fontSize: 10 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "#A3A3A3", fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
                <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 10, paddingTop: 6 }} />
                <Line type="monotone" dataKey="consultas" name="Consultas" stroke="#F4B400" strokeWidth={2.6} dot={{ r: 3, fill: "#F4B400", strokeWidth: 0 }} activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey="contratos" name="Contratos fechados" stroke="#171717" strokeWidth={2.6} dot={{ r: 3, fill: "#171717", strokeWidth: 0 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel className="min-h-[430px] xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:overflow-hidden">
          <PanelHeader title="Status das apólices" />
          <PolicyStatus data={data.policyStatus} />
        </Panel>

        <InvoicePanel invoices={data.invoices} />
      </section>

      <CareerProgress nivel={nivel} />
    </div>
  );
}

function HeroBanner({
  data,
  overview,
}: {
  data: ImobiliariaDashboardData;
  overview: { commission: number; contracts: number; ticket: number };
}) {
  return (
    <section className="relative min-h-[390px] overflow-hidden rounded-[24px] border border-amber-100 bg-[#fffdf8] shadow-[0_10px_34px_rgba(58,44,4,0.06)] xl:h-full xl:min-h-0">
      <img
        src="/dashboard/broker-performance-hero.png"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute left-[-10%] top-[31%] h-auto w-[118%] max-w-none select-none sm:left-[31%] sm:top-[2%] sm:w-[48%] xl:left-[41%] xl:top-[-15%] xl:h-[290px] xl:w-auto 2xl:left-[49%]"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,253,248,1)_0%,rgba(255,253,248,0.98)_27%,rgba(255,253,248,0.72)_34%,rgba(255,253,248,0.04)_47%,rgba(255,253,248,0)_66%,rgba(255,253,248,0.88)_88%,rgba(255,253,248,1)_100%)]" />

      <div className="relative z-10 flex h-full max-w-[560px] flex-col justify-center px-6 py-4 sm:px-9 xl:px-10">
        <img
          src="/dashboard/broker-performance-copy.png"
          alt="Quanto mais contratos, maior sua comissão. Acompanhe sua performance, contratos e ganhos com mais praticidade."
          className="w-full max-w-[520px] select-none object-contain"
        />
        <Link
          to="/consultas/nova"
          className="-mt-4 inline-flex h-9 w-fit items-center gap-3 rounded-xl bg-[#FFC400] px-5 text-[11px] font-black text-neutral-950 shadow-[0_8px_20px_rgba(255,196,0,0.24)] transition hover:-translate-y-0.5 hover:bg-[#FFD633]"
        >
          Nova Consulta
          <ArrowRight size={15} strokeWidth={2.4} />
        </Link>
      </div>

      <div className="relative z-20 mt-[235px] grid gap-2 p-4 sm:absolute sm:bottom-3 sm:right-3 sm:mt-0 sm:w-[210px] sm:p-0 xl:w-[202px]">
        <HeroMetric icon={Crown} label="Comissão do mês" value={formatCurrency(overview.commission)} trend={data.trends.comissoes} />
        <HeroMetric icon={Users} label="Contratos fechados" value={String(overview.contracts)} trend={data.trends.apolices} />
        <HeroMetric icon={CalendarDays} label="Ticket médio" value={formatCurrency(overview.ticket)} trend={data.trends.comissoes} />
      </div>
    </section>
  );
}

function HeroMetric({ icon: Icon, label, value, trend }: { icon: Icon; label: string; value: string; trend: number }) {
  return (
    <article className="flex min-h-[58px] items-center gap-2 rounded-xl border border-white/90 bg-white/94 px-2.5 py-1.5 shadow-[0_8px_24px_rgba(45,34,0,0.1)] backdrop-blur-md">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-[#ECAE00]">
        <Icon size={16} strokeWidth={1.9} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[8px] font-semibold text-neutral-500">{label}</p>
        <p className="truncate text-[13px] font-black tabular-nums text-neutral-950">{value}</p>
        <Trend value={trend} compact />
      </div>
    </article>
  );
}

function MetricCard({ to, icon: Icon, label, value, trend }: { to: string; icon: Icon; label: string; value: string; trend: number }) {
  return (
    <Link
      to={to as never}
      className="group flex items-center gap-3 rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-[0_5px_22px_rgba(0,0,0,0.035)] transition hover:-translate-y-0.5 hover:border-amber-200 hover:shadow-[0_10px_28px_rgba(0,0,0,0.06)] xl:h-full xl:p-2.5"
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-[#E7B300] transition group-hover:bg-[#FFC400] group-hover:text-neutral-950 xl:h-10 xl:w-10">
        <Icon size={21} strokeWidth={1.8} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium text-neutral-500">{label}</p>
        <p className="truncate text-xl font-black tracking-tight tabular-nums text-neutral-950">{value}</p>
        <Trend value={trend} />
      </div>
      <ArrowRight size={16} className="shrink-0 text-neutral-400 transition group-hover:translate-x-0.5 group-hover:text-neutral-950" />
    </Link>
  );
}

function Trend({ value, compact = false }: { value: number; compact?: boolean }) {
  const positive = value >= 0;
  return (
    <p className={`${compact ? "mt-0 text-[8px]" : "mt-0.5 text-[9px]"} flex items-center gap-1 font-bold ${positive ? "text-emerald-600" : "text-red-500"}`}>
      <TrendingUp size={compact ? 9 : 10} className={positive ? "" : "rotate-180"} />
      {positive ? "+" : ""}{value}% <span className="font-normal text-neutral-400">vs mês anterior</span>
    </p>
  );
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <article className={`rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-[0_5px_22px_rgba(0,0,0,0.035)] xl:p-3 ${className}`}>{children}</article>;
}

function PanelHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="flex min-h-7 items-center justify-between gap-3"><h2 className="text-[13px] font-black text-neutral-950">{title}</h2>{children}</div>;
}

function PolicyStatus({ data }: { data: ImobiliariaDashboardData["policyStatus"] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const chartData = total ? data : [{ key: "empty", label: "Sem apólices", value: 1, color: "#E8E8E8" }];
  return (
    <div className="mt-1 flex min-h-0 flex-1 flex-col" role="img" aria-label={`Status das apólices: ${data.map((item) => `${item.label} ${item.value}`).join(", ")}`}>
      <div className="relative min-h-[230px] flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={chartData} dataKey="value" nameKey="label" innerRadius="56%" outerRadius="78%" paddingAngle={total ? 1 : 0} stroke="#fff" strokeWidth={2}>
              {chartData.map((item) => <Cell key={item.key} fill={item.color} />)}
            </Pie>
            {total ? <Tooltip content={<ChartTooltip />} /> : null}
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <strong className="text-2xl font-black tabular-nums text-neutral-950">{total}</strong>
          <span className="text-[9px] text-neutral-500">Total</span>
        </div>
      </div>
      <div className="grid shrink-0 gap-1.5">
        {data.map((item) => (
          <div key={item.key} className="flex items-center gap-2 text-[9px] text-neutral-500">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
            <strong className="flex-1 text-neutral-700">{item.label}</strong>
            <span className="tabular-nums">{item.value} ({total ? Math.round((item.value / total) * 100) : 0}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function InvoicePanel({ invoices }: { invoices: ImobiliariaDashboardData["invoices"] }) {
  return (
    <Panel className="flex min-h-[430px] flex-col overflow-hidden xl:h-full xl:min-h-0">
      <PanelHeader title="Próximos vencimentos">
        <Link to="/faturas-inquilinos" className="text-[9px] font-bold text-neutral-500 hover:text-neutral-950">Ver todos</Link>
      </PanelHeader>
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-color:#d4d4d4_transparent] [scrollbar-width:thin]">
        {invoices.length ? (
          <div className="divide-y divide-neutral-100">
            {invoices.map((invoice) => (
              <article key={invoice.id} className="flex items-center gap-2.5 py-2.5 first:pt-1.5">
                <div className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50 leading-none">
                  <strong className="text-[12px] font-black text-neutral-900">{new Date(`${invoice.dueDate}T12:00:00`).getDate()}</strong>
                  <span className="text-[7px] font-black uppercase text-[#E7B300]">{new Date(`${invoice.dueDate}T12:00:00`).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[10px] font-extrabold text-neutral-800">{invoice.tenant}</p>
                  <p className="mt-0.5 truncate text-[8px] text-neutral-400">{invoice.property}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[9px] font-black tabular-nums text-neutral-900">{formatCurrency(invoice.value)}</p>
                  <span className="mt-1 inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[8px] font-bold text-amber-700">
                    {invoice.daysUntilDue === 0 ? "Hoje" : `${invoice.daysUntilDue} dias`}
                  </span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <CalendarDays className="mb-2 text-amber-400" size={28} />
            <p className="text-xs font-black text-neutral-800">Nenhum vencimento futuro</p>
            <p className="mt-1 text-[9px] text-neutral-400">As próximas faturas aparecerão aqui.</p>
          </div>
        )}
      </div>
      <Link to="/faturas-inquilinos" className="mt-2 flex h-8 shrink-0 items-center justify-center gap-2 rounded-lg border border-amber-300 text-[9px] font-bold text-neutral-800 transition hover:bg-amber-50">
        <CalendarDays size={13} /> Ver todos os vencimentos
      </Link>
    </Panel>
  );
}

function CareerProgress({ nivel }: { nivel: NivelInfo | null }) {
  const currentName = String(nivel?.nivelAtual?.nome_nivel ?? "Bronze");
  const nextName = nivel?.proximoNivel?.nome_nivel ? String(nivel.proximoNivel.nome_nivel) : null;
  const currentContracts = nivel?.contratosAtivos ?? 0;
  const currentFloor = Number(nivel?.nivelAtual?.min_contratos ?? 0);
  const nextTarget = Number(nivel?.proximoNivel?.min_contratos ?? (currentContracts || 1));
  const progress = nextName
    ? Math.max(0, Math.min(100, Math.round(((currentContracts - currentFloor) / Math.max(1, nextTarget - currentFloor)) * 100)))
    : 100;

  return (
    <Link to="/plano-carreira" className="group flex min-h-[70px] items-center gap-4 rounded-2xl border border-neutral-200/80 bg-white px-5 shadow-[0_5px_22px_rgba(0,0,0,0.035)] transition hover:border-amber-200 xl:h-full xl:min-h-0">
      <img
        src={levelBadge(currentName)}
        alt={`Placa do nível ${currentName}`}
        className="h-12 w-12 shrink-0 object-contain drop-shadow-[0_5px_7px_rgba(0,0,0,0.16)] transition-transform group-hover:scale-105"
      />
      <div className="w-[210px] shrink-0 border-r border-neutral-200 pr-4">
        <p className="text-xs font-black text-neutral-950">Plano de Carreira</p>
        <p className="mt-0.5 text-[9px] text-neutral-500">Acompanhe seu progresso e desbloqueie benefícios.</p>
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center justify-between text-[9px] text-neutral-500">
          <span>Progresso para {nextName ? <strong className="text-neutral-800">{nextName}</strong> : "o nível máximo"}</span>
          <strong className="text-neutral-800">{progress}% concluído</strong>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-neutral-200"><div className="h-full rounded-full bg-[linear-gradient(90deg,#F2B600,#FFD83D)]" style={{ width: `${progress}%` }} /></div>
      </div>
      <div className="shrink-0 text-right text-[9px] text-neutral-500">
        <strong className="block text-[11px] text-neutral-900">{currentName}</strong>
        {nextName ? `${currentContracts} / ${nextTarget} contratos` : `${currentContracts} contratos`}
      </div>
      <ArrowRight size={16} className="text-neutral-400 transition group-hover:translate-x-0.5" />
    </Link>
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 shadow-xl">
      {label ? <p className="mb-1 text-[10px] font-bold text-neutral-500">{label}</p> : null}
      {payload.map((item: any) => <p key={item.dataKey || item.name} className="text-[10px] font-semibold" style={{ color: item.color || item.payload?.color }}>{item.name}: {item.value}</p>)}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-[1600px] animate-pulse space-y-3">
      <div className="h-[220px] rounded-[24px] bg-neutral-100" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-20 rounded-2xl bg-neutral-100" />)}</div>
      <div className="grid gap-3 xl:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <div key={index} className="h-[430px] rounded-2xl bg-neutral-100" />)}</div>
    </div>
  );
}

function DashboardError({ message, onRetry }: { message: string; onRetry: () => Promise<void> }) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-red-100 bg-white p-8 text-center">
      <ShieldCheck className="mb-3 h-10 w-10 text-neutral-300" />
      <h2 className="font-black text-neutral-950">Não foi possível abrir o painel</h2>
      <p className="mt-1 text-sm text-neutral-500">{message}</p>
      <button type="button" onClick={() => void onRetry()} className="mt-4 rounded-lg bg-neutral-950 px-4 py-2 text-xs font-bold text-white">Tentar novamente</button>
    </div>
  );
}
