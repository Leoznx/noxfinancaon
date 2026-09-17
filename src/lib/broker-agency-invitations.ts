import { supabase } from "@/integrations/supabase/client";
import type { BrokerCommissionAllocationMode } from "@/lib/broker-commission-policy";

export type BrokerAgencyMember = {
  membership_id: string;
  corretor_id: string;
  profile_id: string;
  membership_status: "pending" | "active";
  nome: string | null;
  email: string | null;
  telefone: string | null;
  cpf: string | null;
  creci: string | null;
  commission_allocation_mode: BrokerCommissionAllocationMode;
  profile_status: string | null;
  registered_at: string;
  linked_at: string;
  contracts_count: number;
};

type InvitationApiResponse = {
  ok: boolean;
  error?: string;
  emailSent?: boolean;
  activatedNow?: boolean;
  status?: string;
  brokerName?: string;
  agencyName?: string;
  warnings?: string[];
  invitation?: {
    id: string;
    status: "pending" | "accepted" | "revoked" | "expired";
    expiresAt: string;
    brokerName: string;
    agencyName: string;
    commissionAllocationMode: BrokerCommissionAllocationMode;
  };
};

export async function listMyBrokerAgencyMembers() {
  const { data, error } = await supabase.rpc("list_my_broker_agency_members");
  return {
    data: ((data || []) as BrokerAgencyMember[]).map((row) => ({
      ...row,
      contracts_count: Number(row.contracts_count || 0),
    })),
    error: error?.message || null,
  };
}

export async function createBrokerAgencyInvitation(
  corretorId: string,
  commissionAllocationMode: BrokerCommissionAllocationMode,
) {
  const { data, error } = await supabase.functions.invoke<InvitationApiResponse>(
    "broker-agency-invitation",
    {
      body: {
        action: "create",
        payload: { corretorId, commissionAllocationMode },
      },
    },
  );
  if (error) return { ok: false, error: error.message, emailSent: false };
  return {
    ok: data?.ok === true,
    error: data?.error || null,
    emailSent: data?.emailSent === true,
  };
}

export async function inspectBrokerAgencyInvitation(token: string) {
  const { data, error } = await supabase.functions.invoke<InvitationApiResponse>(
    "broker-agency-invitation",
    { body: { action: "inspect", payload: { token } } },
  );
  if (error || !data?.ok || !data.invitation) {
    return { invitation: null, error: data?.error || error?.message || "Convite inválido." };
  }
  return { invitation: data.invitation, error: null };
}

export async function acceptBrokerAgencyInvitation(token: string) {
  const { data, error } = await supabase.functions.invoke<InvitationApiResponse>(
    "broker-agency-invitation",
    { body: { action: "accept", payload: { token } } },
  );
  if (error || !data?.ok) {
    return { ok: false, error: data?.error || error?.message || "Não foi possível confirmar o vínculo." };
  }
  return {
    ok: true,
    error: null,
    brokerName: data.brokerName || "Corretor",
    agencyName: data.agencyName || "Imobiliária",
  };
}
