import { supabase } from "@/integrations/supabase/client";
import { fetchNivelInfo, type NivelInfo } from "@/lib/niveis-parceria";
import {
  getMyCommissionContracts,
  getMyCommissions,
  getMyWithdrawals,
  getUserFinancialSummary,
  type CommissionContract,
  type UserCommission,
  type UserFinancialSummary,
  type UserWithdrawal,
} from "@/lib/withdrawals";
import { loadSessionResource, peekSessionResource } from "@/lib/session-resource-cache";

const ROUTE_DATA_MAX_AGE_MS = 45_000;
const LIST_LIMIT = 100;

export type DashboardNavigationUser = {
  id: string;
  email: string;
  role: string;
};

export type DashboardConsultationRow = Record<string, any>;
export type DashboardPolicyRow = Record<string, any>;

export type CommissionDashboardData = {
  summary: UserFinancialSummary;
  commissions: UserCommission[];
  withdrawals: UserWithdrawal[];
  contracts: CommissionContract[];
  level: NivelInfo | null;
};

type AgencyScope = {
  agencyId: string | null;
  profileIds: string[];
};

const consultationKey = (user: DashboardNavigationUser) => `dashboard-route:${user.id}:consultas`;
const policyKey = (user: DashboardNavigationUser) => `dashboard-route:${user.id}:apolices`;
const commissionKey = (user: DashboardNavigationUser) => `dashboard-route:${user.id}:comissoes`;
const agencyScopeKey = (user: DashboardNavigationUser) => `dashboard-route:${user.id}:agency-scope`;

async function loadAgencyScope(user: DashboardNavigationUser): Promise<AgencyScope> {
  return loadSessionResource(
    agencyScopeKey(user),
    async () => {
      const { data: agency, error: agencyError } = await supabase
        .from("imobiliarias")
        .select("id")
        .ilike("contato_email", user.email)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (agencyError) throw agencyError;
      if (!agency?.id) return { agencyId: null, profileIds: [user.id] };

      const { data: brokers, error: brokersError } = await supabase
        .from("corretores")
        .select("profile_id")
        .eq("imobiliaria_id", agency.id);
      if (brokersError) throw brokersError;
      return {
        agencyId: agency.id,
        profileIds: Array.from(
          new Set([user.id, ...(brokers ?? []).map((broker) => broker.profile_id).filter(Boolean)]),
        ),
      };
    },
    { maxAgeMs: 5 * 60_000 },
  );
}

export function peekDashboardConsultations(user: DashboardNavigationUser) {
  return peekSessionResource<DashboardConsultationRow[]>(consultationKey(user));
}

export async function loadDashboardConsultations(
  user: DashboardNavigationUser,
  force = false,
): Promise<DashboardConsultationRow[]> {
  return loadSessionResource(
    consultationKey(user),
    async () => {
      let query = supabase.from("consultas_credito").select(`
        id, status, resultado, substatus, technical_status, automation_step,
        created_at, updated_at, tenant_name, tenant_document, documento,
        property_address, rent_value, payment_status, profile_id_solicitante,
        role_solicitante,
        inquilinos (nome, cpf, cnpj),
        imoveis (logradouro, numero, bairro, cidade, estado, cep, valor_aluguel),
        planos (nome),
        solicitante:profiles!profile_id_solicitante (nome, email, role)
      `);

      if (!["admin", "admin_master", "analista"].includes(user.role)) {
        if (user.role === "imobiliaria") {
          const scope = await loadAgencyScope(user);
          query = query.in("profile_id_solicitante", scope.profileIds);
        } else if (user.role === "inquilino") {
          query = query.or(
            `profile_id_solicitante.eq.${user.id},tenant_user_id.eq.${user.id},tenant_email.eq."${user.email}"`,
          );
        } else {
          query = query.or(
            `profile_id_solicitante.eq.${user.id},and(profile_id_solicitante.is.null,role_solicitante.eq.${user.role})`,
          );
        }
      }

      const { data, error } = await query
        .order("updated_at", { ascending: false })
        .limit(LIST_LIMIT);
      if (error) throw error;
      return (data ?? []) as DashboardConsultationRow[];
    },
    { force, maxAgeMs: ROUTE_DATA_MAX_AGE_MS },
  );
}

export function peekDashboardPolicies(user: DashboardNavigationUser) {
  return peekSessionResource<DashboardPolicyRow[]>(policyKey(user));
}

export async function loadDashboardPolicies(
  user: DashboardNavigationUser,
  force = false,
): Promise<DashboardPolicyRow[]> {
  return loadSessionResource(
    policyKey(user),
    async () => {
      let query = supabase
        .from("apolices")
        .select(
          `
          id, numero, status, vigencia_inicio, vigencia_fim, valor_premio,
          consulta:consultas_credito!inner(
            profile_id_solicitante,
            inquilino:inquilinos(nome, cpf),
            imovel:imoveis(endereco, cidade, estado),
            plano:planos(nome),
            solicitante:profiles!profile_id_solicitante(nome)
          ),
          imobiliaria:profiles!apolices_imobiliaria_profile_id_fkey(nome)
        `,
        )
        .order("created_at", { ascending: false })
        .limit(LIST_LIMIT);

      if (user.role === "corretor") {
        query = query.eq("consulta.profile_id_solicitante", user.id);
      } else if (user.role === "imobiliaria") {
        const scope = await loadAgencyScope(user);
        query = query.in("consulta.profile_id_solicitante", scope.profileIds);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as DashboardPolicyRow[];
    },
    { force, maxAgeMs: ROUTE_DATA_MAX_AGE_MS },
  );
}

export function peekCommissionDashboard(user: DashboardNavigationUser) {
  return peekSessionResource<CommissionDashboardData>(commissionKey(user));
}

export async function loadCommissionDashboard(
  user: DashboardNavigationUser,
  force = false,
): Promise<CommissionDashboardData> {
  return loadSessionResource(
    commissionKey(user),
    async () => {
      const [summary, commissions, withdrawals, contracts, level] = await Promise.all([
        getUserFinancialSummary(),
        getMyCommissions(),
        getMyWithdrawals(),
        getMyCommissionContracts(),
        fetchNivelInfo(user.id, user.role).catch(() => null),
      ]);
      return {
        summary,
        commissions: Array.isArray(commissions) ? commissions : [],
        withdrawals: Array.isArray(withdrawals) ? withdrawals : [],
        contracts: Array.isArray(contracts) ? contracts : [],
        level,
      };
    },
    { force, maxAgeMs: ROUTE_DATA_MAX_AGE_MS },
  );
}

export async function prefetchDashboardDataForHref(
  href: string,
  user: DashboardNavigationUser,
): Promise<void> {
  const pathname = href.split("?")[0].replace(/\/$/, "") || "/";
  if (pathname === "/dashboard" && user.role === "imobiliaria") {
    const { loadImobiliariaDashboard } = await import("@/lib/imobiliaria-dashboard");
    await loadImobiliariaDashboard(user.id, user.email);
  } else if (pathname === "/dashboard" && user.role === "corretor") {
    const { loadCorretorDashboard } = await import("@/lib/imobiliaria-dashboard");
    await loadCorretorDashboard(user.id);
  } else if (pathname === "/consultas") {
    await loadDashboardConsultations(user);
  } else if (pathname === "/apolices") {
    await loadDashboardPolicies(user);
  } else if (pathname === "/faturas-inquilinos") {
    const { loadTenantInvoiceSummaries } = await import("@/lib/tenant-invoice-summary");
    await loadTenantInvoiceSummaries(user.id);
  } else if (pathname === "/carteira-cobrancas" && ["corretor", "imobiliaria", "proprietario"].includes(user.role)) {
    const { loadCarteiraCobrancas } = await import("@/lib/carteira-cobrancas-data");
    const { loadCobrancasAvulsas } = await import("@/lib/cobrancas-avulsas-data");
    await Promise.all([loadCarteiraCobrancas(user), loadCobrancasAvulsas(user)]);
  } else if (pathname === "/plano-carreira") {
    const { loadCareerContractCount } = await import("@/lib/career-progress");
    await loadCareerContractCount(user.id, user.role);
  } else if (
    pathname === "/minhas-comissoes" &&
    ["corretor", "imobiliaria", "proprietario"].includes(user.role)
  ) {
    await loadCommissionDashboard(user);
  }
}
