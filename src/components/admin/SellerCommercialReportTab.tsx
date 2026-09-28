import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, addMonths, addWeeks, endOfWeek, format, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Link2, PhoneCall, RefreshCw, Repeat2, UserCheck, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { fetchAdminSellerControlReport, sellerLeadTargetForPeriod, type SellerControlDashboard, type SellerControlPeriod } from "@/lib/seller-control";

const PERIODS: Array<{ value: SellerControlPeriod; label: string }> = [
  { value: "daily", label: "Diário" }, { value: "weekly", label: "Semanal" }, { value: "monthly", label: "Mensal" },
];

function shift(date: Date, period: SellerControlPeriod, direction: number) {
  if (period === "daily") return addDays(date, direction);
  if (period === "weekly") return addWeeks(date, direction);
  return addMonths(date, direction);
}

function selectedPeriodLabel(date: Date, period: SellerControlPeriod) {
  if (period === "daily") return format(date, "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
  if (period === "monthly") return format(date, "MMMM 'de' yyyy", { locale: ptBR });
  const start = startOfWeek(date, { weekStartsOn: 1 });
  const end = endOfWeek(date, { weekStartsOn: 1 });
  return `${format(start, "dd/MM", { locale: ptBR })} — ${format(end, "dd/MM/yyyy", { locale: ptBR })}`;
}

export function SellerCommercialReportTab() {
  const [period, setPeriod] = useState<SellerControlPeriod>("daily");
  const [anchor, setAnchor] = useState(() => new Date());
  const [rows, setRows] = useState<SellerControlDashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => { setLoading(true); setError(""); try { setRows(await fetchAdminSellerControlReport(period, anchor)); } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar o relatório."); } finally { setLoading(false); } }, [anchor, period]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const refresh = () => void load(); const channel = supabase.channel("admin-seller-control-report").on("postgres_changes", { event: "*", schema: "public", table: "seller_commercial_events" }, refresh).on("postgres_changes", { event: "*", schema: "public", table: "seller_contact_leads" }, refresh).subscribe(); return () => { void supabase.removeChannel(channel); }; }, [load]);

  const totals = useMemo(() => rows.reduce((sum, row) => ({ reschedules: sum.reschedules + row.meetings_rescheduled, links: sum.links + row.links_generated, registrations: sum.registrations + row.registrations, leads: sum.leads + row.leads_contacted, active: sum.active + row.active_leads, missed: sum.missed + row.missed_leads }), { reschedules: 0, links: 0, registrations: 0, leads: 0, active: 0, missed: 0 }), [rows]);

  return <section className="space-y-4">
    <header className="relative overflow-hidden rounded-3xl bg-neutral-950 p-6 text-white"><div className="absolute -right-20 -top-20 h-52 w-52 rounded-full bg-yellow-400/20 blur-3xl" /><div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[.18em] text-yellow-400">Leitura por vendedor</p><h2 className="mt-2 text-2xl font-black">Relatório comercial</h2><p className="mt-1 text-sm text-neutral-300">Compare metas e ações por dia, semana ou mês.</p></div><Button variant="outline" className="gap-2 border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar</Button></div></header>

    <div className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-3 md:flex-row md:items-center md:justify-between"><div className="flex rounded-xl bg-neutral-100 p-1">{PERIODS.map((item) => <button key={item.value} type="button" onClick={() => setPeriod(item.value)} className={`rounded-lg px-4 py-2 text-xs font-black ${period === item.value ? "bg-neutral-950 text-white" : "text-neutral-500"}`}>{item.label}</button>)}</div><div className="flex min-w-0 items-center justify-between gap-2"><Button variant="outline" size="icon" className="shrink-0" onClick={() => setAnchor((value) => shift(value, period, -1))}><ChevronLeft className="h-4 w-4" /></Button><strong className="min-w-0 flex-1 text-center text-xs capitalize sm:min-w-[190px] sm:text-sm">{selectedPeriodLabel(anchor, period)}</strong><Button variant="outline" size="icon" className="shrink-0" onClick={() => setAnchor((value) => shift(value, period, 1))}><ChevronRight className="h-4 w-4" /></Button></div></div>

    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">{error}</div>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><Total icon={UsersRound} label="Leads em contato" value={totals.leads} color="bg-violet-100 text-violet-700" /><Total icon={UsersRound} label="Leads ativos" value={totals.active} color="bg-fuchsia-100 text-fuchsia-700" /><Total icon={UsersRound} label="Lembretes perdidos" value={totals.missed} color="bg-red-100 text-red-700" /><Total icon={Repeat2} label="Reagendamentos" value={totals.reschedules} color="bg-orange-100 text-orange-700" /><Total icon={Link2} label="Links enviados" value={totals.links} color="bg-sky-100 text-sky-700" /><Total icon={UserCheck} label="Cadastros" value={totals.registrations} color="bg-emerald-100 text-emerald-700" /></div>

    {loading && rows.length === 0 ? <div className="h-72 animate-pulse rounded-2xl bg-neutral-100" /> : rows.length === 0 ? <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-12 text-center text-sm font-semibold text-neutral-500">Nenhum vendedor com atividade neste período.</div> : <div className="grid gap-3 lg:grid-cols-2">{rows.map((row) => <SellerReportCard key={row.seller_id} row={row} />)}</div>}
  </section>;
}

function SellerReportCard({ row }: { row: SellerControlDashboard }) {
  const target = sellerLeadTargetForPeriod(row);
  const pct = target ? Math.min(100, Math.round((row.leads_contacted / target) * 100)) : 0;
  return <article className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[.14em] text-neutral-400">{row.seller_type === "closer" ? "Closer" : "Vendedor"}</p><h3 className="mt-1 text-lg font-black">{row.seller_name}</h3></div><span className="rounded-full bg-neutral-950 px-3 py-1 text-[10px] font-black text-white">{row.registrations} cadastro(s)</span></div><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5"><Small label="Reagendou" value={row.meetings_rescheduled} /><Small label="Links" value={row.links_generated} /><Small label="Em contato" value={row.leads_contacted} /><Small label="Ativos" value={row.active_leads} /><Small label="Perdidos" value={row.missed_leads} /></div><div className="mt-4 rounded-xl bg-violet-50 p-3"><div className="flex items-center justify-between gap-3 text-xs"><span className="flex items-center gap-1.5 font-bold text-violet-800"><UsersRound className="h-4 w-4" /> Meta de leads</span><strong>{row.leads_contacted} / {target ?? "—"}</strong></div><Progress value={pct} className="mt-2 h-2 bg-white" /></div><div className="mt-3 flex items-center gap-2 text-xs font-semibold text-neutral-500"><PhoneCall className="h-4 w-4 text-yellow-600" /> Meta visual de ligações por dia: <strong className="text-neutral-900">{row.target_calls_daily ?? "não definida"}</strong></div></article>;
}
function Total({ icon: Icon, label, value, color }: { icon: typeof UsersRound; label: string; value: number; color: string }) { return <article className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-4"><span className={`grid h-10 w-10 place-items-center rounded-xl ${color}`}><Icon className="h-5 w-5" /></span><div><strong className="text-2xl font-black">{value}</strong><p className="text-xs font-bold text-neutral-500">{label}</p></div></article>; }
function Small({ label, value }: { label: string; value: number }) { return <div className="rounded-xl bg-neutral-50 p-2.5 text-center"><strong className="text-xl font-black">{value}</strong><p className="text-[10px] font-bold text-neutral-500">{label}</p></div>; }
