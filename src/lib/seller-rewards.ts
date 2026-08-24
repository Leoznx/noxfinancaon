import { supabase } from "@/integrations/supabase/client";
import type { SellerRewardMetric } from "@/lib/seller-goals-dashboard";

export type SellerReward = {
  id: string;
  month: number;
  year: number;
  title: string;
  description: string | null;
  image_url: string;
  metric: SellerRewardMetric;
  target: number;
  active: boolean;
  display_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type SellerRewardInput = Pick<
  SellerReward,
  "month" | "year" | "title" | "description" | "image_url" | "metric" | "target"
> &
  Partial<Pick<SellerReward, "active" | "display_order" | "created_by">>;

function normalizeReward(row: Record<string, unknown>): SellerReward {
  return {
    id: String(row.id),
    month: Number(row.month),
    year: Number(row.year),
    title: String(row.title ?? "Recompensa"),
    description: row.description ? String(row.description) : null,
    image_url: String(row.image_url ?? ""),
    metric: row.metric as SellerRewardMetric,
    target: Number(row.target ?? 0),
    active: row.active !== false,
    display_order: Number(row.display_order ?? 0),
    created_by: row.created_by ? String(row.created_by) : null,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

export async function fetchSellerRewards(month: number, year: number, includeInactive = false) {
  let query = supabase
    .from("seller_rewards" as never)
    .select("*")
    .eq("month", month)
    .eq("year", year)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (!includeInactive) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) throw error;
  return ((data as unknown as Record<string, unknown>[] | null) ?? []).map(normalizeReward);
}

export async function createSellerReward(input: SellerRewardInput) {
  const { data, error } = await supabase
    .from("seller_rewards" as never)
    .insert(input as never)
    .select("*")
    .single();
  if (error) throw error;
  return normalizeReward(data as unknown as Record<string, unknown>);
}

export async function updateSellerReward(id: string, input: Partial<SellerRewardInput>) {
  const { data, error } = await supabase
    .from("seller_rewards" as never)
    .update(input as never)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return normalizeReward(data as unknown as Record<string, unknown>);
}

export async function deleteSellerReward(id: string) {
  const { error } = await supabase
    .from("seller_rewards" as never)
    .delete()
    .eq("id", id);
  if (error) throw error;
}
