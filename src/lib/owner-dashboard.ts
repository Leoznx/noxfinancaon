import { supabase } from "@/integrations/supabase/client";

export type OwnerDashboardPeriod = "3" | "6" | "year" | "12";

export type OwnerDashboardSummary = {
  propertyCount: number;
  activePropertyCount: number;
  availablePropertyCount: number;
  activeContractCount: number;
  currentMonthReceived: number;
  previousMonthReceived: number;
  monthChangePercent: number | null;
  yearReceived: number;
  activeClaimCount: number;
};

export type OwnerMonthlyRevenue = {
  monthStart: string;
  amount: number;
};

export type OwnerPropertyRevenue = {
  propertyId: string | null;
  propertyName: string;
  amount: number;
  percentage: number;
};

export type OwnerDashboardContract = {
  id: string;
  number: string | null;
  propertyId: string | null;
  propertyName: string;
  location: string;
  tenantName: string;
  rentValue: number;
  nextDueDate: string | null;
  status: string;
};

export type OwnerDashboardActivity = {
  id: string;
  type: "payment" | "contract" | "invoice" | "claim" | string;
  title: string;
  description: string;
  propertyName: string | null;
  amount: number | null;
  occurredAt: string;
};

export type OwnerDashboardData = {
  generatedAt: string | null;
  summary: OwnerDashboardSummary;
  monthlyRevenue: OwnerMonthlyRevenue[];
  propertyRevenue: OwnerPropertyRevenue[];
  contracts: OwnerDashboardContract[];
  activities: OwnerDashboardActivity[];
};

const EMPTY_SUMMARY: OwnerDashboardSummary = {
  propertyCount: 0,
  activePropertyCount: 0,
  availablePropertyCount: 0,
  activeContractCount: 0,
  currentMonthReceived: 0,
  previousMonthReceived: 0,
  monthChangePercent: null,
  yearReceived: 0,
  activeClaimCount: 0,
};

const asNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const asNullableNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asString = (value: unknown, fallback = "") =>
  typeof value === "string" && value.trim() ? value : fallback;

export function normalizeOwnerDashboard(payload: unknown): OwnerDashboardData {
  const raw = payload && typeof payload === "object" ? (payload as Record<string, any>) : {};
  const summary = raw.summary && typeof raw.summary === "object" ? raw.summary : {};
  const monthly = Array.isArray(raw.monthly_revenue) ? raw.monthly_revenue : [];
  const properties = Array.isArray(raw.property_revenue) ? raw.property_revenue : [];
  const contracts = Array.isArray(raw.contracts) ? raw.contracts : [];
  const activities = Array.isArray(raw.activities) ? raw.activities : [];

  return {
    generatedAt: typeof raw.generated_at === "string" ? raw.generated_at : null,
    summary: {
      ...EMPTY_SUMMARY,
      propertyCount: asNumber(summary.property_count),
      activePropertyCount: asNumber(summary.active_property_count),
      availablePropertyCount: asNumber(summary.available_property_count),
      activeContractCount: asNumber(summary.active_contract_count),
      currentMonthReceived: asNumber(summary.current_month_received),
      previousMonthReceived: asNumber(summary.previous_month_received),
      monthChangePercent: asNullableNumber(summary.month_change_percent),
      yearReceived: asNumber(summary.year_received),
      activeClaimCount: asNumber(summary.active_claim_count),
    },
    monthlyRevenue: monthly.map((item: any) => ({
      monthStart: asString(item?.month_start),
      amount: asNumber(item?.amount),
    })),
    propertyRevenue: properties.map((item: any) => ({
      propertyId: typeof item?.property_id === "string" ? item.property_id : null,
      propertyName: asString(item?.property_name, "Imóvel sem endereço"),
      amount: asNumber(item?.amount),
      percentage: asNumber(item?.percentage),
    })),
    contracts: contracts.map((item: any) => ({
      id: asString(item?.id),
      number: typeof item?.number === "string" ? item.number : null,
      propertyId: typeof item?.property_id === "string" ? item.property_id : null,
      propertyName: asString(item?.property_name, "Imóvel sem endereço"),
      location: asString(item?.location),
      tenantName: asString(item?.tenant_name, "Inquilino não informado"),
      rentValue: asNumber(item?.rent_value),
      nextDueDate: typeof item?.next_due_date === "string" ? item.next_due_date : null,
      status: asString(item?.status, "pendente"),
    })),
    activities: activities.map((item: any) => ({
      id: asString(item?.id),
      type: asString(item?.type, "contract"),
      title: asString(item?.title, "Atualização"),
      description: asString(item?.description),
      propertyName: typeof item?.property_name === "string" ? item.property_name : null,
      amount: asNullableNumber(item?.amount),
      occurredAt: asString(item?.occurred_at),
    })),
  };
}

export function filterMonthlyRevenue(
  rows: OwnerMonthlyRevenue[],
  period: OwnerDashboardPeriod,
  now = new Date(),
) {
  const validRows = rows.filter(
    (row) => row.monthStart && !Number.isNaN(new Date(row.monthStart).getTime()),
  );
  if (period === "year") {
    return validRows.filter(
      (row) => new Date(`${row.monthStart}T12:00:00`).getFullYear() === now.getFullYear(),
    );
  }
  return validRows.slice(-Number(period));
}

export async function fetchOwnerDashboard(): Promise<OwnerDashboardData> {
  const { data, error } = await (supabase as any).rpc("get_my_owner_dashboard", {
    p_months: 12,
  });
  if (error) throw new Error(error.message || "Não foi possível carregar o dashboard.");
  return normalizeOwnerDashboard(data);
}
