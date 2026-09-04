import { addDays, endOfMonth, endOfWeek, startOfMonth, startOfWeek } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { fetchSellerClients, type SellerClient } from "@/lib/seller-clients";

export type AgendaViewMode = "calendario" | "lista";
export type AgendaFilter =
  | "todos"
  | "reuniao"
  | "follow_up"
  | "visita"
  | "call"
  | "retorno"
  | "outro"
  | "concluido"
  | "pendente";

export type AgendaSummary = {
  today: number;
  thisWeek: number;
  pendingFollowups: number;
  scheduledMeetings: number;
};

export type AgendaLeadOption = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  next_action_at: string | null;
  status: string;
};

export type AgendaClientOption = {
  id: string;
  name: string;
  email: string;
  city: string | null;
  type: SellerClient["partner_type"];
  searchText: string;
};

export type SellerAppointment = {
  id: string;
  seller_id: string;
  lead_id: string | null;
  partnership_id: string | null;
  title: string;
  type: string;
  status: string;
  priority: string;
  scheduled_at: string;
  reminder_minutes: number | null;
  notes: string | null;
  source: "manual" | "admin" | "lead_follow_up" | "sdr_handoff";
  sdr_id: string | null;
  assigned_closer_id: string | null;
  duration_minutes: number;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  lead_name: string | null;
  lead_email: string | null;
  lead_phone: string | null;
  client_name: string | null;
};

export type SharedMeetingMetadata = {
  clientType: string | null;
  sdrName: string | null;
  observation: string | null;
};

export function getSharedMeetingMetadata(notes?: string | null): SharedMeetingMetadata {
  const lines = String(notes ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const valueAfter = (prefix: string) =>
    lines
      .find((line) => line.toLocaleLowerCase("pt-BR").startsWith(prefix.toLocaleLowerCase("pt-BR")))
      ?.slice(prefix.length)
      .trim() || null;
  const observationIndex = lines.findIndex((line) =>
    line.toLocaleLowerCase("pt-BR").startsWith("observação:"),
  );
  return {
    clientType: valueAfter("Tipo de cliente:"),
    sdrName: valueAfter("SDR responsável:"),
    observation: observationIndex >= 0
      ? [lines[observationIndex].slice("Observação:".length).trim(), ...lines.slice(observationIndex + 1)].filter(Boolean).join("\n") || null
      : null,
  };
}

export function getVisibleAppointmentNotes(item: Pick<SellerAppointment, "source" | "notes">) {
  if (item.source !== "sdr_handoff") return item.notes;
  const metadata = getSharedMeetingMetadata(item.notes);
  return metadata.clientType || metadata.sdrName || metadata.observation ? metadata.observation : item.notes;
}

export function buildShortNameValueMap(names: Array<string | null>) {
  const normalizedNames = [...new Set(names.filter(Boolean).map((name) => normalizePersonName(name!)))];
  const firstNameCounts = new Map<string, number>();
  for (const name of normalizedNames) {
    const key = firstNameOnly(name).toLocaleLowerCase("pt-BR");
    firstNameCounts.set(key, (firstNameCounts.get(key) ?? 0) + 1);
  }
  return new Map(normalizedNames.map((name) => {
    const pieces = name.split(" ");
    const duplicated = (firstNameCounts.get(pieces[0].toLocaleLowerCase("pt-BR")) ?? 0) > 1;
    return [name, duplicated ? pieces.slice(0, 2).join(" ") : pieces[0]];
  }));
}

export function firstNameOnly(value: string) {
  return normalizePersonName(value).split(" ")[0];
}

function normalizePersonName(value: string) {
  return value.trim().replace(/\s+/g, " ") || "Vendedor";
}

export type AppointmentDraft = {
  id?: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  scheduled_at: string;
  reminder_minutes: number | null;
  notes: string | null;
  lead_id: string | null;
  partnership_id: string | null;
};

export const AGENDA_TYPES = [
  { value: "reuniao", label: "Reunião" },
  { value: "follow_up", label: "Follow-up" },
  { value: "visita", label: "Visita" },
  { value: "call", label: "Call" },
  { value: "retorno", label: "Retorno" },
  { value: "outro", label: "Outro" },
] as const;

export const AGENDA_STATUSES = [
  { value: "agendado", label: "Pendente" },
  { value: "concluido", label: "Concluído" },
  { value: "cancelado", label: "Cancelado" },
] as const;

export const AGENDA_REMINDERS = [
  { value: null, label: "Sem lembrete" },
  { value: 10, label: "10 min antes" },
  { value: 30, label: "30 min antes" },
  { value: 60, label: "1 hora antes" },
  { value: 1440, label: "1 dia antes" },
] as const;

export const AGENDA_FILTERS: Array<{ value: AgendaFilter; label: string }> = [
  { value: "todos", label: "Todos" },
  { value: "reuniao", label: "Reunião" },
  { value: "follow_up", label: "Follow-up" },
  { value: "visita", label: "Visita" },
  { value: "call", label: "Call" },
  { value: "retorno", label: "Retorno" },
  { value: "outro", label: "Outro" },
  { value: "concluido", label: "Concluído" },
  { value: "pendente", label: "Pendente" },
];

const CANONICAL_TYPES = new Set(["reuniao", "follow_up", "visita", "call", "ligacao", "retorno"]);

export function agendaTypeKey(type: string) {
  if (type === "ligacao") return "call";
  return AGENDA_TYPES.some((option) => option.value === type) ? type : "outro";
}

export function agendaTypeLabel(type: string) {
  const key = agendaTypeKey(type);
  return AGENDA_TYPES.find((option) => option.value === key)?.label ?? "Outro";
}

export function agendaStatusLabel(status: string) {
  if (["agendado", "confirmado", "remarcado", "em_andamento"].includes(status)) return "Pendente";
  return AGENDA_STATUSES.find((option) => option.value === status)?.label ?? status;
}

export function appointmentMatchesFilter(item: SellerAppointment, filter: AgendaFilter) {
  if (filter === "todos") return true;
  if (filter === "concluido") return item.status === "concluido";
  if (filter === "pendente") return !["concluido", "cancelado"].includes(item.status);
  if (filter === "call") return ["call", "ligacao"].includes(item.type);
  if (filter === "outro") return !CANONICAL_TYPES.has(item.type);
  return item.type === filter;
}

export function sellerAgendaRange(month: Date) {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
  const end = addDays(endOfWeek(endOfMonth(month), { weekStartsOn: 0 }), 1);
  return { start, end };
}

function clientsToOptions(clients: SellerClient[]): AgendaClientOption[] {
  return clients.map((client) => ({
    id: client.partnership_id,
    name: client.partner_name,
    email: client.partner_email,
    city: client.partner_city,
    type: client.partner_type,
    searchText: [client.partner_name, client.partner_email, client.partner_city]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("pt-BR"),
  }));
}

export async function fetchSellerAgenda(
  sellerId: string,
  month: Date,
): Promise<{
  appointments: SellerAppointment[];
  summary: AgendaSummary;
  leads: AgendaLeadOption[];
  clients: AgendaClientOption[];
}> {
  const { start, end } = sellerAgendaRange(month);
  const [appointmentsResult, leadsResult, sellerClients] = await Promise.all([
    supabase
      .from("seller_appointments" as any)
      .select(
        "id, seller_id, sdr_id, assigned_closer_id, lead_id, partnership_id, title, type, status, priority, scheduled_at, reminder_minutes, notes, source, completed_at, duration_minutes, contact_name, contact_email, contact_phone, created_at, updated_at, sales_leads(full_name, email, phone)",
      )
      .or(`seller_id.eq.${sellerId},sdr_id.eq.${sellerId},assigned_closer_id.eq.${sellerId}`)
      .gte("scheduled_at", start.toISOString())
      .lt("scheduled_at", end.toISOString())
      .order("scheduled_at", { ascending: true }),
    supabase
      .from("sales_leads" as any)
      .select("id, full_name, email, phone, next_action_at, status")
      .eq("assigned_seller_id", sellerId)
      .order("full_name", { ascending: true }),
    fetchSellerClients(),
  ]);

  if (appointmentsResult.error) throw appointmentsResult.error;
  if (leadsResult.error) throw leadsResult.error;

  const clients = clientsToOptions(sellerClients);
  const clientsById = new Map(clients.map((client) => [client.id, client]));
  const appointments = ((appointmentsResult.data as any[]) ?? []).map((row): SellerAppointment => ({
    ...row,
    partnership_id: row.partnership_id ?? null,
    source: row.source ?? "manual",
    completed_at: row.completed_at ?? null,
    sdr_id: row.sdr_id ?? null,
    assigned_closer_id: row.assigned_closer_id ?? null,
    duration_minutes: Number(row.duration_minutes ?? SHARED_MEETING_DURATION_MINUTES),
    contact_name: row.contact_name ?? null,
    contact_email: row.contact_email ?? null,
    contact_phone: row.contact_phone ?? null,
    lead_name: row.sales_leads?.full_name ?? null,
    lead_email: row.sales_leads?.email ?? null,
    lead_phone: row.sales_leads?.phone ?? null,
    client_name: row.partnership_id ? clientsById.get(row.partnership_id)?.name ?? null : null,
  }));

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = addDays(todayStart, 1);
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = addDays(weekStart, 7);
  const active = appointments.filter((item) => item.status !== "cancelado");

  return {
    appointments,
    summary: {
      today: active.filter((item) => {
        const date = new Date(item.scheduled_at);
        return date >= todayStart && date < todayEnd;
      }).length,
      thisWeek: active.filter((item) => {
        const date = new Date(item.scheduled_at);
        return date >= weekStart && date < weekEnd;
      }).length,
      pendingFollowups: active.filter(
        (item) => item.type === "follow_up" && !["concluido", "cancelado"].includes(item.status),
      ).length,
      scheduledMeetings: active.filter(
        (item) => item.type === "reuniao" && !["concluido", "cancelado"].includes(item.status),
      ).length,
    },
    leads: ((leadsResult.data as any[]) ?? []) as AgendaLeadOption[],
    clients,
  };
}

export async function saveSellerAppointment(sellerId: string, draft: AppointmentDraft) {
  const payload = {
    seller_id: sellerId,
    lead_id: draft.lead_id || null,
    partnership_id: draft.partnership_id || null,
    title: draft.title.trim(),
    type: draft.type,
    status: draft.status,
    priority: draft.priority,
    scheduled_at: draft.scheduled_at,
    reminder_minutes: draft.reminder_minutes,
    notes: draft.notes?.trim() || null,
  };

  const result = draft.id
    ? await supabase
        .from("seller_appointments" as any)
        .update(payload)
        .eq("id", draft.id)
        .eq("seller_id", sellerId)
    : await supabase.from("seller_appointments" as any).insert(payload);

  if (result.error) throw result.error;
}

export async function setSellerAppointmentStatus(sellerId: string, id: string, status: string) {
  const { error } = await supabase
    .from("seller_appointments" as any)
    .update({ status })
    .eq("id", id)
    .or(`seller_id.eq.${sellerId},sdr_id.eq.${sellerId},assigned_closer_id.eq.${sellerId}`);
  if (error) throw error;
}

export async function deleteSellerAppointment(sellerId: string, id: string) {
  const { error } = await supabase
    .from("seller_appointments" as any)
    .delete()
    .eq("id", id)
    .or(`seller_id.eq.${sellerId},sdr_id.eq.${sellerId},assigned_closer_id.eq.${sellerId}`);
  if (error) throw error;
}

export type CloserAvailabilitySlot = {
  slot_start: string;
  slot_end: string;
  closer_id: string;
  closer_name: string;
  closer_email: string;
};

export type ScheduledSharedMeeting = {
  id: string;
  closer_id: string;
  closer_name: string;
};

export const SHARED_MEETING_DURATION_MINUTES = 60;

export async function fetchCloserAvailability(fromDate: Date, days = 14) {
  const date = formatLocalDate(fromDate);
  const { data, error } = await supabase.rpc("get_available_closer_slots" as any, {
    p_from_date: date,
    p_days: days,
    p_duration_minutes: SHARED_MEETING_DURATION_MINUTES,
  });
  if (error) throw new Error(error.message || "Não foi possível consultar os horários disponíveis.");
  return ((data as any[]) ?? []) as CloserAvailabilitySlot[];
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function scheduleSdrCloserMeeting(input: {
  slotStart: string;
  title: string;
  contactName: string;
  contactEmail?: string;
  contactPhone?: string;
  notes?: string;
}) {
  const { data, error } = await supabase.rpc("schedule_sdr_closer_meeting" as any, {
    p_slot_start: input.slotStart,
    p_title: input.title,
    p_contact_name: input.contactName,
    p_contact_email: input.contactEmail || null,
    p_contact_phone: input.contactPhone || null,
    p_notes: input.notes || null,
    p_duration_minutes: SHARED_MEETING_DURATION_MINUTES,
  });
  if (error) throw new Error(error.message || "Não foi possível agendar a reunião.");
  const meeting = (Array.isArray(data) ? data[0] : data) as ScheduledSharedMeeting | null;
  if (!meeting?.id || !meeting.closer_id) throw new Error("O agendamento não retornou a reunião criada.");
  return meeting;
}

export async function rescheduleSharedMeeting(appointmentId: string, slotStart: string) {
  const { error } = await supabase.rpc("reschedule_shared_sales_meeting" as any, {
    p_appointment_id: appointmentId,
    p_slot_start: slotStart,
  });
  if (error) throw new Error(error.message || "Não foi possível remarcar a reunião.");
}
