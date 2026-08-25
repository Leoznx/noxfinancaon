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

export type SellerClientPhoneClaimOutcome = "available" | "owned_by_me" | "in_use";

export type SellerClientPhoneClaim = {
  contact_id: string;
  outcome: SellerClientPhoneClaimOutcome;
  phone_display: string;
  seller_name: string;
  contact_status: "em_atendimento" | "cadastrado";
  first_contact_at: string;
  last_contact_at: string;
  expires_at: string | null;
};

export type SellerClientPhoneContact = {
  contact_id: string;
  phone_display: string;
  status: "em_atendimento" | "cadastrado";
  client_email: string | null;
  partner_type: "corretor" | "imobiliaria" | null;
  agency_name: string | null;
  broker_name: string | null;
  city: string | null;
  first_contact_at: string;
  last_contact_at: string;
  registered_at: string | null;
  partnership_id: string | null;
  expires_at: string;
};

export type RegisterSellerClientDetails = {
  email: string;
  phone: string;
  partnerType: "corretor" | "imobiliaria";
  agencyName: string;
  brokerName: string;
  city: string;
};

function normalizeRows<T>(rows: unknown): T[] {
  return Array.isArray(rows) ? (rows as T[]) : [];
}

export function normalizeBrazilianPhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    digits = digits.slice(2);
  }
  return digits;
}

export function formatBrazilianPhoneInput(value: string) {
  const digits = normalizeBrazilianPhone(value).slice(0, 11);
  if (digits.length <= 2) return digits ? `(${digits}` : "";
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function isValidBrazilianPhone(value: string) {
  const digits = normalizeBrazilianPhone(value);
  return (digits.length === 10 || digits.length === 11) && !digits.startsWith("0");
}

export async function claimSellerClientPhone(phone: string): Promise<SellerClientPhoneClaim> {
  const { data, error } = await supabase.rpc(
    "claim_my_seller_client_phone" as never,
    { p_phone: phone } as never,
  );
  if (error) throw error;
  const result = normalizeRows<SellerClientPhoneClaim>(data)[0];
  if (!result) throw new Error("Não foi possível confirmar este telefone.");
  return result;
}

export async function fetchSellerClientPhoneHistory(): Promise<SellerClientPhoneContact[]> {
  const { data, error } = await supabase.rpc(
    "get_my_seller_client_phone_history" as never,
  );
  if (error) throw error;
  return normalizeRows<SellerClientPhoneContact>(data);
}

export async function registerSellerClient(details: RegisterSellerClientDetails): Promise<string> {
  const { data, error } = await supabase.rpc(
    "register_my_seller_client_details" as never,
    {
      p_email: details.email,
      p_phone: details.phone,
      p_partner_type: details.partnerType,
      p_agency_name: details.agencyName,
      p_broker_name: details.brokerName,
      p_city: details.city,
    } as never,
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
