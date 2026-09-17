import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addMonths, format, isBefore, startOfDay, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarClock, Check, Clock3, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  AGENDA_BUSINESS_HOURS_LABEL,
  fetchMeetingRescheduleSlots,
  rescheduleSellerMeeting,
  type CloserAvailabilitySlot,
  type SellerAppointment,
} from "@/lib/seller-agenda";

export function MeetingRescheduleDialog({
  item,
  onClose,
  onRescheduled,
}: {
  item: SellerAppointment | null;
  onClose: () => void;
  onRescheduled: (date: Date) => Promise<void>;
}) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [month, setMonth] = useState(today);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [slots, setSlots] = useState<CloserAvailabilitySlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<CloserAvailabilitySlot | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const realtimeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appointmentId = item?.id ?? null;
  const closerId = item ? item.assigned_closer_id || item.seller_id : null;

  const loadSlots = useCallback(async (date: Date, silent = false) => {
    if (!appointmentId) return;
    const currentRequest = ++requestId.current;
    if (!silent) setLoading(true);
    setError("");
    try {
      const nextSlots = await fetchMeetingRescheduleSlots(appointmentId, date, 1);
      if (currentRequest !== requestId.current) return;
      setSlots(nextSlots);
      setSelectedSlot((current) => nextSlots.find((slot) => slot.slot_start === current?.slot_start) ?? null);
    } catch (cause) {
      if (currentRequest !== requestId.current) return;
      setSlots([]);
      setSelectedSlot(null);
      setError(cause instanceof Error ? cause.message : "Não foi possível consultar os horários livres.");
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [appointmentId]);

  useEffect(() => {
    if (!item) return;
    const scheduledDate = startOfDay(new Date(item.scheduled_at));
    const initialDate = nextBusinessDay(isBefore(scheduledDate, today) ? today : scheduledDate);
    setMonth(startOfMonth(initialDate));
    setSelectedDate(initialDate);
    setSlots([]);
    setSelectedSlot(null);
    setError("");
    void loadSlots(initialDate);
  }, [item, loadSlots, today]);

  useEffect(() => {
    if (!item || !closerId || !selectedDate) return;
    const refreshAvailability = () => {
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
      realtimeTimer.current = setTimeout(() => void loadSlots(selectedDate, true), 200);
    };
    const channel = supabase
      .channel(`meeting-reschedule-${item.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "seller_agenda_availability_events",
          filter: `closer_id=eq.${closerId}`,
        },
        refreshAvailability,
      )
      .subscribe();
    return () => {
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
      supabase.removeChannel(channel);
    };
  }, [closerId, item, loadSlots, selectedDate]);

  async function chooseDate(date?: Date) {
    if (!date) return;
    setSelectedDate(date);
    setSelectedSlot(null);
    await loadSlots(date);
  }

  async function confirm() {
    if (!item || !selectedDate || !selectedSlot || saving) return;
    setSaving(true);
    setError("");
    try {
      await rescheduleSellerMeeting(item.id, selectedSlot.slot_start);
      const newDate = new Date(selectedSlot.slot_start);
      toast.success("Reunião reagendada. As agendas do SDR e do Closer já foram atualizadas.");
      onClose();
      await onRescheduled(newDate);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Não foi possível reagendar a reunião.";
      setError(message);
      toast.error(message);
      await loadSlots(selectedDate, true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl overflow-hidden p-0">
        <DialogHeader className="border-b border-neutral-100 px-5 py-4">
          <div className="flex items-start gap-3 pr-8">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-yellow-100 text-yellow-800">
              <CalendarClock className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-lg font-black">Reagendar reunião</DialogTitle>
              <p className="mt-1 truncate text-xs text-neutral-500">{item?.title}</p>
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-4 px-4 py-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:px-5">
          <div className="rounded-2xl border border-neutral-200 bg-white p-1">
            <Calendar
              mode="single"
              locale={ptBR}
              month={month}
              onMonthChange={setMonth}
              selected={selectedDate ?? undefined}
              onSelect={(date) => void chooseDate(date)}
              startMonth={startOfMonth(today)}
              endMonth={addMonths(startOfMonth(today), 12)}
              disabled={(date) => isUnavailableDate(date, today)}
              className="mx-auto"
            />
          </div>

          <div className="min-w-0 rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.14em] text-neutral-400">2. Escolha o horário</p>
                <p className="mt-1 text-sm font-black capitalize text-neutral-900">
                  {selectedDate ? format(selectedDate, "EEEE, dd 'de' MMMM", { locale: ptBR }) : "Selecione uma data"}
                </p>
              </div>
              {selectedDate ? (
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => void loadSlots(selectedDate)} disabled={loading} aria-label="Atualizar horários">
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                </Button>
              ) : null}
            </div>

            {loading ? (
              <div className="grid min-h-52 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-yellow-700" /></div>
            ) : slots.length ? (
              <div className="mt-3 grid max-h-64 grid-cols-2 gap-2 overflow-y-auto pr-1">
                {slots.map((slot) => {
                  const active = selectedSlot?.slot_start === slot.slot_start;
                  return (
                    <button
                      type="button"
                      key={slot.slot_start}
                      onClick={() => setSelectedSlot(slot)}
                      className={`rounded-xl border px-3 py-2.5 text-left transition ${active ? "border-neutral-950 bg-neutral-950 text-white" : "border-neutral-200 bg-white text-neutral-900 hover:border-yellow-400 hover:bg-yellow-50"}`}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-black"><Clock3 className="h-3.5 w-3.5" />{format(new Date(slot.slot_start), "HH:mm")}</span>
                      <span className={`mt-1 block truncate text-[9px] font-semibold ${active ? "text-neutral-300" : "text-neutral-500"}`}>{slot.closer_name} · 1 hora</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="mt-3 grid min-h-52 place-items-center rounded-xl border border-dashed border-neutral-200 bg-white p-4 text-center">
                <div><Clock3 className="mx-auto h-6 w-6 text-neutral-300" /><p className="mt-2 text-sm font-black text-neutral-700">Sem horários livres</p><p className="mt-1 text-xs text-neutral-500">Escolha outro dia no calendário.</p></div>
              </div>
            )}
          </div>
        </div>

        <div className="mx-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[10px] font-semibold leading-4 text-emerald-900 sm:mx-5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          O horário é validado novamente ao confirmar e desaparece automaticamente dos outros logins quando for ocupado.
        </div>
        <p className="px-4 pt-3 text-[10px] leading-4 text-neutral-500 sm:px-5">{AGENDA_BUSINESS_HOURS_LABEL}</p>
        {error ? <p role="alert" className="mx-4 mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 sm:mx-5">{error}</p> : null}

        <DialogFooter className="mt-4 border-t border-neutral-100 px-4 py-4 sm:px-5">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button type="button" className="bg-yellow-400 font-black text-neutral-950 hover:bg-yellow-500" onClick={() => void confirm()} disabled={!selectedSlot || saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            {saving ? "Confirmando..." : "Confirmar reagendamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function isUnavailableDate(date: Date, today: Date) {
  const weekday = date.getDay();
  return isBefore(startOfDay(date), today) || weekday === 0 || weekday === 6;
}

function nextBusinessDay(date: Date) {
  const next = new Date(date);
  while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
  return next;
}
