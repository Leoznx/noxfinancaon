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

function normalizeCommissionAllocationMode(value: string | null | undefined): BrokerCommissionAllocationMode {
  return value === "split_50" || value === "agency_full" ? value : "broker_full";
}

async function listBrokerAgencyMembersFallback(imobiliariaId: string) {
  const now = new Date().toISOString();
  const [activeResult, pendingResult] = await Promise.all([
    supabase
      .from("corretores")
      .select("id, profile_id, cpf, creci, commission_allocation_mode, updated_at")
      .eq("imobiliaria_id", imobiliariaId)
      .or("vinculado_imobiliaria.eq.true,vinculado_imobiliaria.is.null"),
    supabase
      .from("broker_agency_invitations")
      .select("id, corretor_id, broker_profile_id, commission_allocation_mode, requested_at")
      .eq("imobiliaria_id", imobiliariaId)
      .eq("status", "pending")
      .gt("expires_at", now),
  ]);

  const queryError = activeResult.error || pendingResult.error;
  if (queryError) return { data: [] as BrokerAgencyMember[], error: queryError.message };

  const activeRows = activeResult.data || [];
  const activeBrokerIds = new Set(activeRows.map((row) => row.id));
  const pendingRows = (pendingResult.data || []).filter((row) => !activeBrokerIds.has(row.corretor_id));
  const profileIds = Array.from(
    new Set([
      ...activeRows.map((row) => row.profile_id),
      ...pendingRows.map((row) => row.broker_profile_id),
    ]),
  );

  const profileResult = profileIds.length
    ? await supabase.from("profiles").select("id, nome, email, telefone, status, created_at").in("id", profileIds)
    : { data: [], error: null };
  if (profileResult.error) return { data: [] as BrokerAgencyMember[], error: profileResult.error.message };

  const profiles = new Map((profileResult.data || []).map((profile) => [profile.id, profile]));
  const members: BrokerAgencyMember[] = [
    ...activeRows.map((row) => {
      const profile = profiles.get(row.profile_id);
      return {
        membership_id: row.id,
        corretor_id: row.id,
        profile_id: row.profile_id,
        membership_status: "active" as const,
        nome: profile?.nome || null,
        email: profile?.email || null,
        telefone: profile?.telefone || null,
        cpf: row.cpf,
        creci: row.creci,
        commission_allocation_mode: normalizeCommissionAllocationMode(row.commission_allocation_mode),
        profile_status: profile?.status || null,
        registered_at: profile?.created_at || row.updated_at,
        linked_at: row.updated_at,
        contracts_count: 0,
      };
    }),
    ...pendingRows.map((row) => {
      const profile = profiles.get(row.broker_profile_id);
      return {
        membership_id: row.id,
        corretor_id: row.corretor_id,
        profile_id: row.broker_profile_id,
        membership_status: "pending" as const,
        nome: profile?.nome || null,
        email: null,
        telefone: null,
        cpf: null,
        creci: null,
        commission_allocation_mode: normalizeCommissionAllocationMode(row.commission_allocation_mode),
        profile_status: profile?.status || null,
        registered_at: profile?.created_at || row.requested_at,
        linked_at: row.requested_at,
        contracts_count: 0,
      };
    }),
  ];

  members.sort((left, right) => {
    if (left.membership_status !== right.membership_status) return left.membership_status === "active" ? -1 : 1;
    return new Date(right.linked_at).getTime() - new Date(left.linked_at).getTime();
  });
  return { data: members, error: null };
}

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

export async function listMyBrokerAgencyMembers(imobiliariaId?: string) {
  const { data, error } = await supabase.rpc("list_my_broker_agency_members");
  if (error && imobiliariaId) return listBrokerAgencyMembersFallback(imobiliariaId);
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
