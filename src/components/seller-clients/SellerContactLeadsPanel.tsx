import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CalendarCheck2, CalendarClock, ChevronDown, Flame, History, Phone, Plus, RefreshCw, Search, Snowflake, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { formatBrazilianPhoneInput, isValidBrazilianPhone } from "@/lib/seller-clients";
import { SELLER_LEAD_CATEGORIES, createMySellerContactLead, fetchMySellerContactLeads, type SellerContactLead, type SellerLeadCategory } from "@/lib/seller-control";

export function SellerContactLeadsPanel() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [search, setSearch] = useState("");
  const [leads, setLeads] = useState<SellerContactLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [category, setCategory] = useState<SellerLeadCategory | null>(null);
  const [notes, setNotes] = useState("");
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
    setCategory(null);
    setNotes("");
    setCategoryPickerOpen(true);
  }

  async function confirmCategory() {
    if (!category) { toast.error("Selecione como este lead deve ser acompanhado."); return; }
    setSaving(true);
    try {
      await createMySellerContactLead(name, phone, category, notes);
      setName(""); setPhone(""); setNotes(""); setSearch(""); searchRef.current = "";
      setCategoryPickerOpen(false);
      const selected = SELLER_LEAD_CATEGORIES.find((item) => item.value === category);
      toast.success(`${selected?.label ?? "Lead"} salvo. A agenda já foi organizada automaticamente.`);
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
      <div><span className="inline-flex items-center gap-2 rounded-full bg-violet-100 px-3 py-1 text-[10px] font-black uppercase tracking-[.15em] text-violet-700"><Plus className="h-3.5 w-3.5" /> Novo lead em contato</span><h2 className="mt-3 text-2xl font-black">Cadastre, qualifique e deixe a agenda trabalhar.</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600">Depois de nome e telefone, escolha Frio, Reunião marcada ou Em potencial. O lead fica na sua carteira particular durante todo o prazo; somente depois a automação transfere entre SDR e Closer.</p></div>
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
    <Dialog open={categoryPickerOpen} onOpenChange={(open) => !saving && setCategoryPickerOpen(open)}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle className="text-2xl font-black">Como este lead deve entrar na carteira?</DialogTitle></DialogHeader>
        <p className="text-sm leading-6 text-neutral-500">Essa escolha define a quantidade de follow-ups e o prazo da sua carteira particular. Uma falta nunca antecipa a transferência.</p>
        <div className="grid gap-3 py-2">
          {SELLER_LEAD_CATEGORIES.map((option) => {
            const Icon = option.value === "cold" ? Snowflake : option.value === "potential" ? Flame : CalendarCheck2;
            const active = category === option.value;
            return <button key={option.value} type="button" onClick={() => setCategory(option.value)} className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition ${active ? "border-violet-500 bg-violet-50 ring-2 ring-violet-100" : "border-neutral-200 hover:border-violet-200 hover:bg-neutral-50"}`}>
              <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${active ? "bg-violet-600 text-white" : "bg-neutral-100 text-neutral-700"}`}><Icon className="h-5 w-5" /></span>
              <span><strong className="block text-sm font-black text-neutral-950">{option.label}</strong><span className="mt-1 block text-xs leading-5 text-neutral-500">{option.description}</span></span>
            </button>;
          })}
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="lead-notes">Observação (opcional)</Label>
            <span className="text-[11px] font-semibold text-neutral-400">{notes.length}/1000</span>
          </div>
          <Textarea id="lead-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Ex.: prefere contato à tarde, veio por indicação..." className="min-h-24 resize-none" maxLength={1000} disabled={saving} />
          <p className="text-xs leading-5 text-neutral-500">A observação ficará salva no histórico deste lead.</p>
        </div>
        <DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={() => setCategoryPickerOpen(false)}>Cancelar</Button><Button type="button" disabled={saving || !category} onClick={() => void confirmCategory()} className="bg-violet-600 font-black text-white hover:bg-violet-700">{saving && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}Confirmar e automatizar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

function LeadRow({ lead }: { lead: SellerContactLead }) {
  return <details className="group p-4 sm:p-5"><summary className="flex cursor-pointer list-none items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700"><Phone className="h-5 w-5" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-black text-neutral-950">{lead.name}</p><span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${categoryClass(lead.category)}`}>{lead.category_label}</span></div><p className="mt-0.5 text-xs font-medium text-neutral-500">{formatBrazilianPhoneInput(lead.phone)} · Ciclo {lead.cycle_number}</p></div><div className="hidden text-right sm:block"><p className="text-xs font-bold text-neutral-500">Próximo lembrete</p><p className="mt-0.5 text-xs font-black text-neutral-800">{formatWhen(lead.next_follow_up_at)}</p></div><ChevronDown className="h-5 w-5 text-neutral-400 transition group-open:rotate-180" /></summary><div className="mt-4 grid gap-4 border-t border-neutral-100 pt-4 lg:grid-cols-[240px_minmax(0,1fr)]"><div className="space-y-3 rounded-xl bg-neutral-50 p-3 text-xs"><Info icon={CalendarClock} label={lead.rotation_locked ? "Responsável" : "Ciclo até"} value={lead.rotation_locked ? "Exclusivo, sem rotação" : formatWhen(lead.cycle_ends_at)} /><Info icon={History} label="Sem retorno" value={`${lead.attempts_in_cycle}/${lead.follow_up_limit} tentativa(s)`} /></div><div><p className="mb-2 text-[10px] font-black uppercase tracking-[.14em] text-neutral-400">Histórico</p>{lead.history.length === 0 ? <p className="rounded-xl border border-dashed border-neutral-200 p-4 text-sm text-neutral-500">Ainda não há movimentações registradas.</p> : <ol className="space-y-2">{lead.history.map((item) => <li key={item.id} className="rounded-xl border border-neutral-200 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{historyLabel(item.event, item.label)}</strong><time className="text-[11px] font-semibold text-neutral-400">{formatWhen(item.occurred_at)}</time></div>{item.seller_name && <p className="mt-1 text-xs text-neutral-500">Vendedor: {item.seller_name}</p>}{item.details && <p className="mt-1 text-xs text-neutral-500">{item.details}</p>}</li>)}</ol>}</div></div></details>;
}

function Info({ icon: Icon, label, value }: { icon: typeof History; label: string; value: string }) { return <div className="flex items-start gap-2"><Icon className="mt-0.5 h-4 w-4 text-violet-600" /><div><p className="font-bold text-neutral-500">{label}</p><p className="mt-0.5 font-black text-neutral-800">{value}</p></div></div>; }
function formatWhen(value: string | null) { return value ? new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "A definir"; }
function historyLabel(event: string, fallback: string) { const labels: Record<string, string> = { lead_created: "Lead cadastrado", lead_observation: "Observação cadastrada", contact_confirmed: "Contato confirmado", category_changed: "Jornada do lead alterada", task_responded: "Lembrete respondido e próximo passo definido", task_missed: "Lembrete não confirmado", transferred: "Transferido entre SDR e Closer após o prazo", premature_transfer_reverted: "Transferência antecipada corrigida", rotation_deferred: "Rotação adiada por falta de responsável do outro time" }; return labels[event] ?? fallback; }
function categoryClass(category: SellerLeadCategory) { return category === "potential" ? "bg-orange-100 text-orange-800" : category === "meeting_scheduled" ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"; }
