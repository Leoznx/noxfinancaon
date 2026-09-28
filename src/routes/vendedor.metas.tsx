import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Flame, PhoneCall, RefreshCw, Sparkles, Target, Trophy, UsersRound } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { fetchMySellerControlDashboard, type SellerControlDashboard } from "@/lib/seller-control";
import { fetchMySellerMonthlyProgress, type SellerMonthlyProgress } from "@/lib/seller-progress";
import { fetchMyRoleGoalProgress, type TeamGoalProgress } from "@/lib/admin-team-goals";

export const Route = createFileRoute("/vendedor/metas")({
  component: () => <ProtectedRoute roles={["vendedor", "admin_master", "admin"]} moduleKey="metas"><Goals /></ProtectedRoute>,
});

function Goals() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const [daily, setDaily] = useState<SellerControlDashboard | null>(null);
  const [monthly, setMonthly] = useState<SellerControlDashboard | null>(null);
  const [roleProgress, setRoleProgress] = useState<TeamGoalProgress | null>(null);
  const [legacyMonthly, setLegacyMonthly] = useState<SellerMonthlyProgress | null>(null);
  const [ranking, setRanking] = useState<Array<{ id: string; name: string; registrations: number; position: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [day, monthData, sharedProgress, monthlyProgress, rankingResponse] = await Promise.all([
        fetchMySellerControlDashboard("daily"),
        fetchMySellerControlDashboard("monthly"),
        fetchMyRoleGoalProgress(),
        fetchMySellerMonthlyProgress(month, year),
        (supabase as any).rpc("ranking_vendedores", { p_month: month, p_year: year }),
      ]);
      if (rankingResponse.error) throw rankingResponse.error;
      setDaily(day); setMonthly(monthData); setRoleProgress(sharedProgress); setLegacyMonthly(monthlyProgress);
      setRanking((((rankingResponse.data as Record<string, unknown>[] | null) ?? []).map((row) => ({ id: String(row.vendedor_id), name: String(row.nome || "Vendedor"), registrations: Number(row.total_leads ?? 0), position: Number(row.posicao ?? 0) })).sort((a, b) => a.position - b.position)));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar suas metas."); }
    finally { setLoading(false); }
  }, [month, year]);
  useEffect(() => { void load(); const refresh = () => void load(); const channel = supabase.channel("seller-goals-live").on("postgres_changes", { event: "*", schema: "public", table: "seller_contact_leads" }, refresh).on("postgres_changes", { event: "*", schema: "public", table: "seller_team_goals" }, refresh).on("postgres_changes", { event: "*", schema: "public", table: "seller_commercial_events" }, refresh).on("postgres_changes", { event: "*", schema: "public", table: "seller_signup_attributions" }, refresh).on("postgres_changes", { event: "*", schema: "public", table: "seller_client_partnerships" }, refresh).on("postgres_changes", { event: "*", schema: "public", table: "seller_appointments" }, refresh).subscribe(); return () => { void supabase.removeChannel(channel); }; }, [load]);

  const leadsPercent = useMemo(() => daily?.target_leads_contacted_daily ? Math.min(100, Math.round((daily.leads_contacted / daily.target_leads_contacted_daily) * 100)) : 0, [daily]);
  const remaining = daily?.target_leads_contacted_daily == null ? null : Math.max(0, daily.target_leads_contacted_daily - daily.leads_contacted);

  return <DashboardLayout>
    <main className="mx-auto w-full max-w-[1400px] space-y-4 pb-8 text-neutral-950">
      <section className="relative overflow-hidden rounded-[28px] border border-yellow-300 bg-[radial-gradient(circle_at_90%_15%,rgba(250,204,21,.45),transparent_27%),linear-gradient(115deg,#fff_0%,#fffbed_65%,#ffef91_100%)] p-6 shadow-sm sm:p-8">
        <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:justify-between"><div><span className="inline-flex items-center gap-2 rounded-full bg-neutral-950 px-3 py-1 text-[10px] font-black uppercase tracking-[.16em] text-yellow-300"><Sparkles className="h-3.5 w-3.5" /> Metas que movimentam</span><h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">Um passo por vez. Todo dia.</h1><p className="mt-2 max-w-2xl text-sm font-medium text-neutral-600">Use a meta de ligações como ritmo visual e registre somente os leads que realmente responderam.</p></div><Button variant="outline" className="gap-2 border-yellow-400 bg-white/80 font-bold" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar</Button></div>
      </section>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-800">{error}</div> : loading && !daily ? <div className="h-80 animate-pulse rounded-3xl bg-neutral-100" /> : daily && monthly && <>
        <section className="grid gap-4 lg:grid-cols-2">
          <article className="group overflow-hidden rounded-[24px] bg-neutral-950 p-6 text-white shadow-lg"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-black uppercase tracking-[.18em] text-yellow-300">Ritmo visual · hoje</p><h2 className="mt-2 text-2xl font-black">Ligações</h2></div><span className="grid h-12 w-12 place-items-center rounded-2xl bg-yellow-400 text-black transition group-hover:rotate-6"><PhoneCall className="h-6 w-6" /></span></div><strong className="mt-10 block text-6xl font-black tracking-[-.06em]">{daily.target_calls_daily ?? "—"}</strong><p className="mt-3 max-w-sm text-sm leading-6 text-neutral-300">Meta de referência. O sistema não monitora nem conta suas ligações.</p></article>
          <article className="overflow-hidden rounded-[24px] border border-violet-200 bg-violet-50 p-6 shadow-sm"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-black uppercase tracking-[.18em] text-violet-600">Resultado acompanhado · hoje</p><h2 className="mt-2 text-2xl font-black">Leads em contato</h2></div><span className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-600 text-white"><UsersRound className="h-6 w-6" /></span></div><div className="mt-8 flex items-end justify-between gap-4"><strong className="text-5xl font-black tracking-[-.05em]">{daily.leads_contacted}<span className="ml-2 text-lg text-violet-400">/ {daily.target_leads_contacted_daily ?? "—"}</span></strong><span className="rounded-full bg-white px-3 py-1 text-sm font-black text-violet-700">{leadsPercent}%</span></div><Progress value={leadsPercent} className="mt-5 h-3 bg-white" /><p className="mt-3 text-sm font-semibold text-violet-800/70">{remaining == null ? "A administração ainda não definiu esta meta." : remaining === 0 ? "Meta do dia concluída. Excelente!" : `Faltam ${remaining} ${remaining === 1 ? "lead" : "leads"} em contato.`}</p></article>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <MiniStat icon={Flame} label="Leads no mês" value={monthly.leads_contacted} color="text-orange-600 bg-orange-100" />
          <MiniStat icon={ArrowRight} label="Links enviados" value={monthly.links_generated} color="text-sky-700 bg-sky-100" />
          <MiniStat icon={Trophy} label="Cadastros no mês" value={monthly.registrations} color="text-emerald-700 bg-emerald-100" />
        </section>

        {roleProgress && (
          <section className="rounded-[24px] border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div><p className="text-[10px] font-black uppercase tracking-[.16em] text-yellow-700">Metas compartilhadas da equipe</p><h2 className="mt-1 text-xl font-black">Reuniões e cadastros</h2></div>
              <span className="rounded-full bg-neutral-950 px-3 py-1 text-[10px] font-black uppercase text-white">{roleProgress.seller_type === "closer" ? "Closer" : "Vendedor"}</span>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <SharedGoalGroup title={roleProgress.seller_type === "closer" ? "Reuniões confirmadas" : "Reuniões agendadas"} values={roleProgress.seller_type === "closer" ? [roleProgress.meetings_completed_daily, roleProgress.meetings_completed_weekly, roleProgress.meetings_completed_monthly] : [roleProgress.meetings_scheduled_daily, roleProgress.meetings_scheduled_weekly, roleProgress.meetings_scheduled_monthly]} targets={roleProgress.seller_type === "closer" ? [roleProgress.target_meetings_completed_daily, roleProgress.target_meetings_completed_weekly, roleProgress.target_meetings_completed_monthly] : [roleProgress.target_meetings_scheduled_daily, roleProgress.target_meetings_scheduled_weekly, roleProgress.target_meetings_scheduled_monthly]} />
              <SharedGoalGroup title="Cadastros realizados" values={[roleProgress.clients_registered_daily, roleProgress.clients_registered_weekly, roleProgress.clients_registered_monthly]} targets={[roleProgress.target_clients_daily, roleProgress.target_clients_weekly, roleProgress.target_clients_monthly]} />
            </div>
          </section>
        )}

        <section className="grid gap-4 lg:grid-cols-[.8fr_1.2fr]">
          <article className="rounded-[24px] border border-yellow-300 bg-yellow-50 p-5 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-[.16em] text-yellow-800">Meta individual do mês</p>
            <div className="mt-3 flex items-end justify-between gap-3"><strong className="text-4xl font-black">{legacyMonthly?.clients_registered ?? 0}<span className="ml-1 text-base text-yellow-700/60">/ {legacyMonthly?.target_clients ?? "—"}</span></strong><Trophy className="h-8 w-8 text-yellow-600" /></div>
            <Progress value={legacyMonthly?.target_clients ? Math.min(100, Math.round((legacyMonthly.clients_registered / legacyMonthly.target_clients) * 100)) : 0} className="mt-4 h-2 bg-white" />
          </article>
          <article className="rounded-[24px] border border-neutral-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[.16em] text-neutral-400">Ranking preservado</p><h2 className="mt-1 text-lg font-black">Cadastros do mês</h2></div><Trophy className="h-6 w-6 text-yellow-600" /></div>{ranking.length === 0 ? <p className="mt-5 text-sm text-neutral-500">Ainda não há posições neste mês.</p> : <ol className="mt-4 grid gap-2 sm:grid-cols-2">{ranking.slice(0, 6).map((row) => <li key={row.id} className={`flex items-center gap-3 rounded-xl p-3 ${row.id === legacyMonthly?.seller_id ? "bg-yellow-50 ring-1 ring-yellow-300" : "bg-neutral-50"}`}><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-neutral-950 text-xs font-black text-white">{row.position}º</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-black">{row.name}</p><p className="text-[11px] font-semibold text-neutral-500">{row.registrations} cadastro(s)</p></div></li>)}</ol>}</article>
        </section>

        <section className="rounded-[24px] border border-neutral-200 bg-white p-5 shadow-sm"><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-yellow-100 text-yellow-700"><Target className="h-5 w-5" /></span><div><h2 className="font-black">Como um lead entra na meta?</h2><p className="mt-1 text-sm leading-6 text-neutral-500">Cadastre nome e telefone na aba Clientes. O lead passa a contar imediatamente e os lembretes de acompanhamento são criados automaticamente na agenda.</p></div></div></section>
      </>}
    </main>
  </DashboardLayout>;
}

function MiniStat({ icon: Icon, label, value, color }: { icon: typeof Flame; label: string; value: number; color: string }) {
  return <article className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm"><span className={`grid h-11 w-11 place-items-center rounded-xl ${color}`}><Icon className="h-5 w-5" /></span><div><strong className="text-2xl font-black">{value}</strong><p className="text-xs font-bold text-neutral-500">{label}</p></div></article>;
}

function SharedGoalGroup({ title, values, targets }: { title: string; values: number[]; targets: Array<number | null> }) {
  return <div className="rounded-2xl bg-neutral-50 p-4"><h3 className="text-sm font-black">{title}</h3><div className="mt-3 grid grid-cols-3 gap-2">{["Hoje", "Semana", "Mês"].map((label, index) => { const pct = targets[index] ? Math.min(100, Math.round((values[index] / targets[index]!) * 100)) : 0; return <div key={label} className="rounded-xl border border-neutral-200 bg-white p-2.5"><p className="text-[9px] font-black uppercase text-neutral-400">{label}</p><p className="mt-1 text-lg font-black">{values[index]}<span className="text-[10px] text-neutral-400"> / {targets[index] ?? "—"}</span></p><Progress value={pct} className="mt-2 h-1.5 bg-neutral-100" /></div>; })}</div></div>;
}
