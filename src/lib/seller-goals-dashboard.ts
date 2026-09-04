import type { SellerMonthlyProgress } from "@/lib/seller-progress";

export type SellerRewardMetric = "meetings" | "clients" | "contracts";

export const SELLER_REWARD_METRICS: Record<
  SellerRewardMetric,
  { label: string; singular: string }
> = {
  meetings: { label: "Reuniões realizadas", singular: "reunião realizada" },
  clients: { label: "Clientes cadastrados", singular: "cliente cadastrado" },
  contracts: { label: "Contratos fechados", singular: "contrato fechado" },
};

export function sellerGoalPercentage(current: number, target: number | null): number {
  if (target == null) return 0;
  if (target <= 0) return 100;
  return Math.min(100, Math.max(0, Math.round((current / target) * 100)));
}

export function sellerOverallProgress(progress: SellerMonthlyProgress): number {
  return sellerGoalPercentage(progress.clients_registered, progress.target_clients);
}

export function sellerRewardCurrent(
  progress: SellerMonthlyProgress,
  metric: SellerRewardMetric,
): number {
  if (metric === "meetings") return progress.meetings_completed;
  if (metric === "clients") return progress.clients_registered;
  return progress.contracts_closed;
}

export function sellerRewardCriterion(metric: SellerRewardMetric, target: number): string {
  const copy = SELLER_REWARD_METRICS[metric];
  if (target === 1) return `1 ${copy.singular}`;
  return `${target} ${copy.label.toLocaleLowerCase("pt-BR")}`;
}
