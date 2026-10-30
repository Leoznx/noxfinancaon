import { supabase } from "@/integrations/supabase/client";
import { fetchTeamGoalProgress, type TeamGoalProgress } from "@/lib/admin-team-goals";

export type TvSellerType = "sdr" | "closer";

export type TvRankingSeller = {
  id: string;
  name: string;
  avatarUrl: string | null;
  sellerType: TvSellerType;
  registrations: number;
  contracts: number;
  openLeads: number;
  position: number;
};

export type TvSalesDashboardSnapshot = {
  generatedAt: string;
  month: number;
  year: number;
  ranking: TvRankingSeller[];
  goals: TeamGoalProgress[];
};

const REQUEST_TIMEOUT_MS = 15_000;

function finiteNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeTvRanking(rows: Record<string, unknown>[]): TvRankingSeller[] {
  return rows
    .map((row): TvRankingSeller => ({
      id: String(row.vendedor_id ?? ""),
      name: String(row.nome || "Vendedor"),
      avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
      sellerType: row.seller_type === "closer" ? "closer" : "sdr",
      registrations: finiteNumber(row.total_leads),
      contracts: finiteNumber(row.contratos_fechados),
      openLeads: finiteNumber(row.em_atendimento),
      position: finiteNumber(row.posicao),
    }))
    .filter((seller) => seller.id)
    .sort((left, right) => {
      if (left.sellerType !== right.sellerType)
        return left.sellerType.localeCompare(right.sellerType);
      return left.position - right.position || right.registrations - left.registrations;
    });
}

export function sellerGoalPercentage(current: number, target: number | null): number | null {
  if (!target || target <= 0) return null;
  return Math.max(0, Math.round((current / target) * 100));
}

export function goalForSeller(
  seller: TvRankingSeller,
  goals: TeamGoalProgress[],
): TeamGoalProgress | null {
  return goals.find((goal) => goal.seller_id === seller.id) ?? null;
}

async function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function fetchTvSalesDashboard(
  month: number,
  year: number,
): Promise<TvSalesDashboardSnapshot> {
  const rankingPromise = (supabase as any)
    .rpc("ranking_vendedores", { p_month: month, p_year: year })
    .then((response: { data: Record<string, unknown>[] | null; error: Error | null }) => {
      if (response.error) throw response.error;
      return normalizeTvRanking(response.data ?? []);
    });

  const [ranking, goals] = await withTimeout(
    Promise.all([rankingPromise, fetchTeamGoalProgress(month, year)]),
    "A sincronização demorou mais que o esperado.",
  );

  return {
    generatedAt: new Date().toISOString(),
    month,
    year,
    ranking,
    goals,
  };
}
