import { useEffect, useMemo, useState } from "react";
import { addDays, format, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarCheck2, CalendarClock, Clock3, Mail, Phone, RefreshCw, UserRound, UserRoundCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteSellerAppointment,
  fetchCloserAvailability,
  isSharedAgendaBusinessDay,
  rescheduleSharedMeeting,
  scheduleSdrCloserMeeting,
  SHARED_AGENDA_DURATION_MINUTES,
  type CloserAvailabilitySlot,
  type SellerAppointment,
} from "@/lib/seller-agenda";
import { formatBrazilianPhoneInput, isValidBrazilianPhone } from "@/lib/seller-clients";

const AVAILABILITY_WINDOW_DAYS = 30;
const AUTO_REFRESH_MS = 30_000;

type Props = {
  sellerType: "sdr" | "closer" | null;
  sellerId: string | null;
  appointments: SellerAppointment[];
  onRefresh: () => Promise<void>;
};

export function SharedSalesAgenda({ sellerType, sellerId, appointments, onRefresh }: Props) {
  if (sellerType === "sdr") return <SdrScheduler onRefresh={onRefresh} />;
  if (sellerType === "closer") {
    return (
      <CloserCountdown
        sellerId={sellerId}
        appointments={appointments}
        onRefresh={onRefresh}
      />
    );
  }
  return null;
}

function SdrScheduler({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [slots, setSlots] = useState<CloserAvailabilitySlot[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selected, setSelected] = useState<CloserAvailabilitySlot | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [saving, setSaving] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  async function loadSlots(silent = false) {
    if (!silent) setLoadingSlots(true);
    try {
      setSlots(await fetchCloserAvailability(new Date(), AVAILABILITY_WINDOW_DAYS));
    } catch (error) {
      if (!silent) toast.error(error instanceof Error ? error.message : "Não foi possível consultar a agenda dos Closers.");
    } finally {
      if (!silent) setLoadingSlots(false);
    }
  }

  // Carrega uma vez e depois mantém a disponibilidade sempre atualizada com
  // o que os outros SDRs estão agendando (evita horários fantasmas).
  useEffect(() => {
    void loadSlots();
    const timer = window.setInterval(() => void loadSlots(true), AUTO_REFRESH_MS);
    const onFocus = () => void loadSlots(true);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const slotsByDay = useMemo(() => {
    const grouped = new Map<string, CloserAvailabilitySlot[]>();
    for (const slot of slots) {
      const key = format(new Date(slot.slot_start), "yyyy-MM-dd");
      grouped.set(key, [...(grouped.get(key) ?? []), slot]);
    }
    return grouped;
  }, [slots]);

  const today = useMemo(() => startOfDay(new Date()), []);
  const maxSelectableDate = useMemo(() => addDays(today, AVAILABILITY_WINDOW_DAYS - 1), [today]);

  // Escolhe automaticamente o primeiro dia com vaga assim que os horários
  // carregam, para o SDR já ver as opções sem precisar navegar no calendário.
  useEffect(() => {
    if (loadingSlots) return;
    if (selectedDate && slotsByDay.has(format(selectedDate, "yyyy-MM-dd"))) return;
    const firstAvailable = [...slotsByDay.keys()].sort()[0];
    setSelectedDate(firstAvailable ? new Date(`${firstAvailable}T00:00:00`) : undefined);
  }, [loadingSlots, slotsByDay, selectedDate]);

  // Se o horário escolhido acabou de ser ocupado por outro SDR, limpa a
  // seleção para não deixar confirmar algo que já não existe mais.
  useEffect(() => {
    if (selected && !slots.some((slot) => slot.slot_start === selected.slot_start && slot.closer_id === selected.closer_id)) {
      setSelected(null);
    }
  }, [slots, selected]);

  const daySlots = selectedDate ? (slotsByDay.get(format(selectedDate, "yyyy-MM-dd")) ?? []) : [];

  function isDayDisabled(date: Date) {
    const day = startOfDay(date);
    if (day < today || day > maxSelectableDate) return true;
    if (!isSharedAgendaBusinessDay(date)) return true;
    if (!loadingSlots && !slotsByDay.has(format(day, "yyyy-MM-dd"))) return true;
    return false;
  }

  async function schedule() {
    if (!selected) {
      toast.error("Escolha um horário disponível no calendário.");
      return;
    }
    if (contactName.trim().length < 3) {
      toast.error("Informe o nome completo do lead.");
      return;
    }
    if (!isValidBrazilianPhone(contactPhone)) {
      toast.error("Informe um telefone válido com DDD.");
      return;
    }
    setSaving(true);
    try {
      await scheduleSdrCloserMeeting({
        slotStart: selected.slot_start,
        title: `Apresentação NOX — ${contactName.trim()}`,
        contactName: contactName.trim(),
        contactPhone,
      });
      toast.success(`Reunião distribuída para ${selected.closer_name}.`);
      setSelected(null);
      setContactName("");
      setContactPhone("");
      await Promise.all([loadSlots(), onRefresh()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível agendar a reunião.");
      await loadSlots();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-yellow-300 bg-[linear-gradient(120deg,#fffbea,#fff)] shadow-sm">
      <header className="flex flex-col gap-3 border-b border-yellow-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-yellow-700">Agenda compartilhada SDR → Closer</p>
          <h2 className="mt-1 text-lg font-black text-neutral-950">Agende no primeiro horário disponível</h2>
          <p className="mt-1 text-xs font-medium text-neutral-600">
            Seg. a sex., 08:30–17:30 (pausa 12:00–13:30) · reuniões de {SHARED_AGENDA_DURATION_MINUTES} min · o sistema equilibra automaticamente entre os Closers ativos.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void loadSlots()} disabled={loadingSlots}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loadingSlots ? "animate-spin" : ""}`} /> Atualizar horários
        </Button>
      </header>
      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(260px,0.85fr)_minmax(0,1.15fr)]">
        <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4">
          <div>
            <Label htmlFor="sdr-lead-name" className="text-xs font-black uppercase tracking-widest text-neutral-600">Nome completo do lead</Label>
            <div className="relative mt-1.5">
              <UserRound className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-neutral-400" />
              <Input id="sdr-lead-name" value={contactName} onChange={(event) => setContactName(event.target.value)} placeholder="Nome completo" className="h-11 pl-9" disabled={saving} />
            </div>
          </div>
          <div>
            <Label htmlFor="sdr-lead-phone" className="text-xs font-black uppercase tracking-widest text-neutral-600">Telefone / WhatsApp</Label>
            <div className="relative mt-1.5">
              <Phone className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-neutral-400" />
              <Input
                id="sdr-lead-phone"
                type="tel"
                inputMode="tel"
                maxLength={15}
                value={contactPhone}
                onChange={(event) => setContactPhone(formatBrazilianPhoneInput(event.target.value))}
                placeholder="(47) 99999-9999"
                className="h-11 pl-9"
                disabled={saving}
              />
            </div>
          </div>

          <div className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs ${selected ? "border-yellow-300 bg-yellow-50 text-neutral-800" : "border-neutral-200 bg-neutral-50 text-neutral-600"}`}>
            <CalendarCheck2 className={`mt-0.5 h-4 w-4 shrink-0 ${selected ? "text-yellow-700" : "text-neutral-400"}`} />
            {selected ? (
              <span><strong className="capitalize">{formatSlot(selected.slot_start)}</strong><br />Closer responsável: {selected.closer_name}</span>
            ) : "Selecione ao lado uma data e um horário livre da equipe de Closers."}
          </div>

          <Button className="w-full bg-yellow-400 font-black text-neutral-950 hover:bg-yellow-500" onClick={() => void schedule()} disabled={saving || !selected}>
            <CalendarClock className="mr-2 h-4 w-4" /> {saving ? "Distribuindo..." : "Confirmar e distribuir reunião"}
          </Button>
        </div>

        <div className="min-w-0 space-y-3">
          <div className="rounded-xl border border-neutral-200 bg-white p-2 sm:p-3">
            {loadingSlots && slots.length === 0 ? (
              <div className="h-72 animate-pulse rounded-lg bg-neutral-50" />
            ) : (
              <Calendar
                mode="single"
                locale={ptBR}
                selected={selectedDate}
                onSelect={(date) => {
                  setSelectedDate(date);
                  setSelected(null);
                }}
                disabled={isDayDisabled}
                defaultMonth={selectedDate ?? today}
                modifiers={{ available: (date) => !isDayDisabled(date) }}
                modifiersClassNames={{ available: "font-black text-neutral-950 after:absolute after:bottom-1 after:left-1/2 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-yellow-500" }}
                className="mx-auto w-full max-w-none [--cell-size:2.5rem]"
              />
            )}
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white p-3">
            <p className="mb-2 text-xs font-black capitalize text-neutral-800">
              {selectedDate ? format(selectedDate, "EEEE, dd 'de' MMMM", { locale: ptBR }) : "Selecione uma data"}
            </p>
            {!loadingSlots && selectedDate && daySlots.length === 0 ? (
              <div className="grid min-h-20 place-items-center rounded-lg border border-dashed border-neutral-200 bg-neutral-50/60 p-4 text-center text-xs font-semibold text-neutral-500">Nenhum horário livre neste dia.</div>
            ) : !selectedDate ? (
              <div className="grid min-h-20 place-items-center rounded-lg border border-dashed border-yellow-300 bg-neutral-50/60 p-4 text-center text-xs font-semibold text-neutral-600">
                {loadingSlots ? "Consultando a agenda dos Closers..." : "Nenhum Closer possui horário livre nos próximos dias."}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {daySlots.map((slot) => {
                  const active = selected?.slot_start === slot.slot_start && selected.closer_id === slot.closer_id;
                  return (
                    <button
                      key={`${slot.slot_start}-${slot.closer_id}`}
                      type="button"
                      onClick={() => setSelected(slot)}
                      className={`min-h-11 rounded-xl border px-3 py-2 text-left text-xs transition ${active ? "border-neutral-950 bg-neutral-950 text-white" : "border-neutral-200 bg-white hover:border-yellow-400 hover:bg-yellow-50"}`}
                    >
                      <strong className="block text-sm tabular-nums">{format(new Date(slot.slot_start), "HH:mm")}</strong>
                      <span className={active ? "text-neutral-300" : "text-neutral-500"}>{slot.closer_name.split(" ")[0]}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function CloserCountdown({ sellerId, appointments, onRefresh }: Omit<Props, "sellerType">) {
  const [now, setNow] = useState(() => Date.now());
  const [slots, setSlots] = useState<CloserAvailabilitySlot[]>([]);
  const [rescheduling, setRescheduling] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const meeting = appointments
    .filter((item) => item.source === "sdr_handoff" && ["agendado", "confirmado", "remarcado"].includes(item.status))
    .filter((item) => new Date(item.scheduled_at).getTime() > now)
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0];
  if (!meeting) return null;
  const remaining = new Date(meeting.scheduled_at).getTime() - now;
  if (remaining > 5 * 60_000) return null;
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.max(0, Math.floor((remaining % 60_000) / 1_000));

  async function cancel() {
    if (!sellerId) return;
    try {
      await deleteSellerAppointment(sellerId, meeting!.id);
      toast.success("Reunião cancelada e removida das agendas.");
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível cancelar.");
    }
  }

  async function showSlots() {
    setRescheduling(true);
    try {
      setSlots(await fetchCloserAvailability(new Date(), 7));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível consultar horários.");
    }
  }

  async function reschedule(slot: CloserAvailabilitySlot) {
    try {
      await rescheduleSharedMeeting(meeting!.id, slot.slot_start);
      toast.success("Reunião remarcada e agendas atualizadas.");
      setSlots([]);
      setRescheduling(false);
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível remarcar.");
    }
  }

  return (
    <section className="rounded-2xl border-2 border-yellow-400 bg-neutral-950 p-4 text-white shadow-lg shadow-yellow-300/20">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-yellow-400 text-neutral-950"><Clock3 className="h-5 w-5" /></span>
          <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-yellow-400">Próxima reunião</p><h2 className="mt-1 text-lg font-black">{meeting.title}</h2><p className="mt-1 text-xs text-neutral-300">{meeting.contact_name || "Contato não informado"}</p></div>
        </div>
        <div className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-center"><p className="font-mono text-3xl font-black text-yellow-400">{String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}</p><p className="text-[9px] font-bold uppercase tracking-widest text-neutral-400">para começar</p></div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-neutral-300">
        {meeting.contact_email && <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-yellow-400" />{meeting.contact_email}</span>}
        {meeting.contact_phone && <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-yellow-400" />{meeting.contact_phone}</span>}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => void showSlots()}><UserRoundCheck className="mr-2 h-4 w-4" />Remarcar</Button>
        <Button type="button" variant="outline" className="border-red-400/40 bg-red-500/10 text-red-200 hover:bg-red-500/20 hover:text-red-100" onClick={() => void cancel()}><X className="mr-2 h-4 w-4" />Cancelar e remover</Button>
      </div>
      {rescheduling && (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
          <p className="mb-2 text-xs font-bold text-neutral-200">Escolha um novo horário disponível:</p>
          <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto">
            {slots.slice(0, 24).map((slot) => <button key={`${slot.slot_start}-${slot.closer_id}`} className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-neutral-950 hover:bg-yellow-300" onClick={() => void reschedule(slot)}>{formatSlot(slot.slot_start)}</button>)}
          </div>
        </div>
      )}
    </section>
  );
}

function formatSlot(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
