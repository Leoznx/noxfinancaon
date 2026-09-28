import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, addMonths, addWeeks, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertCircle, CalendarRange, ChevronLeft, ChevronRight, Link2, PhoneCall, RefreshCw, Repeat2, Target, UserCheck, UsersRound } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { fetchMySellerControlDashboard, sellerLeadTargetForPeriod, type SellerControlDashboard, type SellerControlPeriod } from "@/lib/seller-control";

export const Route = createFileRoute("/vendedor/")({
  component: () => <ProtectedRoute roles={["vendedor", "admin_master", "admin"]}><VendedorDashboard /></ProtectedRoute>,
});

const PERIODS: Array<{ value: SellerControlPeriod; label: string }> = [
  { value: "daily", label: "Dia" }, { value: "weekly", label: "Semana" }, { value: "monthly", label: "Mês" },
];

function shiftAnchor(date: Date, period: SellerControlPeriod, direction: number) {
  if (period === "daily") return addDays(date, direction);
  if (period === "weekly") return addWeeks(date, direction);
  return addMonths(date, direction);
}

function periodLabel(data: SellerControlDashboard | null, anchor: Date) {
  if (data?.period_start && data.period_end) {
    const start = new Date(`${data.period_start.slice(0, 10)}T12:00:00`);
    const end = new Date(`${data.period_end.slice(0, 10)}T12:00:00`);
    if (data.period === "daily") return format(start, "dd 'de' MMMM", { locale: ptBR });
    return `${format(start, "dd MMM", { locale: ptBR })} — ${format(end, "dd MMM yyyy", { locale: ptBR })}`;
  }
  return format(anchor, "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
}

function VendedorDashboard() {
  const [period, setPeriod] = useState<SellerControlPeriod>("daily");
  const [anchor, setAnchor] = useState(() => new Date());
  const [data, setData] = useState<SellerControlDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try { setData(await fetchMySellerControlDashboard(period, anchor)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar o relatório."); }
    finally { setLoading(false); }
  }, [anchor, period]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); refreshTimer.current = setTimeout(() => void load(true), 250); };
    const channel = supabase.channel("seller-control-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "seller_commercial_events" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "seller_contact_leads" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "seller_appointments" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "seller_signup_attributions" }, refresh).subscribe();
    window.addEventListener("focus", refresh);
    return () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); window.removeEventListener("focus", refresh); void supabase.removeChannel(channel); };
  }, [load]);

  const leadsTarget = useMemo(() => (data ? sellerLeadTargetForPeriod(data) : null), [data]);
  const leadsPercentage = useMemo(() => !data || !leadsTarget ? 0 : Math.min(100, Math.round((data.leads_contacted / leadsTarget) * 100)), [data, leadsTarget]);

  return (
    <DashboardLayout>
      <main className="mx-auto w-full max-w-[1440px] space-y-4 pb-6 text-neutral-950">
        <header className="relative overflow-hidden rounded-[26px] bg-neutral-950 px-5 py-6 text-white shadow-lg sm:px-7">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-yellow-400/25 blur-3xl" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div><span className="inline-flex items-center gap-2 rounded-full bg-yellow-400 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-black"><CalendarRange className="h-3.5 w-3.5" /> Relatório comercial</span><h1 className="mt-3 text-3xl font-black tracking-tight">Seu ritmo, sem ruído.</h1><p className="mt-1 max-w-2xl text-sm text-neutral-300">Metas e ações comerciais reunidas em uma leitura simples, atualizada em tempo real.</p></div>
            <Button variant="outline" className="gap-2 border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar</Button>
          </div>
        </header>

        <section className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex rounded-xl bg-neutral-100 p-1">{PERIODS.map((item) => <button key={item.value} type="button" onClick={() => setPeriod(item.value)} className={`rounded-lg px-4 py-2 text-xs font-black transition ${period === item.value ? "bg-neutral-950 text-white shadow-sm" : "text-neutral-500 hover:text-neutral-950"}`}>{item.label}</button>)}</div>
          <div className="flex min-w-0 items-center justify-between gap-2 md:justify-end"><Button variant="outline" size="icon" className="shrink-0 rounded-xl" onClick={() => setAnchor((value) => shiftAnchor(value, period, -1))} aria-label="Período anterior"><ChevronLeft className="h-4 w-4" /></Button><div className="min-w-0 flex-1 text-center text-xs font-extrabold capitalize sm:text-sm md:min-w-[210px]">{periodLabel(data, anchor)}</div><Button variant="outline" size="icon" className="shrink-0 rounded-xl" onClick={() => setAnchor((value) => shiftAnchor(value, period, 1))} aria-label="Próximo período"><ChevronRight className="h-4 w-4" /></Button></div>
        </section>

        {error && <DashboardError message={error} />}
        {loading && !data ? <DashboardSkeleton /> : data && <>
          <section className="grid gap-3 md:grid-cols-2">
            <GoalCard icon={PhoneCall} eyebrow="Meta visual diária" title="Ligações" value={data.target_calls_daily == null ? "—" : String(data.target_calls_daily)} description="Referência diária; as ligações não são contadas pelo sistema." progress={null} tone="yellow" />
            <GoalCard icon={UsersRound} eyebrow="Meta acumulada em dias úteis" title="Leads em contato" value={`${data.leads_contacted} / ${leadsTarget ?? "—"}`} description={leadsTarget == null ? "Meta ainda não configurada." : `${leadsPercentage}% da meta do período concluída.`} progress={leadsTarget == null ? null : leadsPercentage} tone="violet" />
          </section>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard icon={Repeat2} label="Reagendamentos" value={data.meetings_rescheduled} caption="reuniões remarcadas no período" accent="bg-orange-100 text-orange-700" />
            <MetricCard icon={Link2} label="Links enviados" value={data.links_generated} caption="ações de envio registradas" accent="bg-sky-100 text-sky-700" />
            <MetricCard icon={UserCheck} label="Cadastros realizados" value={data.registrations} caption="novos cadastros atribuídos" accent="bg-emerald-100 text-emerald-700" />
          </section>
          <section className="rounded-2xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-950"><div className="flex items-start gap-3"><Target className="mt-0.5 h-5 w-5 shrink-0" /><div><strong>Resumo de {data.seller_type === "closer" ? "Closer" : "Vendedor"}</strong><p className="mt-0.5 text-xs font-medium text-yellow-900/75">Os números mudam automaticamente quando você reagenda, envia um link, registra um lead em contato ou recebe um cadastro.</p></div></div></section>
        </>}
      </main>
    </DashboardLayout>
  );
}

function GoalCard({ icon: Icon, eyebrow, title, value, description, progress, tone }: { icon: typeof PhoneCall; eyebrow: string; title: string; value: string; description: string; progress: number | null; tone: "yellow" | "violet" }) {
  const palette = tone === "yellow" ? "bg-yellow-100 text-yellow-800" : "bg-violet-100 text-violet-700";
  return <article className="relative overflow-hidden rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-neutral-400">{eyebrow}</p><h2 className="mt-1 text-lg font-black">{title}</h2></div><span className={`grid h-11 w-11 place-items-center rounded-2xl ${palette}`}><Icon className="h-5 w-5" /></span></div><strong className="mt-6 block text-4xl font-black tracking-tight">{value}</strong>{progress != null && <Progress value={progress} className="mt-4 h-2 bg-neutral-100" />}<p className="mt-3 text-xs font-medium leading-5 text-neutral-500">{description}</p></article>;
}

function MetricCard({ icon: Icon, label, value, caption, accent }: { icon: typeof Repeat2; label: string; value: number; caption: string; accent: string }) {
  return <article className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-neutral-500">{label}</p><strong className="mt-2 block text-4xl font-black">{value}</strong><p className="mt-1 text-[11px] font-medium text-neutral-400">{caption}</p></div><span className={`grid h-10 w-10 place-items-center rounded-xl ${accent}`}><Icon className="h-5 w-5" /></span></div></article>;
}
function DashboardError({ message }: { message: string }) { return <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{message}</span></div>; }
function DashboardSkeleton() { return <div className="grid animate-pulse gap-3 md:grid-cols-2"><div className="h-56 rounded-2xl bg-neutral-100" /><div className="h-56 rounded-2xl bg-neutral-100" /></div>; }
