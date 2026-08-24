import { supabase } from "@/integrations/supabase/client";

export type SellerClientBroker = {
  profile_id: string;
  nome: string;
  email: string;
  cidade: string | null;
};

export type SellerClient = {
  partnership_id: string;
  partner_type: "corretor_autonomo" | "imobiliaria";
  partner_name: string;
  partner_email: string;
  partner_city: string | null;
  registered_by_name: string;
  registered_at: string;
  broker_count: number;
  brokers: SellerClientBroker[];
};

export type SellerClientMonthlyHistory = {
  month: number;
  year: number;
  contracts_closed: number;
  first_installments_paid: number;
};

export type SellerClientContract = {
  partnership_id: string;
  partner_name: string;
  partner_type: "corretor_autonomo" | "imobiliaria";
  contract_id: string;
  contract_number: string | null;
  requester_profile_id: string;
  requester_name: string;
  contract_closed_at: string;
  city: string | null;
  first_installment_paid: boolean;
  first_installment_paid_at: string | null;
};

function normalizeRows<T>(rows: unknown): T[] {
  return Array.isArray(rows) ? (rows as T[]) : [];
}

export async function registerSellerClient(email: string): Promise<string> {
  const { data, error } = await supabase.rpc(
    "register_my_seller_client" as never,
    { p_email: email } as never,
  );

  if (error) throw error;
  return String(data);
}

export async function fetchSellerClients(): Promise<SellerClient[]> {
  const { data, error } = await supabase.rpc("get_my_seller_clients" as never);
  if (error) throw error;

  return normalizeRows<SellerClient>(data).map((row) => ({
    ...row,
    broker_count: Number(row.broker_count ?? 0),
    brokers: normalizeRows<SellerClientBroker>(row.brokers),
  }));
}

export async function fetchSellerClientMonthlyHistory(): Promise<SellerClientMonthlyHistory[]> {
  const { data, error } = await supabase.rpc("get_my_seller_client_monthly_history" as never);
  if (error) throw error;

  return normalizeRows<SellerClientMonthlyHistory>(data).map((row) => ({
    ...row,
    month: Number(row.month),
    year: Number(row.year),
    contracts_closed: Number(row.contracts_closed ?? 0),
    first_installments_paid: Number(row.first_installments_paid ?? 0),
  }));
}

export async function fetchSellerClientContracts(
  month: number,
  year: number,
): Promise<SellerClientContract[]> {
  const { data, error } = await supabase.rpc(
    "get_my_seller_client_contracts" as never,
    { p_month: month, p_year: year } as never,
  );

  if (error) throw error;
  return normalizeRows<SellerClientContract>(data);
}
