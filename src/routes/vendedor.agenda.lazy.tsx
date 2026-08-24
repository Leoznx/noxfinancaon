import { createLazyFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { endOfWeek, format, isSameDay, isSameMonth, isWithinInterval, startOfMonth, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, CalendarClock, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AgendaCalendar } from "@/components/seller-agenda/AgendaCalendar";
import { AgendaControls } from "@/components/seller-agenda/AgendaControls";
import { AgendaDayPanel } from "@/components/seller-agenda/AgendaDayPanel";
import { AgendaSummaryCards } from "@/components/seller-agenda/AgendaSummaryCards";
import { AppointmentCard } from "@/components/seller-agenda/AppointmentCard";
import { AppointmentDetailsDialog } from "@/components/seller-agenda/AppointmentDetailsDialog";
import { AppointmentModal } from "@/components/seller-agenda/AppointmentModal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  appointmentMatchesFilter,
  deleteSellerAppointment,
  fetchSellerAgenda,
  saveSellerAppointment,
  setSellerAppointmentStatus,
  type AgendaClientOption,
  type AgendaFilter,
  type AgendaLeadOption,
  type AgendaSummary,
  type AgendaViewMode,
  type AppointmentDraft,
  type SellerAppointment,
} from "@/lib/seller-agenda";
import { getSellerContext } from "@/lib/vendedor-portal";

export const Route = createLazyFileRoute("/vendedor/agenda")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin"]} moduleKey="agenda">
      <AgendaPage />
    </ProtectedRoute>
  ),
});

const EMPTY_SUMMARY: AgendaSummary = { today: 0, thisWeek: 0, pendingFollowups: 0, scheduledMeetings: 0 };
type ListScope = "month" | "week";

function AgendaPage() {
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [appointments, setAppointments] = useState<SellerAppointment[]>([]);
  const [leads, setLeads] = useState<AgendaLeadOption[]>([]);
  const [clients, setClients] = useState<AgendaClientOption[]>([]);
  const [summary, setSummary] = useState<AgendaSummary>(EMPTY_SUMMARY);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [view, setView] = useState<AgendaViewMode>("calendario");
  const [filter, setFilter] = useState<AgendaFilter>("todos");
  const [listScope, setListScope] = useState<ListScope>("month");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SellerAppointment | null>(null);
  const [viewing, setViewing] = useState<SellerAppointment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SellerAppointment | null>(null);
  const realtimeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const context = await getSellerContext();
      if (!context.isSeller || !context.sellerId) throw new Error("Não encontramos um vendedor ativo para este usuário.");
      setSellerId(context.sellerId);
      const data = await fetchSellerAgenda(context.sellerId, month);
      setAppointments(data.appointments);
      setSummary(data.summary);
      setLeads(data.leads);
      setClients(data.clients);
      setViewing((current) => current ? data.appointments.find((item) => item.id === current.id) ?? null : null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar sua agenda.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [month]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) setView("lista");
  }, []);

  useEffect(() => {
    if (!sellerId) return;
    const scheduleRefresh = () => {
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
      realtimeTimer.current = setTimeout(() => load(true), 250);
    };
    const channel = supabase
      .channel(`seller-agenda-${sellerId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "seller_appointments", filter: `seller_id=eq.${sellerId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_leads", filter: `assigned_seller_id=eq.${sellerId}` }, scheduleRefresh)
      .subscribe();
    return () => {
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
      supabase.removeChannel(channel);
    };
  }, [sellerId, load]);

  const filtered = useMemo(() => appointments.filter((item) => appointmentMatchesFilter(item, filter)), [appointments, filter]);
  const selectedItems = useMemo(() => filtered.filter((item) => isSameDay(new Date(item.scheduled_at), selectedDate)), [filtered, selectedDate]);
  const weekInterval = useMemo(() => ({ start: startOfWeek(selectedDate, { weekStartsOn: 1 }), end: endOfWeek(selectedDate, { weekStartsOn: 1 }) }), [selectedDate]);
  const listItems = useMemo(() => filtered
    .filter((item) => listScope === "week"
      ? isWithinInterval(new Date(item.scheduled_at), weekInterval)
      : isSameMonth(new Date(item.scheduled_at), month))
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()), [filtered, listScope, month, weekInterval]);
  const overdueCount = useMemo(() => appointments.filter((item) => new Date(item.scheduled_at) < new Date() && !["concluido", "cancelado"].includes(item.status)).length, [appointments]);

  function openNew(date = selectedDate) {
    setSelectedDate(date);
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(item: SellerAppointment) {
    setViewing(null);
    setEditing(item);
    setModalOpen(true);
  }

  function selectDate(date: Date) {
    setSelectedDate(date);
    if (!isSameMonth(date, month)) setMonth(startOfMonth(date));
  }

  function changeMonth(nextMonth: Date) {
    const normalized = startOfMonth(nextMonth);
    setMonth(normalized);
    if (!isSameMonth(selectedDate, normalized)) setSelectedDate(normalized);
    setListScope("month");
  }

  async function handleSave(draft: AppointmentDraft) {
    if (!sellerId) throw new Error("Vendedor não identificado.");
    await saveSellerAppointment(sellerId, draft);
    toast.success(draft.id ? "Compromisso atualizado com sucesso." : "Compromisso criado com sucesso.");
    setModalOpen(false);
    setEditing(null);
    setMonth(startOfMonth(new Date(draft.scheduled_at)));
    setSelectedDate(new Date(draft.scheduled_at));
    await load(true);
  }

  async function complete(item: SellerAppointment) {
    if (!sellerId) return;
    const previous = appointments;
    setAppointments((current) => current.map((row) => row.id === item.id ? { ...row, status: "concluido" } : row));
    setViewing(null);
    try {
      await setSellerAppointmentStatus(sellerId, item.id, "concluido");
      toast.success("Compromisso concluído com sucesso.");
      await load(true);
    } catch (statusError) {
      setAppointments(previous);
      toast.error(statusError instanceof Error ? statusError.message : "Não foi possível concluir o compromisso.");
    }
  }

  async function confirmDelete() {
    if (!sellerId || !deleteTarget) return;
    const target = deleteTarget;
    const previous = appointments;
    setAppointments((current) => current.filter((item) => item.id !== target.id));
    setDeleteTarget(null);
    setViewing(null);
    setModalOpen(false);
    try {
      await deleteSellerAppointment(sellerId, target.id);
      toast.success("Compromisso excluído com sucesso.");
      await load(true);
    } catch (deleteError) {
      setAppointments(previous);
      toast.error(deleteError instanceof Error ? deleteError.message : "Não foi possível excluir o compromisso.");
    }
  }

  function handleSummaryAction(action: "today" | "week" | "followups" | "meetings") {
    const today = new Date();
    setMonth(startOfMonth(today));
    setSelectedDate(today);
    if (action === "today") {
      setFilter("todos");
      setView("calendario");
      return;
    }
    setView("lista");
    setListScope(action === "week" ? "week" : "month");
    setFilter(action === "followups" ? "follow_up" : action === "meetings" ? "reuniao" : "todos");
  }

  return (
    <DashboardLayout lockDesktopViewport={view === "calendario"}>
      <main className="space-y-3 pb-4 xl:h-full xl:min-h-0 xl:pb-0">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-yellow-100 text-yellow-800"><CalendarClock className="h-5 w-5" /></span>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-neutral-950">Minha Agenda</h1>
              <p className="text-xs font-medium text-neutral-500 sm:text-sm">Reuniões, retornos, follow-ups e compromissos comerciais.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="h-9 gap-2 font-bold" onClick={() => load(true)} disabled={refreshing}><RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Atualizar</Button>
            <Button type="button" className="h-9 gap-2 bg-yellow-400 font-extrabold text-black hover:bg-yellow-500" onClick={() => openNew()}><Plus className="h-4 w-4" /> Novo compromisso</Button>
          </div>
        </header>

        <AgendaSummaryCards summary={summary} loading={loading} onSelect={handleSummaryAction} />
        {overdueCount > 0 && !loading && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-900"><AlertTriangle className="h-4 w-4 shrink-0" />Você tem {overdueCount} {overdueCount === 1 ? "compromisso pendente que já passou do horário" : "compromissos pendentes que já passaram do horário"}.</div>
        )}
        <AgendaControls view={view} filter={filter} onViewChange={(nextView) => { setView(nextView); if (nextView === "lista") setListScope("month"); }} onFilterChange={setFilter} />

        {error ? <ErrorState message={error} onRetry={() => load()} /> : loading ? <AgendaSkeleton /> : view === "calendario" ? (
          <div className="grid items-start gap-3 xl:min-h-0 xl:grid-cols-[minmax(0,1fr)_340px]">
            <AgendaCalendar month={month} selectedDate={selectedDate} items={filtered} onMonthChange={changeMonth} onDateSelect={selectDate} onEventOpen={setViewing} />
            <AgendaDayPanel date={selectedDate} items={selectedItems} onNew={() => openNew(selectedDate)} onView={setViewing} onEdit={openEdit} onComplete={complete} onDelete={setDeleteTarget} />
          </div>
        ) : (
          <section className="rounded-2xl border border-neutral-200 bg-white p-3 shadow-[0_2px_8px_rgba(0,0,0,0.03)] sm:p-4">
            <div className="mb-3 flex items-center justify-between gap-3 border-b border-neutral-100 pb-3">
              <div><p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-neutral-400">Modo lista</p><h2 className="mt-0.5 text-base font-black capitalize text-neutral-950">{listScope === "week" ? `Semana de ${format(weekInterval.start, "dd/MM")} a ${format(weekInterval.end, "dd/MM")}` : format(month, "MMMM 'de' yyyy", { locale: ptBR })}</h2></div>
              <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-black text-neutral-600">{listItems.length}</span>
            </div>
            {listItems.length === 0 ? (
              <div className="grid min-h-52 place-items-center rounded-xl border border-dashed border-neutral-200 bg-neutral-50/50 p-6 text-center"><div><p className="font-black text-neutral-950">Nenhum compromisso encontrado</p><p className="mt-1 text-sm text-neutral-500">Ajuste o filtro ou crie um novo compromisso para este período.</p><Button className="mt-4 bg-yellow-400 font-bold text-black hover:bg-yellow-500" onClick={() => openNew()}><Plus className="mr-1.5 h-4 w-4" /> Novo compromisso</Button></div></div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">{listItems.map((item) => <AppointmentCard key={item.id} item={item} onView={setViewing} onEdit={openEdit} onComplete={complete} onDelete={setDeleteTarget} />)}</div>
            )}
          </section>
        )}

        <AppointmentModal open={modalOpen} initial={editing} defaultDate={selectedDate} leads={leads} clients={clients} onOpenChange={(open) => { setModalOpen(open); if (!open) setEditing(null); }} onSave={handleSave} onDelete={(item) => { setDeleteTarget(item); setModalOpen(false); }} />
        <AppointmentDetailsDialog item={viewing} onClose={() => setViewing(null)} onEdit={openEdit} onComplete={complete} onDelete={setDeleteTarget} />
        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Excluir compromisso?</AlertDialogTitle><AlertDialogDescription>“{deleteTarget?.title}” será removido da agenda. Se for um follow-up sincronizado, o próximo retorno do lead também será cancelado.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Manter compromisso</AlertDialogCancel><AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" onClick={confirmDelete}>Excluir</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </DashboardLayout>
  );
}

function AgendaSkeleton() {
  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]" aria-label="Carregando agenda">
      <div className="h-[500px] animate-pulse rounded-2xl border border-neutral-200 bg-white p-4"><div className="h-6 w-44 rounded bg-neutral-100" /><div className="mt-4 grid grid-cols-7 gap-2">{Array.from({ length: 35 }).map((_, index) => <div key={index} className="h-14 rounded-lg bg-neutral-50" />)}</div></div>
      <div className="h-96 animate-pulse rounded-2xl border border-neutral-200 bg-white p-5"><div className="h-5 w-32 rounded bg-neutral-100" /><div className="mt-5 h-24 rounded-xl bg-neutral-50" /><div className="mt-3 h-24 rounded-xl bg-neutral-50" /></div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center"><p className="font-black text-red-800">Não foi possível carregar a agenda</p><p className="mx-auto mt-1 max-w-xl text-sm text-red-700">{message}</p><Button variant="outline" className="mt-4 border-red-200 bg-white text-red-700 hover:bg-red-100" onClick={onRetry}>Tentar novamente</Button></div>;
}
