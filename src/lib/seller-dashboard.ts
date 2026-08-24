import { supabase } from "@/integrations/supabase/client";

export type SellerDashboardMonth = {
  month: number;
  year: number;
  label: string;
  contracts: number;
  accumulated: number;
  commissions: number;
};

export type SellerDashboardActivity = {
  id: string;
  type: "contract" | "lead" | "appointment" | "proposal";
  title: string;
  subtitle: string;
  occurredAt: string;
};

export type SellerDashboardAppointment = {
  id: string;
  title: string;
  type: string;
  status: string;
  scheduledAt: string;
  leadName: string | null;
};

export type SellerDashboardRanking = {
  sellerId: string;
  name: string;
  avatarUrl: string | null;
  contracts: number;
  commissions: number;
  position: number;
  isCurrent: boolean;
};

export type SellerDashboardData = {
  generatedAt: string;
  seller: { id: string; name: string; avatarUrl: string | null };
  metrics: {
    leadsPending: number;
    leadsNewThisWeek: number;
    contractsCurrent: number;
    contractsPrevious: number;
    commissionsAccumulated: number;
    commissionsCurrent: number;
    commissionsPrevious: number;
    goalTarget: number | null;
    rankingPosition: number | null;
  };
  monthlyHistory: SellerDashboardMonth[];
  leadTrend: number[];
  pipeline: Array<{ key: string; label: string; count: number }>;
  activities: SellerDashboardActivity[];
  agenda: SellerDashboardAppointment[];
  ranking: SellerDashboardRanking[];
};

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  return numberValue(value);
}

export function calculateGrowth(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

export function goalProgress(current: number, target: number | null): number | null {
  if (!target || target <= 0) return null;
  return (current / target) * 100;
}

export async function fetchSellerDashboard(): Promise<SellerDashboardData> {
  const { data, error } = await (supabase as any).rpc("get_my_seller_dashboard");
  if (error) throw error;
  if (!data || typeof data !== "object") {
    throw new Error("Não foi possível localizar os dados deste vendedor.");
  }

  const payload = data as Record<string, any>;
  const metrics = (payload.metrics ?? {}) as Record<string, unknown>;
  const seller = (payload.seller ?? {}) as Record<string, unknown>;

  return {
    generatedAt: String(payload.generated_at ?? new Date().toISOString()),
    seller: {
      id: String(seller.id ?? ""),
      name: String(seller.name ?? "Vendedor"),
      avatarUrl: seller.avatar_url ? String(seller.avatar_url) : null,
    },
    metrics: {
      leadsPending: numberValue(metrics.leads_pending),
      leadsNewThisWeek: numberValue(metrics.leads_new_this_week),
      contractsCurrent: numberValue(metrics.contracts_current),
      contractsPrevious: numberValue(metrics.contracts_previous),
      commissionsAccumulated: numberValue(metrics.commissions_accumulated),
      commissionsCurrent: numberValue(metrics.commissions_current),
      commissionsPrevious: numberValue(metrics.commissions_previous),
      goalTarget: nullableNumber(metrics.goal_target),
      rankingPosition: nullableNumber(metrics.ranking_position),
    },
    monthlyHistory: ((payload.monthly_history ?? []) as Record<string, unknown>[]).map((row) => {
      const month = numberValue(row.month);
      const year = numberValue(row.year);
      return {
        month,
        year,
        label: `${MONTH_LABELS[Math.max(0, month - 1)]}/${String(year).slice(-2)}`,
        contracts: numberValue(row.contracts),
        accumulated: numberValue(row.accumulated),
        commissions: numberValue(row.commissions),
      };
    }),
    leadTrend: ((payload.lead_trend ?? []) as unknown[]).map(numberValue),
    pipeline: ((payload.pipeline ?? []) as Record<string, unknown>[]).map((row) => ({
      key: String(row.key ?? ""),
      label: String(row.label ?? "Etapa"),
      count: numberValue(row.count),
    })),
    activities: ((payload.activities ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id ?? ""),
      type: String(row.type ?? "lead") as SellerDashboardActivity["type"],
      title: String(row.title ?? "Atividade comercial"),
      subtitle: String(row.subtitle ?? ""),
      occurredAt: String(row.occurred_at ?? new Date().toISOString()),
    })),
    agenda: ((payload.agenda ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id ?? ""),
      title: String(row.title ?? "Compromisso"),
      type: String(row.type ?? "reuniao"),
      status: String(row.status ?? "agendado"),
      scheduledAt: String(row.scheduled_at ?? new Date().toISOString()),
      leadName: row.lead_name ? String(row.lead_name) : null,
    })),
    ranking: ((payload.ranking ?? []) as Record<string, unknown>[]).map((row) => ({
      sellerId: String(row.seller_id ?? ""),
      name: String(row.name ?? "Vendedor"),
      avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
      contracts: numberValue(row.contracts),
      commissions: numberValue(row.commissions),
      position: numberValue(row.position),
      isCurrent: Boolean(row.is_current),
    })),
  };
}
