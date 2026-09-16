import { supabase } from "@/integrations/supabase/client";

export type TeamGoalProgress = {
  seller_id: string;
  seller_name: string;
  seller_type: "sdr" | "closer";
  target_clients_monthly: number | null;
  target_meetings_scheduled_daily: number | null;
  target_meetings_scheduled_weekly: number | null;
  target_meetings_scheduled_monthly: number | null;
  target_meetings_completed_daily: number | null;
  target_meetings_completed_weekly: number | null;
  target_meetings_completed_monthly: number | null;
  meetings_scheduled_daily: number;
  meetings_scheduled_weekly: number;
  meetings_scheduled_monthly: number;
  meetings_completed_daily: number;
  meetings_completed_weekly: number;
  meetings_completed_monthly: number;
};

function numberOrNull(value: unknown) {
  return value == null ? null : Number(value);
}

function normalize(row: Record<string, unknown>): TeamGoalProgress {
  return {
    ...(row as unknown as TeamGoalProgress),
    seller_type: row.seller_type === "closer" ? "closer" : "sdr",
    target_clients_monthly: numberOrNull(row.target_clients_monthly),
    target_meetings_scheduled_daily: numberOrNull(row.target_meetings_scheduled_daily),
    target_meetings_scheduled_weekly: numberOrNull(row.target_meetings_scheduled_weekly),
    target_meetings_scheduled_monthly: numberOrNull(row.target_meetings_scheduled_monthly),
    target_meetings_completed_daily: numberOrNull(row.target_meetings_completed_daily),
    target_meetings_completed_weekly: numberOrNull(row.target_meetings_completed_weekly),
    target_meetings_completed_monthly: numberOrNull(row.target_meetings_completed_monthly),
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

export async function fetchMyRoleGoalProgress() {
  const { data, error } = await (supabase.rpc as any)("get_my_seller_goal_progress");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Não foi possível localizar suas metas.");
  return normalize(row as Record<string, unknown>);
}

export async function saveTeamMeetingGoals(
  row: TeamGoalProgress,
  month: number,
  year: number,
  targets: { daily: number; weekly: number; monthly: number },
) {
  const prefix =
    row.seller_type === "closer" ? "target_meetings_completed" : "target_meetings_scheduled";
  const payload: Record<string, unknown> = {
    seller_id: row.seller_id,
    month,
    year,
    target_meetings: 0,
    target_clients: row.target_clients_monthly ?? 0,
    target_contracts: 0,
    [`${prefix}_daily`]: targets.daily,
    [`${prefix}_weekly`]: targets.weekly,
    [`${prefix}_monthly`]: targets.monthly,
  };
  const { error } = await (supabase.from("seller_goals" as any) as any).upsert(payload, {
    onConflict: "seller_id,month,year",
  });
  if (error) throw error;
}
