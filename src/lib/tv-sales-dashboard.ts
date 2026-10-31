import { supabase } from "@/integrations/supabase/client";
import { fetchTeamGoalProgress, type TeamGoalProgress } from "@/lib/admin-team-goals";
import { collaboratorDisplayName } from "@/lib/collaborator-name";

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

export type TvDailyCompetitionSeller = TvRankingSeller & {
  dailyPosition: number;
  dailyScore: number | null;
  primaryCurrent: number;
  primaryTarget: number | null;
  secondaryCurrent: number;
  secondaryTarget: number | null;
  contactedCurrent: number;
  contactedTarget: number | null;
};

export type TvDailyTeamSummary = {
  primaryCurrent: number;
  primaryTarget: number | null;
  secondaryCurrent: number;
  secondaryTarget: number | null;
  contactedCurrent: number;
  contactedTarget: number | null;
  score: number | null;
};

export type TvRegistrationCelebration = {
  attributionId: string;
  sellerId: string;
  sellerName: string;
  sellerType: TvSellerType;
  avatarUrl: string | null;
  createdAt: string;
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
      name: collaboratorDisplayName(String(row.nome || ""), "Vendedor"),
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

function dailyMetricsForSeller(
  seller: TvRankingSeller,
  goals: TeamGoalProgress[],
): Omit<TvDailyCompetitionSeller, keyof TvRankingSeller | "dailyPosition"> {
  const goal = goalForSeller(seller, goals);
  const isCloser = seller.sellerType === "closer";
  const primaryCurrent = isCloser
    ? (goal?.meetings_completed_daily ?? 0)
    : (goal?.clients_registered_daily ?? 0);
  const primaryTarget = isCloser
    ? (goal?.target_meetings_completed_daily ?? null)
    : (goal?.target_clients_daily ?? null);
  const secondaryCurrent = isCloser
    ? (goal?.clients_registered_daily ?? 0)
    : (goal?.meetings_scheduled_daily ?? 0);
  const secondaryTarget = isCloser
    ? (goal?.target_clients_daily ?? null)
    : (goal?.target_meetings_scheduled_daily ?? null);
  const contactedCurrent = goal?.leads_contacted_daily ?? 0;
  const contactedTarget = goal?.target_leads_contacted_daily ?? null;
  const percentages = [
    sellerGoalPercentage(primaryCurrent, primaryTarget),
    sellerGoalPercentage(secondaryCurrent, secondaryTarget),
    isCloser ? null : sellerGoalPercentage(contactedCurrent, contactedTarget),
  ].filter((percentage): percentage is number => percentage != null);

  return {
    dailyScore: percentages.length
      ? Math.round(
          percentages.reduce((sum, percentage) => sum + percentage, 0) / percentages.length,
        )
      : null,
    primaryCurrent,
    primaryTarget,
    secondaryCurrent,
    secondaryTarget,
    contactedCurrent,
    contactedTarget,
  };
}

export function rankDailyCompetition(
  sellers: TvRankingSeller[],
  goals: TeamGoalProgress[],
): TvDailyCompetitionSeller[] {
  return sellers
    .map((seller) => ({ ...seller, ...dailyMetricsForSeller(seller, goals) }))
    .sort((left, right) => {
      const scoreDifference = (right.dailyScore ?? -1) - (left.dailyScore ?? -1);
      if (scoreDifference) return scoreDifference;
      const primaryDifference = right.primaryCurrent - left.primaryCurrent;
      if (primaryDifference) return primaryDifference;
      const secondaryDifference = right.secondaryCurrent - left.secondaryCurrent;
      if (secondaryDifference) return secondaryDifference;
      const monthlyDifference =
        left.sellerType === "closer"
          ? right.contracts - left.contracts
          : right.registrations - left.registrations;
      return (
        monthlyDifference || left.position - right.position || left.name.localeCompare(right.name)
      );
    })
    .map((seller, index) => ({ ...seller, dailyPosition: index + 1 }));
}

export function summarizeDailyTeam(
  sellers: TvRankingSeller[],
  goals: TeamGoalProgress[],
): TvDailyTeamSummary {
  const dailyRows = sellers.map((seller) => dailyMetricsForSeller(seller, goals));
  const primaryCurrent = dailyRows.reduce((sum, row) => sum + row.primaryCurrent, 0);
  const secondaryCurrent = dailyRows.reduce((sum, row) => sum + row.secondaryCurrent, 0);
  const primaryTargets = dailyRows
    .map((row) => row.primaryTarget)
    .filter((target): target is number => target != null && target > 0);
  const secondaryTargets = dailyRows
    .map((row) => row.secondaryTarget)
    .filter((target): target is number => target != null && target > 0);
  const contactedCurrent = dailyRows.reduce((sum, row) => sum + row.contactedCurrent, 0);
  const contactedTargets = dailyRows
    .map((row) => row.contactedTarget)
    .filter((target): target is number => target != null && target > 0);
  const primaryTarget = primaryTargets.length
    ? primaryTargets.reduce((sum, target) => sum + target, 0)
    : null;
  const secondaryTarget = secondaryTargets.length
    ? secondaryTargets.reduce((sum, target) => sum + target, 0)
    : null;
  const contactedTarget = contactedTargets.length
    ? contactedTargets.reduce((sum, target) => sum + target, 0)
    : null;
  const tracksLeadContact = sellers.some((seller) => seller.sellerType === "sdr");
  const percentages = [
    sellerGoalPercentage(primaryCurrent, primaryTarget),
    sellerGoalPercentage(secondaryCurrent, secondaryTarget),
    tracksLeadContact ? sellerGoalPercentage(contactedCurrent, contactedTarget) : null,
  ].filter((percentage): percentage is number => percentage != null);

  return {
    primaryCurrent,
    primaryTarget,
    secondaryCurrent,
    secondaryTarget,
    contactedCurrent,
    contactedTarget,
    score: percentages.length
      ? Math.round(
          percentages.reduce((sum, percentage) => sum + percentage, 0) / percentages.length,
        )
      : null,
  };
}

export function normalizeTvRegistrationCelebration(
  row: Record<string, unknown>,
): TvRegistrationCelebration | null {
  const attributionId = String(row.attribution_id ?? "");
  const sellerId = String(row.seller_id ?? "");
  if (!attributionId || !sellerId) return null;

  return {
    attributionId,
    sellerId,
    sellerName: collaboratorDisplayName(String(row.seller_name ?? ""), "Time NOX"),
    sellerType: row.seller_type === "closer" ? "closer" : "sdr",
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

export async function fetchTvRegistrationCelebration(
  attributionId: string,
): Promise<TvRegistrationCelebration | null> {
  const { data, error } = await (supabase.rpc as any)("get_tv_registration_celebration", {
    p_attribution_id: attributionId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? normalizeTvRegistrationCelebration(row as Record<string, unknown>) : null;
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
