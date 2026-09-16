import { supabase } from "@/integrations/supabase/client";

export type SellerMonthlyProgress = {
  seller_id: string;
  target_meetings: number | null;
  target_clients: number | null;
  target_contracts: number | null;
  meetings_completed: number;
  clients_registered: number;
  contracts_closed: number;
};

export type SellerTeamMonthlyProgress = SellerMonthlyProgress & {
  seller_name: string;
};

export type SellerGoalProgress = {
  seller_id: string;
  seller_type: "sdr" | "closer";
  month: number;
  year: number;
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

const GOAL_TARGET_FIELDS = [
  "target_clients_daily",
  "target_clients_weekly",
  "target_clients_monthly",
  "target_meetings_scheduled_daily",
  "target_meetings_scheduled_weekly",
  "target_meetings_scheduled_monthly",
  "target_meetings_completed_daily",
  "target_meetings_completed_weekly",
  "target_meetings_completed_monthly",
] as const;

const GOAL_CURRENT_FIELDS = [
  "clients_registered_daily",
  "clients_registered_weekly",
  "clients_registered_monthly",
  "meetings_scheduled_daily",
  "meetings_scheduled_weekly",
  "meetings_scheduled_monthly",
  "meetings_completed_daily",
  "meetings_completed_weekly",
  "meetings_completed_monthly",
] as const;

function normalizeProgress<T extends SellerMonthlyProgress>(row: T): T {
  return {
    ...row,
    target_meetings: row.target_meetings == null ? null : Number(row.target_meetings),
    target_clients: row.target_clients == null ? null : Number(row.target_clients),
    target_contracts: row.target_contracts == null ? null : Number(row.target_contracts),
    meetings_completed: Number(row.meetings_completed ?? 0),
    clients_registered: Number(row.clients_registered ?? 0),
    contracts_closed: Number(row.contracts_closed ?? 0),
  };
}

export async function fetchMySellerMonthlyProgress(month: number, year: number) {
  const { data, error } = await supabase.rpc(
    "get_my_seller_monthly_progress" as never,
    { p_month: month, p_year: year } as never,
  );
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Não foi possível localizar o progresso deste vendedor.");
  return normalizeProgress(row as SellerMonthlyProgress);
}

export async function fetchSellerTeamMonthlyProgress(month: number, year: number) {
  const { data, error } = await supabase.rpc(
    "get_seller_team_monthly_progress" as never,
    { p_month: month, p_year: year } as never,
  );
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map((row) =>
    normalizeProgress(row as SellerTeamMonthlyProgress),
  );
}

export async function fetchMySellerGoalProgress(): Promise<SellerGoalProgress> {
  const { data, error } = await supabase.rpc("get_my_seller_goal_progress" as never);
  if (error) throw error;
  const raw = (Array.isArray(data) ? data[0] : data) as SellerGoalProgress | undefined;
  if (!raw) throw new Error("Não foi possível localizar as metas deste vendedor.");

  const normalized = { ...raw } as SellerGoalProgress;
  normalized.month = Number(raw.month);
  normalized.year = Number(raw.year);
  normalized.seller_type = raw.seller_type === "closer" ? "closer" : "sdr";
  for (const field of GOAL_TARGET_FIELDS) {
    normalized[field] = raw[field] == null ? null : Number(raw[field]);
  }
  for (const field of GOAL_CURRENT_FIELDS) {
    normalized[field] = Number(raw[field] ?? 0);
  }
  return normalized;
}
