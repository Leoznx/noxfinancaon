import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isBefore,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Phone,
  RefreshCw,
  UserRound,
  UserRoundCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteSellerAppointment,
  buildShortNameValueMap,
  fetchCloserAvailability,
  firstNameOnly,
  getSharedMeetingMetadata,
  rescheduleSharedMeeting,
  scheduleSdrCloserMeeting,
  type CloserAvailabilitySlot,
  type SellerAppointment,
} from "@/lib/seller-agenda";
import { formatBrazilianPhoneInput, isValidBrazilianPhone } from "@/lib/seller-clients";

type MeetingClientType = "autonomo" | "corretor" | "imobiliaria";

type Props = {
  sellerType: "sdr" | "closer" | null;
  sellerId: string | null;
  sellerName: string | null;
  appointments: SellerAppointment[];
  onRefresh: () => Promise<void>;
};

const CLIENT_TYPES: Array<{
  value: MeetingClientType;
  label: string;
  description: string;
  icon: typeof UserRound;
}> = [
  { value: "autonomo", label: "Autônomo", description: "Profissional independente", icon: UserRound },
  { value: "corretor", label: "Corretor", description: "Corretor de imóveis", icon: UserRoundCheck },
  { value: "imobiliaria", label: "Imobiliária", description: "Empresa ou agência", icon: Building2 },
];

export function SharedSalesAgenda({ sellerType, sellerId, sellerName, appointments, onRefresh }: Props) {
  if (sellerType === "sdr") return <SdrScheduler sellerName={sellerName} onRefresh={onRefresh} />;
  if (sellerType === "closer") {
    return (
      <CloserCountdown
        sellerId={sellerId}
        sellerName={sellerName}
        appointments={appointments}
        onRefresh={onRefresh}
      />
    );
  }
  return null;
}

function SdrScheduler({ sellerName, onRefresh }: { sellerName: string | null; onRefresh: () => Promise<void> }) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [month, setMonth] = useState(() => startOfMonth(today));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [slots, setSlots] = useState<CloserAvailabilitySlot[]>([]);
  const [selected, setSelected] = useState<CloserAvailabilitySlot | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clientType, setClientType] = useState<MeetingClientType | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [agencyName, setAgencyName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [observation, setObservation] = useState("");
  const slotRequestId = useRef(0);

  const closerNames = useMemo(
    () => buildShortNameMap(slots.map((slot) => ({ id: slot.closer_id, name: slot.closer_name }))),
    [slots],
  );

  async function loadSlots(date: Date) {
    const requestId = ++slotRequestId.current;
    setLoadingSlots(true);
    setSlots([]);
    setSelected(null);
    try {
      const available = await fetchCloserAvailability(date, 1);
      if (requestId === slotRequestId.current) setSlots(available);
    } catch (error) {
      if (requestId === slotRequestId.current) {
        toast.error(error instanceof Error ? error.message : "Não foi possível consultar a agenda dos Closers.");
      }
    } finally {
      if (requestId === slotRequestId.current) setLoadingSlots(false);
    }
  }

  function chooseDate(date: Date) {
    setSelectedDate(date);
    void loadSlots(date);
  }

  function changeMonth(nextMonth: Date) {
    slotRequestId.current += 1;
    setMonth(startOfMonth(nextMonth));
    setSelectedDate(null);
    setSelected(null);
    setSlots([]);
    setLoadingSlots(false);
  }

  function resetClientForm() {
    setClientType(null);
    setFirstName("");
    setLastName("");
    setAgencyName("");
    setContactPhone("");
    setObservation("");
  }

  async function schedule() {
    if (!selected || !selectedDate) return;
    const typeConfig = CLIENT_TYPES.find((type) => type.value === clientType);
    const personName = `${firstName.trim()} ${lastName.trim()}`.trim();
    const contactName = clientType === "imobiliaria" ? agencyName.trim() : personName;

    if (!typeConfig) {
      toast.error("Selecione o tipo de cliente.");
      return;
    }
    if (clientType === "imobiliaria" ? agencyName.trim().length < 2 : firstName.trim().length < 2 || lastName.trim().length < 2) {
      toast.error(clientType === "imobiliaria" ? "Informe o nome da imobiliária." : "Informe o nome e o sobrenome do cliente.");
      return;
    }
    if (!isValidBrazilianPhone(contactPhone)) {
      toast.error("Informe um telefone válido com DDD.");
      return;
    }

    setSaving(true);
    try {
      const notes = [
        `Tipo de cliente: ${typeConfig.label}`,
        sellerName?.trim() ? `SDR responsável: ${sellerName.trim()}` : null,
        observation.trim() ? `Observação: ${observation.trim()}` : null,
      ].filter(Boolean).join("\n");
      await scheduleSdrCloserMeeting({
        slotStart: selected.slot_start,
        title: `Apresentação NOX — ${contactName}`,
        contactName,
        contactPhone,
        notes,
      });
      toast.success(`Reunião distribuída para ${closerNames.get(selected.closer_id) ?? firstNameOnly(selected.closer_name)}.`);
      resetClientForm();
      setSelected(null);
      await Promise.all([loadSlots(selectedDate), onRefresh()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível agendar a reunião.");
      await loadSlots(selectedDate);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-yellow-300 bg-[linear-gradient(135deg,#fffbea,#fff)] shadow-sm">
      <header className="flex flex-col gap-3 border-b border-yellow-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-yellow-700">Agenda compartilhada SDR → Closer</p>
          <h2 className="mt-1 text-lg font-black text-neutral-950">{selected ? "Complete a marcação do cliente" : "Escolha o melhor dia e horário"}</h2>
          <p className="mt-1 text-xs font-medium text-neutral-600">
            {selected ? "O Closer continua sendo definido automaticamente pela disponibilidade da equipe." : "Abra um dia útil no calendário mensal para consultar os horários atualizados."}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider">
          <span className={`rounded-full px-3 py-1.5 ${selected ? "bg-neutral-100 text-neutral-500" : "bg-neutral-950 text-yellow-300"}`}>1. Data e hora</span>
          <span className={`rounded-full px-3 py-1.5 ${selected ? "bg-neutral-950 text-yellow-300" : "bg-white text-neutral-400"}`}>2. Cliente</span>
        </div>
      </header>

      {selected ? (
        <ClientBookingForm
          selected={selected}
          closerName={closerNames.get(selected.closer_id) ?? firstNameOnly(selected.closer_name)}
          clientType={clientType}
          firstName={firstName}
          lastName={lastName}
          agencyName={agencyName}
          contactPhone={contactPhone}
          observation={observation}
          saving={saving}
          onClientTypeChange={setClientType}
          onFirstNameChange={setFirstName}
          onLastNameChange={setLastName}
          onAgencyNameChange={setAgencyName}
          onPhoneChange={(value) => setContactPhone(formatBrazilianPhoneInput(value))}
          onObservationChange={setObservation}
          onBack={() => {
            setSelected(null);
            resetClientForm();
          }}
          onSubmit={() => void schedule()}
        />
      ) : (
        <div className="grid gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)]">
          <AvailabilityCalendar month={month} today={today} selectedDate={selectedDate} onDateSelect={chooseDate} onMonthChange={changeMonth} />
          <AvailableTimes
            date={selectedDate}
            slots={slots}
            loading={loadingSlots}
            closerNames={closerNames}
            onRefresh={() => selectedDate && void loadSlots(selectedDate)}
            onSelect={setSelected}
          />
        </div>
      )}
    </section>
  );
}

function AvailabilityCalendar({ month, today, selectedDate, onDateSelect, onMonthChange }: {
  month: Date;
  today: Date;
  selectedDate: Date | null;
  onDateSelect: (date: Date) => void;
  onMonthChange: (date: Date) => void;
}) {
  const firstGridDay = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
  const lastGridDay = endOfWeek(endOfMonth(month), { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: firstGridDay, end: lastGridDay });
  const currentMonth = startOfMonth(today);

  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-3 py-3 sm:px-4">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-neutral-400">Calendário mensal</p>
          <h3 className="mt-0.5 text-base font-black capitalize text-neutral-950">{format(month, "MMMM 'de' yyyy", { locale: ptBR })}</h3>
        </div>
        <div className="flex items-center gap-1.5">
          <Button type="button" size="icon" variant="outline" className="h-8 w-8" disabled={!isBefore(currentMonth, month)} aria-label="Mês anterior" onClick={() => onMonthChange(subMonths(month, 1))}><ChevronLeft className="h-4 w-4" /></Button>
          <Button type="button" variant="outline" className="h-8 px-2.5 text-[11px] font-bold sm:px-3" onClick={() => onMonthChange(currentMonth)}>Hoje</Button>
          <Button type="button" size="icon" variant="outline" className="h-8 w-8" aria-label="Próximo mês" onClick={() => onMonthChange(addMonths(month, 1))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-neutral-100 bg-neutral-50/80">
        {["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"].map((weekday) => <div key={weekday} className="py-2 text-center text-[8px] font-black tracking-wider text-neutral-400 sm:text-[10px]">{weekday}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, index) => {
          const outside = !isSameMonth(day, month);
          const weekend = day.getDay() === 0 || day.getDay() === 6;
          const past = isBefore(startOfDay(day), today);
          const disabled = outside || weekend || past;
          const active = !!selectedDate && isSameDay(day, selectedDate);
          return (
            <button
              key={day.toISOString()}
              type="button"
              disabled={disabled}
              onClick={() => onDateSelect(day)}
              aria-label={`${format(day, "EEEE, d 'de' MMMM", { locale: ptBR })}${disabled ? ", indisponível" : ""}`}
              className={`relative min-h-12 border-b border-r border-neutral-100 p-1.5 text-left transition sm:min-h-16 sm:p-2 ${index % 7 === 6 ? "border-r-0" : ""} ${outside ? "bg-neutral-50/70 text-neutral-200" : weekend || past ? "cursor-not-allowed bg-neutral-50/40 text-neutral-300" : active ? "bg-neutral-950 text-white ring-2 ring-inset ring-yellow-400" : "bg-white text-neutral-700 hover:bg-yellow-50"}`}
            >
              <span className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-black sm:h-7 sm:w-7 sm:text-xs ${isToday(day) && !active ? "bg-yellow-400 text-neutral-950" : ""}`}>{format(day, "d")}</span>
              {!disabled && <span className={`absolute bottom-1.5 left-1.5 hidden text-[8px] font-bold uppercase tracking-wider sm:block ${active ? "text-yellow-300" : "text-neutral-400"}`}>Selecionar</span>}
            </button>
          );
        })}
      </div>
      <p className="border-t border-neutral-100 bg-neutral-50/70 px-3 py-2 text-[10px] font-medium text-neutral-500">Atendimentos de segunda a sexta. Dias passados e fins de semana ficam desabilitados.</p>
    </div>
  );
}

function AvailableTimes({ date, slots, loading, closerNames, onRefresh, onSelect }: {
  date: Date | null;
  slots: CloserAvailabilitySlot[];
  loading: boolean;
  closerNames: Map<string, string>;
  onRefresh: () => void;
  onSelect: (slot: CloserAvailabilitySlot) => void;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-neutral-200 bg-white p-3 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-neutral-400">Horários disponíveis</p>
          <h3 className="mt-1 text-sm font-black capitalize text-neutral-950">{date ? format(date, "EEEE, dd 'de' MMMM", { locale: ptBR }) : "Selecione um dia"}</h3>
        </div>
        {date && <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label="Atualizar horários" onClick={onRefresh} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></Button>}
      </div>
      {!date ? (
        <div className="mt-4 grid min-h-44 place-items-center rounded-xl border border-dashed border-yellow-300 bg-yellow-50/60 p-5 text-center"><div><CalendarClock className="mx-auto h-7 w-7 text-yellow-700" /><p className="mt-2 text-sm font-black text-neutral-800">Abra uma data no calendário</p><p className="mt-1 text-xs leading-5 text-neutral-500">Os horários livres serão consultados naquele momento.</p></div></div>
      ) : loading ? (
        <div className="mt-4 space-y-2">{Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-12 animate-pulse rounded-xl bg-neutral-100" />)}</div>
      ) : slots.length === 0 ? (
        <div className="mt-4 grid min-h-44 place-items-center rounded-xl border border-dashed border-neutral-200 bg-neutral-50 p-5 text-center"><div><Clock3 className="mx-auto h-7 w-7 text-neutral-400" /><p className="mt-2 text-sm font-black text-neutral-800">Sem horários livres neste dia</p><p className="mt-1 text-xs leading-5 text-neutral-500">Escolha outra data ou atualize novamente daqui a pouco.</p></div></div>
      ) : (
        <div className="mt-4 grid max-h-[360px] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-2">
          {slots.map((slot) => (
            <button key={`${slot.slot_start}-${slot.closer_id}`} type="button" onClick={() => onSelect(slot)} className="min-h-14 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-left transition hover:border-yellow-400 hover:bg-yellow-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400">
              <strong className="block text-sm font-black text-neutral-950">{new Date(slot.slot_start).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</strong>
              <span className="mt-0.5 block truncate text-[10px] font-semibold text-neutral-500">Closer {closerNames.get(slot.closer_id) ?? firstNameOnly(slot.closer_name)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ClientBookingForm({ selected, closerName, clientType, firstName, lastName, agencyName, contactPhone, observation, saving, onClientTypeChange, onFirstNameChange, onLastNameChange, onAgencyNameChange, onPhoneChange, onObservationChange, onBack, onSubmit }: {
  selected: CloserAvailabilitySlot;
  closerName: string;
  clientType: MeetingClientType | null;
  firstName: string;
  lastName: string;
  agencyName: string;
  contactPhone: string;
  observation: string;
  saving: boolean;
  onClientTypeChange: (type: MeetingClientType) => void;
  onFirstNameChange: (value: string) => void;
  onLastNameChange: (value: string) => void;
  onAgencyNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onObservationChange: (value: string) => void;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <form className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-black text-neutral-600 hover:text-neutral-950"><ArrowLeft className="h-4 w-4" />Trocar dia ou horário</button>
      <div className="grid gap-3 rounded-2xl border border-yellow-300 bg-yellow-50 p-4 sm:grid-cols-3">
        <SummaryItem label="Data" value={new Date(selected.slot_start).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })} />
        <SummaryItem label="Horário" value={new Date(selected.slot_start).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} />
        <SummaryItem label="Closer" value={closerName} />
      </div>

      <fieldset>
        <legend className="text-xs font-black uppercase tracking-widest text-neutral-600">Qual é o tipo de cliente?</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {CLIENT_TYPES.map((type) => {
            const Icon = type.icon;
            const active = clientType === type.value;
            return <button key={type.value} type="button" onClick={() => onClientTypeChange(type.value)} className={`flex min-h-16 items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${active ? "border-neutral-950 bg-neutral-950 text-white ring-2 ring-yellow-400" : "border-neutral-200 bg-white text-neutral-700 hover:border-yellow-400"}`}><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${active ? "bg-yellow-400 text-neutral-950" : "bg-yellow-50 text-yellow-700"}`}><Icon className="h-4 w-4" /></span><span><strong className="block text-sm">{type.label}</strong><span className={`text-[10px] ${active ? "text-neutral-300" : "text-neutral-500"}`}>{type.description}</span></span></button>;
          })}
        </div>
      </fieldset>

      {clientType === "imobiliaria" ? (
        <Field label="Nome da imobiliária" required><Input value={agencyName} onChange={(event) => onAgencyNameChange(event.target.value)} placeholder="Nome da imobiliária" disabled={saving} autoComplete="organization" /></Field>
      ) : clientType ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome" required><Input value={firstName} onChange={(event) => onFirstNameChange(event.target.value)} placeholder="Primeiro nome" disabled={saving} autoComplete="given-name" /></Field>
          <Field label="Sobrenome" required><Input value={lastName} onChange={(event) => onLastNameChange(event.target.value)} placeholder="Sobrenome" disabled={saving} autoComplete="family-name" /></Field>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Telefone com DDD" required><div className="relative"><Phone className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-neutral-400" /><Input type="tel" inputMode="tel" value={contactPhone} onChange={(event) => onPhoneChange(event.target.value)} placeholder="(47) 99999-9999" maxLength={15} disabled={saving} className="pl-9" autoComplete="tel-national" /></div></Field>
        <Field label="Observação (opcional)"><Textarea value={observation} onChange={(event) => onObservationChange(event.target.value)} placeholder="Contexto importante para o Closer" disabled={saving} className="min-h-10 sm:min-h-10" /></Field>
      </div>

      <Button type="submit" className="h-12 w-full bg-yellow-400 font-black text-neutral-950 hover:bg-yellow-500" disabled={saving || !clientType}>
        {saving ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
        {saving ? "Distribuindo reunião..." : "Confirmar marcação e enviar ao Closer"}
      </Button>
    </form>
  );
}

function Field({ label, required = false, children }: { label: string; required?: boolean; children: ReactNode }) {
  return <label className="block text-[11px] font-black uppercase tracking-wider text-neutral-600">{label}{required && <span className="text-red-500"> *</span>}<span className="mt-1.5 block normal-case tracking-normal">{children}</span></label>;
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[9px] font-black uppercase tracking-wider text-yellow-800">{label}</p><p className="mt-1 text-sm font-black capitalize text-neutral-950">{value}</p></div>;
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
  const metadata = getSharedMeetingMetadata(meeting.notes);
  const sdrNames = buildShortNameValueMap(appointments.map((item) => getSharedMeetingMetadata(item.notes).sdrName));

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
          <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-yellow-400">Próxima reunião</p><h2 className="mt-1 text-lg font-black">{meeting.title}</h2><p className="mt-1 text-xs text-neutral-300">{meeting.contact_name || "Contato não informado"}</p>{metadata.sdrName && <p className="mt-1 text-[11px] font-bold text-yellow-300">Qualificada por {sdrNames.get(metadata.sdrName) ?? firstNameOnly(metadata.sdrName)}{metadata.clientType ? ` · ${metadata.clientType}` : ""}</p>}</div>
        </div>
        <div className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-center"><p className="font-mono text-3xl font-black text-yellow-400">{String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}</p><p className="text-[9px] font-bold uppercase tracking-widest text-neutral-400">para começar</p></div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-neutral-300">
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

function buildShortNameMap(members: Array<{ id: string; name: string }>) {
  const uniqueMembers = [...new Map(members.map((member) => [member.id, { ...member, name: normalizeName(member.name) }])).values()];
  const firstNameCounts = new Map<string, number>();
  for (const member of uniqueMembers) {
    const key = firstNameOnly(member.name).toLocaleLowerCase("pt-BR");
    firstNameCounts.set(key, (firstNameCounts.get(key) ?? 0) + 1);
  }
  return new Map(uniqueMembers.map((member) => {
    const pieces = member.name.split(" ");
    const duplicated = (firstNameCounts.get(pieces[0].toLocaleLowerCase("pt-BR")) ?? 0) > 1;
    return [member.id, duplicated ? pieces.slice(0, 2).join(" ") : pieces[0]];
  }));
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ") || "Closer";
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
