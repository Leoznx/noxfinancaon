import { Link } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
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
  CheckCircle2,
  DollarSign,
  FileCheck2,
  FileText,
  Search,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchNivelInfo, type NivelInfo } from "@/lib/niveis-parceria";
import {
  fetchImobiliariaDashboard,
  formatCurrency,
  type ImobiliariaDashboardData,
} from "@/lib/imobiliaria-dashboard";

type Icon = ComponentType<{ className?: string; size?: number; strokeWidth?: number }>;

const LEVEL_ASSET: Record<string, string> = {
  BRONZE: "/assets/nox-icon-fidelidade-bronze.webp",
  PRATA: "/assets/nox-icon-fidelidade-prata.webp",
  OURO: "/assets/nox-icon-fidelidade-ouro.webp",
  DIAMANTE: "/assets/nox-icon-fidelidade-diamante.webp",
};

export function ImobiliariaDashboard({ profileId, email }: { profileId: string; email: string }) {
  const [data, setData] = useState<ImobiliariaDashboardData | null>(null);
  const [level, setLevel] = useState<NivelInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartPeriod, setChartPeriod] = useState("6");
  const [commissionPeriod, setCommissionPeriod] = useState("year");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [dashboardData, levelData] = await Promise.all([
        fetchImobiliariaDashboard(profileId, email),
        fetchNivelInfo(profileId, "imobiliaria"),
      ]);
      setData(dashboardData);
      setLevel(levelData);
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

  const levelName = level?.nivelAtual?.nome_nivel?.toUpperCase() || "BRONZE";
  const levelTarget = Number(level?.proximoNivel?.min_contratos || level?.contratosAtivos || 1);
  const activeContracts = level?.contratosAtivos ?? 0;
  const levelProgress = level?.proximoNivel ? Math.min(100, (activeContracts / levelTarget) * 100) : 100;
  const remaining = Math.max(0, levelTarget - activeContracts);
  const displayedMonths = data.months.slice(-Number(chartPeriod));
  const currentYear = String(new Date().getFullYear());
  const commissionMonths = commissionPeriod === "year"
    ? data.months.filter((month) => month.key.startsWith(currentYear))
    : data.months;

  return (
    <div className="mx-auto w-full max-w-[1580px] space-y-3.5 animate-in fade-in duration-300 xl:grid xl:h-full xl:min-h-0 xl:grid-rows-[160px_82px_76px_minmax(0,1.15fr)_minmax(0,0.85fr)] xl:gap-2.5 xl:space-y-0">
      <HeroBanner />

      <section className="grid gap-3 rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-[0_5px_22px_rgba(0,0,0,0.035)] md:grid-cols-[minmax(230px,320px)_1fr_auto] md:items-center md:px-6 xl:h-full xl:gap-2 xl:overflow-hidden xl:px-4 xl:py-2">
        <div className="flex min-w-0 items-center gap-4 xl:gap-3">
          <img
            src={LEVEL_ASSET[levelName] ?? LEVEL_ASSET.BRONZE}
            alt={`Nível ${levelName}`}
            className="h-16 w-16 shrink-0 object-contain sm:h-[72px] sm:w-[72px] xl:h-14 xl:w-14"
          />
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.22em] text-neutral-400">Status de parceria</p>
            <h2 className="truncate text-xl font-black tracking-tight text-neutral-950 xl:text-lg">{levelName}</h2>
            <span className="mt-1 inline-flex rounded-full bg-neutral-950 px-3 py-1 text-[10px] font-extrabold text-white">
              {Number(level?.nivelAtual?.percentual_comissao || 0).toLocaleString("pt-BR")}% comissão
            </span>
          </div>
        </div>

        <div className="min-w-0 space-y-2 md:px-5 xl:space-y-1.5">
          <p className="text-[9px] font-black uppercase tracking-[0.22em] text-neutral-400">Progresso para o próximo nível</p>
          <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full bg-[#FFC400] transition-[width] duration-700 ease-out"
              style={{ width: `${levelProgress}%` }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 md:min-w-[230px]">
          <div>
            <p className="text-sm font-black tabular-nums text-neutral-950">{activeContracts} / {levelTarget} contratos</p>
            <p className="mt-1 text-xs text-neutral-500">
              {level?.proximoNivel ? <>Faltam <strong className="text-[#D7A600]">{remaining} contratos</strong> para {level.proximoNivel.nome_nivel}</> : "Nível máximo alcançado"}
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="h-9 shrink-0 rounded-lg text-xs font-bold">
            <Link to="/plano-carreira">Ver detalhes</Link>
          </Button>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:h-full xl:grid-cols-4 xl:gap-2.5">
        <MetricCard icon={Search} label="Consultas pendentes" value={String(data.stats.consultasPendentes)} trend={data.trends.consultas} />
        <MetricCard icon={FileText} label="Apólices ativas" value={String(data.stats.apolicesAtivas)} trend={data.trends.apolices} />
        <MetricCard icon={Users} label="Inquilinos sob gestão" value={String(data.stats.inquilinosGestao)} trend={data.trends.inquilinos} />
        <MetricCard icon={DollarSign} label="Comissões acumuladas" value={formatCurrency(data.stats.comissoesAcumuladas)} trend={data.trends.comissoes} />
      </section>

      <section className="grid gap-3 xl:min-h-0 xl:grid-cols-[1.15fr_0.9fr_1.1fr] xl:gap-2.5">
        <DashboardPanel className="min-h-[310px] xl:h-full xl:min-h-0 xl:overflow-hidden">
          <PanelHeader title="Consultas e contratos por mês">
            <CompactSelect value={chartPeriod} onValueChange={setChartPeriod} items={[{ value: "6", label: "Últimos 6 meses" }, { value: "12", label: "Últimos 12 meses" }]} />
          </PanelHeader>
          <div className="mt-3 h-[238px] xl:mt-2 xl:h-[calc(100%-2.25rem)]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={displayedMonths} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
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

        <DashboardPanel className="min-h-[310px] xl:h-full xl:min-h-0 xl:overflow-hidden">
          <PanelHeader title="Status das apólices" />
          <PolicyStatusChart data={data.policyStatus} />
        </DashboardPanel>

        <DashboardPanel className="min-h-[310px] xl:h-full xl:min-h-0 xl:overflow-hidden">
          <PanelHeader title="Comissões mensais (R$)">
            <CompactSelect value={commissionPeriod} onValueChange={setCommissionPeriod} items={[{ value: "year", label: "Este ano" }, { value: "12", label: "Últimos 12 meses" }]} />
          </PanelHeader>
          <div className="mt-3 h-[238px] xl:mt-2 xl:h-[calc(100%-2.25rem)]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={commissionMonths} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid stroke="#EEEEEE" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#858585", fontSize: 10 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "#A3A3A3", fontSize: 10 }} tickFormatter={formatAxisMoney} />
                <Tooltip content={<ChartTooltip currency />} cursor={{ fill: "#FAFAFA" }} />
                <Bar dataKey="comissoes" name="Comissões" fill="#FFC400" radius={[5, 5, 0, 0]} maxBarSize={30} animationDuration={650} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </DashboardPanel>
      </section>

      <section className="grid gap-3 xl:min-h-0 xl:grid-cols-3 xl:gap-2.5">
        <ListPanel title="Atividades recentes" href="/consultas" empty="Nenhuma atividade recente.">
          {data.activities.map((activity) => (
            <ListRow
              key={activity.id}
              icon={activity.type === "contrato" ? FileCheck2 : activity.type === "aprovacao" ? CheckCircle2 : Search}
              title={activity.title}
              subtitle={activity.detail}
              aside={relativeTime(activity.createdAt)}
            />
          ))}
        </ListPanel>

        <ListPanel title="Documentos pendentes" href="/apolices" empty="Nenhum documento pendente.">
          {data.documents.map((document) => (
            <ListRow
              key={document.id}
              icon={FileText}
              title={document.type}
              subtitle={`Inquilino: ${document.tenant}`}
              aside={<StatusBadge status={document.status} />}
            />
          ))}
        </ListPanel>

        <ListPanel title="Próximos vencimentos" href="/faturas-inquilinos" empty="Nenhum vencimento futuro.">
          {data.invoices.map((invoice) => (
            <ListRow
              key={invoice.id}
              icon={CalendarDays}
              title={`Fatura #${invoice.number}`}
              subtitle={`Vencimento: ${formatDate(invoice.dueDate)}`}
              aside={
                <div className="text-right">
                  <p className="text-xs font-bold tabular-nums text-neutral-900">{formatCurrency(invoice.value)}</p>
                  <span className="mt-1 inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-bold text-amber-700">
                    {invoice.daysUntilDue === 0 ? "Vence hoje" : `Em ${invoice.daysUntilDue} dias`}
                  </span>
                </div>
              }
            />
          ))}
        </ListPanel>
      </section>
    </div>
  );
}

function HeroBanner() {
  return (
    <section className="relative min-h-[300px] overflow-hidden rounded-[24px] border border-amber-100 bg-[radial-gradient(circle_at_88%_85%,rgba(255,196,0,0.2),transparent_34%),linear-gradient(112deg,#fffdf8_0%,#ffffff_54%,#fff7d8_100%)] shadow-[0_8px_30px_rgba(0,0,0,0.035)] sm:min-h-[210px] xl:h-full xl:min-h-0">
      <img
        src="/dashboard/agency-panel-art.png"
        alt="Equipe da imobiliária NOX diante de um empreendimento"
        className="pointer-events-none absolute -bottom-5 -left-12 z-10 w-[86%] max-w-[340px] select-none object-contain sm:-bottom-[72px] sm:-left-5 sm:w-[50%] sm:max-w-[390px] xl:-bottom-[172px] xl:left-[1%] xl:w-[46%] xl:max-w-[580px] 2xl:max-w-[620px]"
      />
      <img
        src="/dashboard/agency-panel-copy.png"
        alt="Sua imobiliária mais ágil, mais profissional"
        className="pointer-events-none absolute right-3 top-5 z-20 w-[82%] max-w-[330px] select-none object-contain sm:right-[3%] sm:top-1/2 sm:w-[48%] sm:max-w-[420px] sm:-translate-y-1/2 xl:right-[8%] xl:w-[38%] xl:max-w-[480px]"
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
    <div className="mt-3 grid h-[238px] grid-cols-[minmax(130px,1fr)_minmax(115px,0.9fr)] items-center gap-2 xl:mt-2 xl:h-[calc(100%-2rem)]">
      <div className="relative h-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius="57%" outerRadius="82%" paddingAngle={1} stroke="#FFFFFF" strokeWidth={2} animationDuration={650}>
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
      <div className="space-y-4 xl:space-y-2.5">
        {data.map((item) => (
          <div key={item.key} className="flex items-start gap-2">
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: item.color }} />
            <div>
              <p className="text-[11px] font-semibold text-neutral-700">{item.label}</p>
              <p className="text-[10px] text-neutral-400">{item.value} ({total ? Math.round((item.value / total) * 100) : 0}%)</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ListPanel({ title, href, empty, children }: { title: string; href: string; empty: string; children: React.ReactNode[] }) {
  return (
    <DashboardPanel className="h-full overflow-hidden">
      <PanelHeader title={title}>
        <Button asChild variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-[10px] text-neutral-500">
          <Link to={href}>Ver todos</Link>
        </Button>
      </PanelHeader>
      <div className="mt-2 divide-y divide-neutral-100 xl:mt-1">
        {children.length ? children : <p className="flex h-[150px] items-center justify-center text-xs text-neutral-400 xl:h-[calc(100%-2rem)]">{empty}</p>}
      </div>
    </DashboardPanel>
  );
}

function ListRow({ icon: Icon, title, subtitle, aside }: { icon: Icon; title: string; subtitle: string; aside: React.ReactNode }) {
  return (
    <div className="flex min-h-[58px] items-center gap-3 py-2.5 xl:min-h-[42px] xl:gap-2 xl:py-1.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 text-neutral-700 xl:h-7 xl:w-7">
        <Icon size={15} strokeWidth={1.8} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-bold text-neutral-800">{title}</p>
        <p className="mt-0.5 truncate text-[10px] text-neutral-400">{subtitle}</p>
      </div>
      <div className="shrink-0 text-[9px] text-neutral-400">{aside}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: "aguardando" | "pendente" | "aprovado" }) {
  const styles = status === "pendente" ? "bg-red-50 text-red-600" : status === "aprovado" ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-700";
  return <span className={`rounded-full px-2 py-1 text-[9px] font-bold capitalize ${styles}`}>{status}</span>;
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
      <div className="h-[218px] rounded-[24px] bg-neutral-100" />
      <div className="h-24 rounded-2xl bg-neutral-100" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-24 rounded-2xl bg-neutral-100" />)}</div>
      <div className="grid gap-3 xl:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <div key={index} className="h-[310px] rounded-2xl bg-neutral-100" />)}</div>
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

function formatAxisMoney(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR");
}

function relativeTime(value: string) {
  const diffMinutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (diffMinutes < 1) return "Agora";
  if (diffMinutes < 60) return `Há ${diffMinutes} min`;
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `Há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `Há ${days} d`;
  return new Date(value).toLocaleDateString("pt-BR");
}
