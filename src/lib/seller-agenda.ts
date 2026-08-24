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
  source: "manual" | "admin" | "lead_follow_up";
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  lead_name: string | null;
  lead_email: string | null;
  lead_phone: string | null;
  client_name: string | null;
};

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

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSummary(value: unknown): AgendaSummary {
  const row = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    today: numberValue(row.today),
    thisWeek: numberValue(row.this_week),
    pendingFollowups: numberValue(row.pending_followups),
    scheduledMeetings: numberValue(row.scheduled_meetings),
  };
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
  const [appointmentsResult, summaryResult, leadsResult, sellerClients] = await Promise.all([
    supabase
      .from("seller_appointments" as any)
      .select(
        "id, seller_id, lead_id, partnership_id, title, type, status, priority, scheduled_at, reminder_minutes, notes, source, completed_at, created_at, updated_at, sales_leads(full_name, email, phone)",
      )
      .eq("seller_id", sellerId)
      .gte("scheduled_at", start.toISOString())
      .lt("scheduled_at", end.toISOString())
      .order("scheduled_at", { ascending: true }),
    supabase.rpc("get_my_seller_agenda_summary" as never),
    supabase
      .from("sales_leads" as any)
      .select("id, full_name, email, phone, next_action_at, status")
      .eq("assigned_seller_id", sellerId)
      .order("full_name", { ascending: true }),
    fetchSellerClients(),
  ]);

  if (appointmentsResult.error) throw appointmentsResult.error;
  if (summaryResult.error) throw summaryResult.error;
  if (leadsResult.error) throw leadsResult.error;

  const clients = clientsToOptions(sellerClients);
  const clientsById = new Map(clients.map((client) => [client.id, client]));
  const appointments = ((appointmentsResult.data as any[]) ?? []).map((row): SellerAppointment => ({
    ...row,
    partnership_id: row.partnership_id ?? null,
    source: row.source ?? "manual",
    completed_at: row.completed_at ?? null,
    lead_name: row.sales_leads?.full_name ?? null,
    lead_email: row.sales_leads?.email ?? null,
    lead_phone: row.sales_leads?.phone ?? null,
    client_name: row.partnership_id ? clientsById.get(row.partnership_id)?.name ?? null : null,
  }));

  return {
    appointments,
    summary: normalizeSummary(summaryResult.data),
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
    .eq("seller_id", sellerId);
  if (error) throw error;
}

export async function deleteSellerAppointment(sellerId: string, id: string) {
  const { error } = await supabase
    .from("seller_appointments" as any)
    .delete()
    .eq("id", id)
    .eq("seller_id", sellerId);
  if (error) throw error;
}
