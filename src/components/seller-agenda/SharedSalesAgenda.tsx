import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Clock3, Mail, Phone, RefreshCw, UserRoundCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteSellerAppointment,
  fetchCloserAvailability,
  rescheduleSharedMeeting,
  scheduleSdrCloserMeeting,
  type CloserAvailabilitySlot,
  type SellerAppointment,
} from "@/lib/seller-agenda";

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
  const [selected, setSelected] = useState<CloserAvailabilitySlot | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [saving, setSaving] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [notes, setNotes] = useState("");

  async function loadSlots() {
    setLoadingSlots(true);
    try {
      setSlots(await fetchCloserAvailability(new Date(), 14));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível consultar a agenda dos Closers.");
    } finally {
      setLoadingSlots(false);
    }
  }

  useEffect(() => {
    void loadSlots();
  }, []);

  async function schedule() {
    if (!selected || contactName.trim().length < 3) {
      toast.error("Informe o contato e escolha um horário disponível.");
      return;
    }
    setSaving(true);
    try {
      await scheduleSdrCloserMeeting({
        slotStart: selected.slot_start,
        title: `Apresentação NOX — ${contactName.trim()}`,
        contactName: contactName.trim(),
        contactEmail,
        contactPhone,
        notes,
      });
      toast.success(`Reunião distribuída para ${selected.closer_name}.`);
      setSelected(null);
      setContactName("");
      setContactEmail("");
      setContactPhone("");
      setNotes("");
      await Promise.all([loadSlots(), onRefresh()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível agendar a reunião.");
      await loadSlots();
    } finally {
      setSaving(false);
    }
  }

  const days = useMemo(() => {
    const grouped = new Map<string, CloserAvailabilitySlot[]>();
    for (const slot of slots.slice(0, 48)) {
      const key = new Date(slot.slot_start).toLocaleDateString("pt-BR", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
      });
      grouped.set(key, [...(grouped.get(key) ?? []), slot]);
    }
    return [...grouped.entries()];
  }, [slots]);

  return (
    <section className="overflow-hidden rounded-2xl border border-yellow-300 bg-[linear-gradient(120deg,#fffbea,#fff)] shadow-sm">
      <header className="flex flex-col gap-3 border-b border-yellow-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-yellow-700">Agenda compartilhada SDR → Closer</p>
          <h2 className="mt-1 text-lg font-black text-neutral-950">Agende no primeiro horário disponível</h2>
          <p className="mt-1 text-xs font-medium text-neutral-600">O sistema equilibra automaticamente as reuniões entre todos os Closers ativos.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void loadSlots()} disabled={loadingSlots}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loadingSlots ? "animate-spin" : ""}`} /> Atualizar horários
        </Button>
      </header>
      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
        <div className="space-y-3 rounded-xl border border-neutral-200 bg-white p-3">
          <label className="block text-xs font-bold text-neutral-700">Contato qualificado</label>
          <Input value={contactName} onChange={(event) => setContactName(event.target.value)} placeholder="Nome do corretor ou responsável" />
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <Input type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} placeholder="E-mail" />
            <Input value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} placeholder="Telefone / WhatsApp" />
          </div>
          <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Resumo da qualificação, dores e contexto da imobiliária..." className="min-h-20" />
          <div className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
            {selected ? (
              <><strong>{formatSlot(selected.slot_start)}</strong><br />Closer responsável: {selected.closer_name}</>
            ) : "Selecione ao lado um horário livre da equipe de Closers."}
          </div>
          <Button className="w-full bg-yellow-400 font-black text-neutral-950 hover:bg-yellow-500" onClick={() => void schedule()} disabled={saving || !selected}>
            <CalendarClock className="mr-2 h-4 w-4" /> {saving ? "Distribuindo..." : "Confirmar e distribuir reunião"}
          </Button>
        </div>

        <div className="min-w-0 space-y-3">
          {loadingSlots ? (
            <div className="h-44 animate-pulse rounded-xl bg-white" />
          ) : days.length === 0 ? (
            <div className="grid min-h-44 place-items-center rounded-xl border border-dashed border-yellow-300 bg-white p-6 text-center text-sm font-semibold text-neutral-600">Nenhum Closer possui horário livre nos próximos 14 dias.</div>
          ) : (
            days.map(([day, daySlots]) => (
              <div key={day} className="rounded-xl border border-neutral-200 bg-white p-3">
                <p className="mb-2 text-xs font-black capitalize text-neutral-800">{day}</p>
                <div className="flex flex-wrap gap-2">
                  {daySlots.map((slot) => {
                    const active = selected?.slot_start === slot.slot_start;
                    return (
                      <button key={`${slot.slot_start}-${slot.closer_id}`} type="button" onClick={() => setSelected(slot)} className={`min-h-11 rounded-xl border px-3 py-2 text-left text-xs transition ${active ? "border-neutral-950 bg-neutral-950 text-white" : "border-neutral-200 bg-white hover:border-yellow-400 hover:bg-yellow-50"}`}>
                        <strong className="block text-sm">{new Date(slot.slot_start).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</strong>
                        <span className={active ? "text-neutral-300" : "text-neutral-500"}>{slot.closer_name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
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
