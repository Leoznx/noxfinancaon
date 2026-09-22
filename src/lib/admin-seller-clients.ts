import { supabase } from "@/integrations/supabase/client";

export type AdminSellerPortfolio = {
  seller_id: string;
  seller_name: string;
  seller_email: string;
  seller_type: "sdr" | "closer";
  seller_status: string;
  client_count: number;
};

export type AdminSellerPortfolioClient = {
  seller_id: string;
  client_profile_id: string;
  client_name: string;
  client_email: string;
  client_phone: string | null;
  profile_role: string;
  registered_at: string;
  attribution_source: string;
};

function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export async function fetchAdminSellerPortfolios(): Promise<AdminSellerPortfolio[]> {
  const { data, error } = await supabase.rpc("admin_list_seller_client_portfolios" as never);
  if (error) throw new Error(error.message);
  return rows<AdminSellerPortfolio>(data).map((row) => ({
    ...row,
    client_count: Number(row.client_count ?? 0),
  }));
}

export async function fetchAdminSellerPortfolioClients(
  sellerId: string,
): Promise<AdminSellerPortfolioClient[]> {
  const { data, error } = await supabase.rpc(
    "admin_list_seller_portfolio_clients" as never,
    { p_seller_id: sellerId } as never,
  );
  if (error) throw new Error(error.message);
  return rows<AdminSellerPortfolioClient>(data);
}

export async function unlinkAdminSellerClient(sellerId: string, clientProfileId: string) {
  const { data, error } = await supabase.rpc(
    "admin_unlink_seller_client" as never,
    { p_seller_id: sellerId, p_client_profile_id: clientProfileId } as never,
  );
  if (error) throw new Error(error.message);
  return data;
}
