import { supabase } from "@/integrations/supabase/client";
import { loadSessionResource, peekSessionResource } from "@/lib/session-resource-cache";
import {
  type FinanceCommission,
  type FinanceSummary,
  type FinanceWithdrawal,
  getFinanceSummary,
  listFinanceCommissions,
  listFinanceWithdrawals,
} from "@/lib/withdrawals";

const DASHBOARD_CACHE_MAX_AGE_MS = 2 * 60_000;

export type FinanceInvoice = {
  id: string;
  valor: number;
  status: string;
  vencimento: string;
  pago_em: string | null;
  numero_parcela: number;
  apolice_id: string | null;
};

export type FinanceiroDashboardData = {
  summary: FinanceSummary;
  invoices: FinanceInvoice[];
  commissions: FinanceCommission[];
  withdrawals: FinanceWithdrawal[];
};

export const EMPTY_FINANCE_SUMMARY: FinanceSummary = {
  revenue_received_cents: 0,
  revenue_pending_cents: 0,
  commissions_paid_cents: 0,
  commissions_payable_cents: 0,
  open_withdrawals: 0,
  pending_review_withdrawals: 0,
  paid_withdrawals: 0,
  commission_count: 0,
  payment_count: 0,
  active_contracts: 0,
  pending_contracts: 0,
  contracts_missing_billing: 0,
  reconciliation_required: 0,
};

export type MarketingDashboardData = {
  leads: Record<string, any>[];
  posts: Record<string, any>[];
  usingDemo: boolean;
};

const DEMO_LEADS: Record<string, any>[] = [
  {
    id: "LEAD-MKT-001",
    nome: "Joao da Silva",
    origem: "Blog",
    status: "novo",
    interesse: "Seguro fianca",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(),
  },
  {
    id: "LEAD-MKT-002",
    nome: "Maria Oliveira",
    origem: "Seja parceiro",
    status: "qualificado",
    interesse: "Parceria",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
  },
];

const financeKey = (userId: string) => `dashboard:financeiro:${userId}`;
const marketingKey = (userId: string) => `dashboard:marketing:${userId}`;

async function fetchFinanceiroDashboard(): Promise<FinanceiroDashboardData> {
  const [summary, withdrawals, commissions, invoiceResult] = await Promise.all([
    getFinanceSummary(),
    listFinanceWithdrawals({ scope: "OPEN" }),
    listFinanceCommissions(),
    supabase
      .from("faturas_inquilino")
      .select("id, valor, status, vencimento, pago_em, numero_parcela, apolice_id")
      .order("vencimento", { ascending: false })
      .limit(5000),
  ]);
  if (invoiceResult.error) throw invoiceResult.error;
  return {
    summary,
    withdrawals,
    commissions,
    invoices: (invoiceResult.data ?? []) as FinanceInvoice[],
  };
}

async function fetchMarketingDashboard(): Promise<MarketingDashboardData> {
  const { data, error } = await supabase
    .from("leads")
    .select("id, nome, telefone, email, origem, status, created_at")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  const leadRows = (data ?? []) as Record<string, any>[];
  if (leadRows.length) return { leads: leadRows, posts: [], usingDemo: false };
  return {
    leads: DEMO_LEADS,
    posts: [
      {
        id: "BLOG-MKT-001",
        titulo: "Como alugar sem fiador",
        status: "publicado",
        created_at: new Date().toISOString(),
      },
    ],
    usingDemo: true,
  };
}

export const peekFinanceiroDashboard = (userId: string) =>
  peekSessionResource<FinanceiroDashboardData>(financeKey(userId));

export const loadFinanceiroDashboard = (userId: string, force = false) =>
  loadSessionResource(financeKey(userId), fetchFinanceiroDashboard, {
    force,
    maxAgeMs: DASHBOARD_CACHE_MAX_AGE_MS,
  });

export const peekMarketingDashboard = (userId: string) =>
  peekSessionResource<MarketingDashboardData>(marketingKey(userId));

export const loadMarketingDashboard = (userId: string, force = false) =>
  loadSessionResource(marketingKey(userId), fetchMarketingDashboard, {
    force,
    maxAgeMs: DASHBOARD_CACHE_MAX_AGE_MS,
  });
