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
