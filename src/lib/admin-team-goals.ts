import { supabase } from "@/integrations/supabase/client";

export type TeamGoalProgress = {
  seller_id: string;
  seller_name: string;
  seller_type: "sdr" | "closer";
  target_clients_daily: number | null;
  target_clients_weekly: number | null;
  target_clients_monthly: number | null;
  target_meetings_scheduled_daily: number | null;
  target_meetings_scheduled_weekly: number | null;
  target_meetings_scheduled_monthly: number | null;
  target_meetings_completed_daily: number | null;
  target_meetings_completed_weekly: number | null;
  target_meetings_completed_monthly: number | null;
  clients_registered_daily: number;
  clients_registered_weekly: number;
  clients_registered_monthly: number;
  meetings_scheduled_daily: number;
  meetings_scheduled_weekly: number;
  meetings_scheduled_monthly: number;
  meetings_completed_daily: number;
  meetings_completed_weekly: number;
  meetings_completed_monthly: number;
};

export type TeamGoalConfig = {
  seller_type: "sdr" | "closer";
  month: number;
  year: number;
  target_meetings_daily: number | null;
  target_meetings_weekly: number | null;
  target_meetings_monthly: number | null;
  target_clients_daily: number | null;
  target_clients_weekly: number | null;
  target_clients_monthly: number | null;
};

function numberOrNull(value: unknown) {
  return value == null ? null : Number(value);
}

function normalize(row: Record<string, unknown>): TeamGoalProgress {
  return {
    ...(row as unknown as TeamGoalProgress),
    seller_type: row.seller_type === "closer" ? "closer" : "sdr",
    target_clients_daily: numberOrNull(row.target_clients_daily),
    target_clients_weekly: numberOrNull(row.target_clients_weekly),
    target_clients_monthly: numberOrNull(row.target_clients_monthly),
    target_meetings_scheduled_daily: numberOrNull(row.target_meetings_scheduled_daily),
    target_meetings_scheduled_weekly: numberOrNull(row.target_meetings_scheduled_weekly),
    target_meetings_scheduled_monthly: numberOrNull(row.target_meetings_scheduled_monthly),
    target_meetings_completed_daily: numberOrNull(row.target_meetings_completed_daily),
    target_meetings_completed_weekly: numberOrNull(row.target_meetings_completed_weekly),
    target_meetings_completed_monthly: numberOrNull(row.target_meetings_completed_monthly),
    clients_registered_daily: Number(row.clients_registered_daily ?? 0),
    clients_registered_weekly: Number(row.clients_registered_weekly ?? 0),
    clients_registered_monthly: Number(row.clients_registered_monthly ?? 0),
    meetings_scheduled_daily: Number(row.meetings_scheduled_daily ?? 0),
    meetings_scheduled_weekly: Number(row.meetings_scheduled_weekly ?? 0),
    meetings_scheduled_monthly: Number(row.meetings_scheduled_monthly ?? 0),
    meetings_completed_daily: Number(row.meetings_completed_daily ?? 0),
    meetings_completed_weekly: Number(row.meetings_completed_weekly ?? 0),
    meetings_completed_monthly: Number(row.meetings_completed_monthly ?? 0),
  };
}

export async function fetchTeamGoalProgress(month: number, year: number) {
  const { data, error } = await (supabase.rpc as any)("get_seller_team_goal_progress", {
    p_month: month,
    p_year: year,
  });
  if (error) throw error;
  return ((data as Record<string, unknown>[] | null) ?? []).map(normalize);
}

export async function fetchTeamGoalConfigs(month: number, year: number) {
  const { data, error } = await (supabase.from("seller_team_goals" as any) as any)
    .select(
      "seller_type,month,year,target_meetings_daily,target_meetings_weekly,target_meetings_monthly,target_clients_daily,target_clients_weekly,target_clients_monthly",
    )
    .eq("month", month)
    .eq("year", year);
  if (error) throw error;
  return ((data as Record<string, unknown>[] | null) ?? []).map((row): TeamGoalConfig => ({
    seller_type: row.seller_type === "closer" ? "closer" : "sdr",
    month: Number(row.month),
    year: Number(row.year),
    target_meetings_daily: numberOrNull(row.target_meetings_daily),
    target_meetings_weekly: numberOrNull(row.target_meetings_weekly),
    target_meetings_monthly: numberOrNull(row.target_meetings_monthly),
    target_clients_daily: numberOrNull(row.target_clients_daily),
    target_clients_weekly: numberOrNull(row.target_clients_weekly),
    target_clients_monthly: numberOrNull(row.target_clients_monthly),
  }));
}

export async function fetchMyRoleGoalProgress() {
  const { data, error } = await (supabase.rpc as any)("get_my_seller_goal_progress");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Não foi possível localizar suas metas.");
  return normalize(row as Record<string, unknown>);
}

export async function saveTeamGoals(
  sellerType: "sdr" | "closer",
  month: number,
  year: number,
  targets: {
    meetings: { daily: number; weekly: number; monthly: number };
    registrations: { daily: number; weekly: number; monthly: number };
  },
) {
  const { error } = await (supabase.rpc as any)("upsert_seller_team_goals", {
    p_seller_type: sellerType,
    p_month: month,
    p_year: year,
    p_target_meetings_daily: targets.meetings.daily,
    p_target_meetings_weekly: targets.meetings.weekly,
    p_target_meetings_monthly: targets.meetings.monthly,
    p_target_clients_daily: targets.registrations.daily,
    p_target_clients_weekly: targets.registrations.weekly,
    p_target_clients_monthly: targets.registrations.monthly,
  });
  if (error) throw error;
}
