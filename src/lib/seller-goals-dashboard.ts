import type { SellerGoalMetric, SellerGoalPeriod, SellerGoalProgress, SellerMonthlyProgress } from "@/lib/seller-progress";

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
  const percentages = [
    sellerGoalPercentage(progress.meetings_completed, progress.target_meetings),
    sellerGoalPercentage(progress.clients_registered, progress.target_clients),
    sellerGoalPercentage(progress.contracts_closed, progress.target_contracts),
  ];
  return Math.round(percentages.reduce((sum, value) => sum + value, 0) / percentages.length);
}

// ===== Metas diárias / semanais / mensais (aba "Minhas metas") =====

export const SELLER_GOAL_PERIODS: Array<{ value: SellerGoalPeriod; label: string }> = [
  { value: "daily", label: "Diária" },
  { value: "weekly", label: "Semanal" },
  { value: "monthly", label: "Mensal" },
];

export const SELLER_GOAL_METRICS: Record<
  SellerGoalMetric,
  { label: string; singular: string; description: string; appliesTo: Array<"sdr" | "closer"> }
> = {
  clients: {
    label: "Cadastros",
    singular: "cadastro",
    description: "Novos corretores e imobiliárias cadastrados na carteira.",
    appliesTo: ["sdr", "closer"],
  },
  meetings_scheduled: {
    label: "Reuniões agendadas",
    singular: "reunião agendada",
    description: "Reuniões distribuídas para um Closer pela agenda compartilhada.",
    appliesTo: ["sdr"],
  },
  meetings_completed: {
    label: "Reuniões realizadas",
    singular: "reunião realizada",
    description: "Reuniões conduzidas e marcadas como concluídas.",
    appliesTo: ["closer"],
  },
};

const GOAL_METRIC_TARGET_PREFIX: Record<SellerGoalMetric, string> = {
  clients: "target_clients",
  meetings_scheduled: "target_meetings_scheduled",
  meetings_completed: "target_meetings_completed",
};

const GOAL_METRIC_COUNT_PREFIX: Record<SellerGoalMetric, string> = {
  clients: "clients_registered",
  meetings_scheduled: "meetings_scheduled",
  meetings_completed: "meetings_completed",
};

export function sellerGoalMetricsForType(sellerType: "sdr" | "closer"): SellerGoalMetric[] {
  return (Object.keys(SELLER_GOAL_METRICS) as SellerGoalMetric[]).filter((metric) =>
    SELLER_GOAL_METRICS[metric].appliesTo.includes(sellerType),
  );
}

export function sellerGoalTargetField(metric: SellerGoalMetric, period: SellerGoalPeriod): string {
  return `${GOAL_METRIC_TARGET_PREFIX[metric]}_${period}`;
}

export function sellerGoalCountField(metric: SellerGoalMetric, period: SellerGoalPeriod): string {
  return `${GOAL_METRIC_COUNT_PREFIX[metric]}_${period}`;
}

export function sellerGoalProgressValue(
  progress: SellerGoalProgress,
  metric: SellerGoalMetric,
  period: SellerGoalPeriod,
): { current: number; target: number | null; percentage: number } {
  const bag = progress as unknown as Record<string, number | null>;
  const target = bag[sellerGoalTargetField(metric, period)] ?? null;
  const current = Number(bag[sellerGoalCountField(metric, period)] ?? 0);
  return { current, target, percentage: sellerGoalPercentage(current, target) };
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
