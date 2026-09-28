import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CalendarClock, ChevronDown, History, Phone, Plus, RefreshCw, Search, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { formatBrazilianPhoneInput, isValidBrazilianPhone } from "@/lib/seller-clients";
import { createMySellerContactLead, fetchMySellerContactLeads, type SellerContactLead } from "@/lib/seller-control";

export function SellerContactLeadsPanel() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [search, setSearch] = useState("");
  const [leads, setLeads] = useState<SellerContactLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const searchRef = useRef("");

  const load = useCallback(async (term: string) => {
    setError("");
    try { setLeads(await fetchMySellerContactLeads(term)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar os leads."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(""); }, [load]);
  useEffect(() => { searchRef.current = search; }, [search]);
  useEffect(() => {
    const refresh = () => void load(searchRef.current);
    const channel = supabase.channel("seller-contact-leads-ui")
      .on("postgres_changes", { event: "*", schema: "public", table: "seller_contact_leads" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "seller_contact_lead_history" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "seller_contact_lead_tasks" }, refresh)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2) { toast.error("Informe o nome do lead."); return; }
    if (!isValidBrazilianPhone(phone)) { toast.error("Informe um telefone brasileiro válido."); return; }
    setSaving(true);
    try {
      await createMySellerContactLead(name, phone);
      setName(""); setPhone(""); setSearch(""); searchRef.current = "";
      toast.success("Lead salvo. Os lembretes serão distribuídos automaticamente.");
      await load("");
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível salvar o lead."); }
    finally { setSaving(false); }
  }

  const activeToday = useMemo(() => leads.filter((lead) => {
    const created = lead.created_at ? new Date(lead.created_at) : null;
    const today = new Date();
    return !!created && created.toDateString() === today.toDateString();
  }).length, [leads]);

  return <div className="space-y-4">
    <section className="grid gap-4 rounded-3xl border border-violet-200 bg-[linear-gradient(135deg,#fff_0%,#f5f3ff_100%)] p-5 shadow-sm lg:grid-cols-[minmax(0,1fr)_330px] sm:p-6">
      <div><span className="inline-flex items-center gap-2 rounded-full bg-violet-100 px-3 py-1 text-[10px] font-black uppercase tracking-[.15em] text-violet-700"><Plus className="h-3.5 w-3.5" /> Novo lead em contato</span><h2 className="mt-3 text-2xl font-black">Nome e telefone. O resto é automático.</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600">O sistema agenda dois lembretes úteis em até 30 dias, sem ocupar horário. Se não houver retorno, o lead gira para outro vendedor.</p></div>
      <div className="grid place-items-center rounded-2xl border border-violet-200 bg-white/80 p-4 text-center"><strong className="text-4xl font-black text-violet-700">{activeToday}</strong><span className="mt-1 text-xs font-black uppercase tracking-wide text-neutral-500">leads cadastrados hoje</span></div>
    </section>

    <form onSubmit={submit} className="grid gap-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm md:grid-cols-[minmax(0,1fr)_260px_auto] md:items-end">
      <div><Label htmlFor="lead-name">Nome do lead</Label><Input id="lead-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Ana Martins" className="mt-1.5 h-11" maxLength={120} /></div>
      <div><Label htmlFor="lead-phone">Telefone / WhatsApp</Label><Input id="lead-phone" value={phone} onChange={(event) => setPhone(formatBrazilianPhoneInput(event.target.value))} placeholder="(11) 99999-9999" className="mt-1.5 h-11" inputMode="tel" /></div>
      <Button type="submit" className="h-11 bg-violet-600 font-black text-white hover:bg-violet-700" disabled={saving}>{saving ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Cadastrar lead</Button>
    </form>

    <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-neutral-200 p-5 md:flex-row md:items-end md:justify-between"><div><h2 className="text-xl font-black">Leads do dia e carteira atual</h2><p className="mt-1 text-sm text-neutral-500">Pesquise um lead para consultar todo o histórico de contatos e transferências.</p></div><form className="flex w-full gap-2 md:max-w-md" onSubmit={(event) => { event.preventDefault(); setLoading(true); void load(search); }}><div className="relative flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-neutral-400" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar nome ou telefone" className="h-10 pl-9" /></div><Button type="submit" variant="outline" className="font-bold">Buscar</Button></form></div>
      {error ? <div className="m-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">{error}</div> : loading ? <div className="flex items-center justify-center gap-2 p-12 text-sm font-semibold text-neutral-500"><RefreshCw className="h-4 w-4 animate-spin" /> Carregando leads...</div> : leads.length === 0 ? <div className="grid min-h-56 place-items-center p-8 text-center"><div><UserRound className="mx-auto h-10 w-10 text-neutral-300" /><p className="mt-3 font-black">Nenhum lead encontrado</p><p className="mt-1 text-sm text-neutral-500">Cadastre o primeiro telefone ou ajuste a pesquisa.</p></div></div> : <div className="divide-y divide-neutral-100">{leads.map((lead) => <LeadRow key={lead.id} lead={lead} />)}</div>}
    </section>
  </div>;
}

function LeadRow({ lead }: { lead: SellerContactLead }) {
  return <details className="group p-4 sm:p-5"><summary className="flex cursor-pointer list-none items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700"><Phone className="h-5 w-5" /></span><div className="min-w-0 flex-1"><p className="truncate font-black text-neutral-950">{lead.name}</p><p className="mt-0.5 text-xs font-medium text-neutral-500">{formatBrazilianPhoneInput(lead.phone)} · Ciclo {lead.cycle_number}</p></div><div className="hidden text-right sm:block"><p className="text-xs font-bold text-neutral-500">Próximo lembrete</p><p className="mt-0.5 text-xs font-black text-neutral-800">{formatWhen(lead.next_follow_up_at)}</p></div><ChevronDown className="h-5 w-5 text-neutral-400 transition group-open:rotate-180" /></summary><div className="mt-4 grid gap-4 border-t border-neutral-100 pt-4 lg:grid-cols-[220px_minmax(0,1fr)]"><div className="space-y-3 rounded-xl bg-neutral-50 p-3 text-xs"><Info icon={CalendarClock} label="Ciclo até" value={formatWhen(lead.cycle_ends_at)} /><Info icon={History} label="Sem retorno" value={`${lead.attempts_in_cycle} tentativa(s)`} /></div><div><p className="mb-2 text-[10px] font-black uppercase tracking-[.14em] text-neutral-400">Histórico</p>{lead.history.length === 0 ? <p className="rounded-xl border border-dashed border-neutral-200 p-4 text-sm text-neutral-500">Ainda não há movimentações registradas.</p> : <ol className="space-y-2">{lead.history.map((item) => <li key={item.id} className="rounded-xl border border-neutral-200 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{historyLabel(item.event, item.label)}</strong><time className="text-[11px] font-semibold text-neutral-400">{formatWhen(item.occurred_at)}</time></div>{item.seller_name && <p className="mt-1 text-xs text-neutral-500">Vendedor: {item.seller_name}</p>}{item.details && <p className="mt-1 text-xs text-neutral-500">{item.details}</p>}</li>)}</ol>}</div></div></details>;
}

function Info({ icon: Icon, label, value }: { icon: typeof History; label: string; value: string }) { return <div className="flex items-start gap-2"><Icon className="mt-0.5 h-4 w-4 text-violet-600" /><div><p className="font-bold text-neutral-500">{label}</p><p className="mt-0.5 font-black text-neutral-800">{value}</p></div></div>; }
function formatWhen(value: string | null) { return value ? new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "A definir"; }
function historyLabel(event: string, fallback: string) { const labels: Record<string, string> = { lead_created: "Lead cadastrado", contact_confirmed: "Contato confirmado", task_responded: "Lembrete respondido", task_missed: "Lembrete não confirmado", transferred: "Transferido para outro vendedor", rotation_deferred: "Rotação adiada por novo contato" }; return labels[event] ?? fallback; }
