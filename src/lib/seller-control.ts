import { supabase } from "@/integrations/supabase/client";

export type SellerControlPeriod = "daily" | "weekly" | "monthly";
export type SellerType = "sdr" | "closer";
export type SellerLeadOutcome = "em_contato" | "sem_retorno";
export type SellerLeadCategory = "cold" | "meeting_scheduled" | "potential";
export type SellerLeadNextStep =
  | "continue_follow_up"
  | SellerLeadCategory
  | "converted"
  | "not_interested";

export const SELLER_LEAD_CATEGORIES: readonly {
  value: SellerLeadCategory;
  label: string;
  shortLabel: string;
  description: string;
}[] = [
  { value: "cold", label: "Lead frio", shortLabel: "Frio", description: "2 follow-ups em 30 dias; sem retorno, segue para outro vendedor." },
  { value: "meeting_scheduled", label: "Lead marcou reunião", shortLabel: "Reunião marcada", description: "Follow-up exclusivo com você a cada 15 dias, sem rotação." },
  { value: "potential", label: "Lead em potencial", shortLabel: "Em potencial", description: "4 follow-ups em 30 dias; depois gira se continuar sem retorno." },
] as const;

export const SELLER_LEAD_NEXT_STEPS: readonly {
  value: SellerLeadNextStep;
  label: string;
  description: string;
}[] = [
  { value: "continue_follow_up", label: "Continuar acompanhamento", description: "Mantém a jornada atual e agenda o próximo contato." },
  { value: "meeting_scheduled", label: "Marcou reunião", description: "Fixa o lead com você e acompanha a cada 15 dias." },
  { value: "potential", label: "Virou lead em potencial", description: "Inicia 4 follow-ups em até 30 dias." },
  { value: "cold", label: "Voltou a lead frio", description: "Inicia 2 follow-ups em até 30 dias." },
  { value: "converted", label: "Converteu em cliente", description: "Encerra os lembretes porque o lead avançou." },
  { value: "not_interested", label: "Sem interesse / encerrar", description: "Arquiva o acompanhamento deste lead." },
] as const;

export type SellerControlMetrics = {
  meetings_rescheduled: number;
  links_generated: number;
  registrations: number;
  leads_contacted: number;
  active_leads: number;
  missed_leads: number;
  target_calls_daily: number | null;
  target_leads_contacted_daily: number | null;
};

export type SellerControlDashboard = SellerControlMetrics & {
  seller_id: string;
  seller_name: string;
  seller_type: SellerType;
  period: SellerControlPeriod;
  period_start: string | null;
  period_end: string | null;
};

export type SellerContactLeadHistory = {
  id: string;
  occurred_at: string;
  event: string;
  label: string;
  seller_name: string | null;
  details: string | null;
};

export type SellerContactLead = {
  id: string;
  name: string;
  phone: string;
  status: string;
  created_at: string | null;
  assigned_at: string | null;
  cycle_ends_at: string | null;
  next_follow_up_at: string | null;
  current_seller_id: string | null;
  current_seller_name: string | null;
  attempts_in_cycle: number;
  cycle_number: number;
  category: SellerLeadCategory;
  category_label: string;
  follow_up_limit: number;
  rotation_locked: boolean;
  summary: Record<string, unknown>;
  history: SellerContactLeadHistory[];
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function firstRecord(value: unknown): UnknownRecord {
  if (Array.isArray(value)) return isRecord(value[0]) ? value[0] : {};
  if (!isRecord(value)) return {};
  for (const key of ["dashboard", "result", "data", "summary"]) {
    const nested = value[key];
    if (isRecord(nested)) return { ...value, ...nested };
  }
  return value;
}

function records(value: unknown): UnknownRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ["rows", "sellers", "results", "data", "items", "leads"]) {
    if (Array.isArray(value[key])) return (value[key] as unknown[]).filter(isRecord);
  }
  return [value];
}

function pick(row: UnknownRecord, keys: string[]) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
  }
  return undefined;
}

function stringValue(value: unknown, fallback = "") {
  return value == null ? fallback : String(value);
}

function nullableString(value: unknown) {
  const normalized = stringValue(value).trim();
  return normalized || null;
}

function numberValue(value: unknown, fallback = 0) {
  const normalized = typeof value === "string" ? value.replace(",", ".") : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanValue(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function leadCategory(value: unknown): SellerLeadCategory {
  return value === "meeting_scheduled" || value === "potential" ? value : "cold";
}

function nullableNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = numberValue(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function localDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sellerType(value: unknown): SellerType {
  return value === "closer" ? "closer" : "sdr";
}

function normalizeMetrics(row: UnknownRecord): SellerControlMetrics {
  const metrics = isRecord(row.metrics) ? row.metrics : {};
  const goals = isRecord(row.goals) ? row.goals : {};
  const source = { ...row, ...metrics, ...goals };
  return {
    meetings_rescheduled: numberValue(
      pick(source, [
        "meeting_reschedules",
        "meetings_rescheduled",
        "reschedules",
        "rescheduled_meetings",
        "reagendamentos",
      ]),
    ),
    links_generated: numberValue(
      pick(source, ["links_sent", "links_generated", "signup_links", "generated_links", "links_gerados"]),
    ),
    registrations: numberValue(
      pick(source, ["registrations", "clients_registered", "signups", "cadastros"]),
    ),
    leads_contacted: numberValue(
      pick(source, ["leads_contacted", "contacted_leads", "leads_em_contato"]),
    ),
    active_leads: numberValue(pick(source, ["active_leads", "leads_active", "leads_ativos"])),
    missed_leads: numberValue(pick(source, ["missed_leads", "leads_missed", "leads_perdidos"])),
    target_calls_daily: nullableNumber(
      pick(source, ["calls_daily", "target_calls_daily", "calls_daily_target", "daily_calls_target", "meta_ligacoes_diaria"]),
    ),
    target_leads_contacted_daily: nullableNumber(
      pick(source, [
        "leads_contacted_daily",
        "target_leads_contacted_daily",
        "leads_contacted_daily_target",
        "daily_contacted_leads_target",
        "meta_leads_contato_diaria",
      ]),
    ),
  };
}

function normalizeDashboard(
  value: unknown,
  period: SellerControlPeriod,
): SellerControlDashboard {
  const row = firstRecord(value);
  const seller = isRecord(row.seller) ? row.seller : {};
  const periodData = isRecord(row.period)
    ? row.period
    : isRecord(row.period_range)
      ? row.period_range
      : {};
  return {
    seller_id: stringValue(pick({ ...row, ...seller }, ["seller_id", "id", "vendedor_id"])),
    seller_name: stringValue(
      pick({ ...row, ...seller }, ["seller_name", "name", "nome", "vendedor_nome"]),
      "Vendedor",
    ),
    seller_type: sellerType(pick({ ...row, ...seller }, ["seller_type", "type", "tipo"])),
    period,
    period_start: nullableString(
      pick({ ...row, ...periodData }, ["period_start", "start", "starts_at", "inicio"]),
    ),
    period_end: nullableString(
      pick({ ...row, ...periodData }, ["period_end", "end", "ends_at", "fim"]),
    ),
    ...normalizeMetrics(row),
  };
}

function normalizeHistory(value: unknown): SellerContactLeadHistory[] {
  return records(value).map((row, index) => ({
    id: stringValue(pick(row, ["id", "history_id", "event_id"]), `history-${index}`),
    occurred_at: stringValue(
      pick(row, ["occurred_at", "created_at", "event_at", "timestamp", "data"]),
      new Date(0).toISOString(),
    ),
    event: stringValue(pick(row, ["event", "event_type", "type", "outcome", "status"]), "activity"),
    label: stringValue(
      pick(row, ["label", "title", "description", "event_label", "outcome_label"]),
      "Atualização do lead",
    ),
    seller_name: nullableString(pick(row, ["seller_name", "vendedor_nome", "actor_name"])),
    details: nullableString(pick(row, ["details", "notes", "description", "observations"])),
  }));
}

export function normalizeSellerContactLead(value: unknown): SellerContactLead {
  const row = firstRecord(value);
  const lead = isRecord(row.lead) ? row.lead : {};
  const source = { ...row, ...lead };
  const category = leadCategory(pick(source, ["lead_category", "category"]));
  return {
    id: stringValue(pick(source, ["id", "lead_id", "contact_lead_id"])),
    name: stringValue(pick(source, ["name", "lead_name", "contact_name", "nome"]), "Lead"),
    phone: stringValue(pick(source, ["phone", "lead_phone", "contact_phone", "telefone"])),
    status: stringValue(pick(source, ["status", "lead_status"]), "active"),
    created_at: nullableString(pick(source, ["created_at", "registered_at", "cadastrado_em"])),
    assigned_at: nullableString(
      pick(source, ["cycle_started_at", "assigned_at", "current_assignment_at"]),
    ),
    cycle_ends_at: nullableString(
      pick(source, ["rotation_due_at", "cycle_ends_at", "assignment_ends_at", "expires_at"]),
    ),
    next_follow_up_at: nullableString(pick(source, ["next_task_at", "next_follow_up_at"])),
    current_seller_id: nullableString(pick(source, ["current_seller_id", "seller_id", "vendedor_id"])),
    current_seller_name: nullableString(
      pick(source, ["current_seller_name", "seller_name", "vendedor_nome"]),
    ),
    attempts_in_cycle: numberValue(
      pick(source, ["no_response_count", "attempts_in_cycle", "attempt_count", "tentativas"]),
    ),
    cycle_number: numberValue(pick(source, ["cycle_number", "cycle"]), 1),
    category,
    category_label: stringValue(
      pick(source, ["category_label", "lead_category_label"]),
      SELLER_LEAD_CATEGORIES.find((item) => item.value === category)?.label ?? "Lead frio",
    ),
    follow_up_limit: numberValue(
      pick(source, ["follow_up_limit", "attempt_limit"]),
      category === "potential" ? 4 : category === "meeting_scheduled" ? 1 : 2,
    ),
    rotation_locked: booleanValue(pick(source, ["rotation_locked", "fixed_owner"])),
    summary: isRecord(source.summary) ? source.summary : {},
    history: normalizeHistory(pick(source, ["history", "lead_history", "contact_history", "historico"])),
  };
}

export async function fetchMySellerControlDashboard(
  period: SellerControlPeriod,
  anchor = new Date(),
) {
  const { data, error } = await (supabase.rpc as any)("get_my_seller_control_dashboard", {
    p_period: period,
    p_anchor: localDate(anchor),
  });
  if (error) throw error;
  return normalizeDashboard(data, period);
}

export async function fetchAdminSellerControlReport(
  period: SellerControlPeriod,
  anchor = new Date(),
) {
  const { data, error } = await (supabase.rpc as any)("get_admin_seller_control_report", {
    p_period: period,
    p_anchor: localDate(anchor),
  });
  if (error) throw error;
  const envelope = isRecord(data) ? data : {};
  const periodRange = isRecord(envelope.period) ? envelope.period : {};
  const rows = Array.isArray(envelope.sellers) ? envelope.sellers.filter(isRecord) : records(data);
  return rows.map((row) =>
    normalizeDashboard({ ...row, period_range: periodRange }, period),
  );
}

export async function saveSellerControlGoals(
  sellerTypeValue: SellerType,
  month: number,
  year: number,
  targetCallsDaily: number,
  targetLeadsContactedDaily: number,
) {
  const { error } = await (supabase.rpc as any)("upsert_seller_control_goals", {
    p_seller_type: sellerTypeValue,
    p_month: month,
    p_year: year,
    p_target_calls_daily: targetCallsDaily,
    p_target_leads_contacted_daily: targetLeadsContactedDaily,
  });
  if (error) throw error;
}

export async function createMySellerContactLead(
  name: string,
  phone: string,
  category: SellerLeadCategory,
  notes = "",
) {
  const { data, error } = await (supabase.rpc as any)("create_my_qualified_seller_contact_lead", {
    p_name: name.trim(),
    p_phone: phone,
    p_category: category,
    p_notes: notes.trim() || null,
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  if (typeof result === "string") return result;
  const normalized = normalizeSellerContactLead(result);
  if (!normalized.id) throw new Error("O lead foi salvo, mas o identificador não foi retornado.");
  return normalized.id;
}

export async function fetchMySellerContactLeads(search = "") {
  const { data, error } = await (supabase.rpc as any)("get_my_qualified_seller_contact_leads", {
    p_search: search.trim() || null,
  });
  if (error) throw error;
  return records(data).map(normalizeSellerContactLead).filter((lead) => lead.id);
}

export async function respondToMySellerContactLeadTask(
  appointmentId: string,
  outcome: SellerLeadOutcome,
  nextStep: SellerLeadNextStep,
  notes = "",
) {
  const { data, error } = await (supabase.rpc as any)("respond_to_my_qualified_seller_contact_lead_task", {
    p_appointment_id: appointmentId,
    p_outcome: outcome,
    p_next_step: nextStep,
    p_notes: notes.trim() || null,
  });
  if (error) throw error;
  return data;
}

export function sellerControlBusinessDays(
  data: Pick<SellerControlDashboard, "period_start" | "period_end">,
) {
  if (!data.period_start || !data.period_end) return 1;
  const cursor = new Date(`${data.period_start.slice(0, 10)}T12:00:00`);
  const end = new Date(`${data.period_end.slice(0, 10)}T12:00:00`);
  let total = 0;
  while (cursor <= end) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) total += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return total;
}

export function sellerLeadTargetForPeriod(
  data: Pick<
    SellerControlDashboard,
    "target_leads_contacted_daily" | "period_start" | "period_end"
  >,
) {
  if (data.target_leads_contacted_daily == null) return null;
  return data.target_leads_contacted_daily * sellerControlBusinessDays(data);
}
