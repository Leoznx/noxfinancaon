import { supabase } from "@/integrations/supabase/client";
import type { NormalizedWithdrawalPixData } from "@/lib/withdrawal-pix";

export type WithdrawalStatus =
  | "PENDING_REVIEW"
  | "APPROVED"
  | "AWAITING_PAYMENT"
  | "PAID"
  | "REJECTED"
  | "CANCELLED"
  | "MANUAL_REVIEW";

export type CommissionStatus =
  "PENDING" | "AVAILABLE" | "RESERVED" | "PAID" | "REVERSED" | "MANUAL_REVIEW";

export const WITHDRAWAL_STATUS_LABELS: Record<WithdrawalStatus, string> = {
  PENDING_REVIEW: "Em análise",
  APPROVED: "Aprovado",
  AWAITING_PAYMENT: "Aguardando pagamento",
  PAID: "Pago",
  REJECTED: "Recusado",
  CANCELLED: "Cancelado",
  MANUAL_REVIEW: "Revisão manual",
};

export const COMMISSION_STATUS_LABELS: Record<CommissionStatus, string> = {
  PENDING: "Pendente",
  AVAILABLE: "Disponível para saque",
  RESERVED: "Reservada em saque",
  PAID: "Paga",
  REVERSED: "Estornada",
  MANUAL_REVIEW: "Em análise",
};

export const FINANCIAL_STATUS_LABELS: Record<string, string> = {
  ON_TIME: "Em dia",
  PAYMENT_PENDING: "Pagamento pendente",
  OVERDUE: "Em atraso",
  CANCELLED: "Cancelado",
  CLOSED: "Encerrado",
  UNDER_REVIEW: "Em análise",
};

export interface UserFinancialSummary {
  pending_cents: number;
  available_cents: number;
  reserved_cents: number;
  total_accumulated_cents: number;
  total_withdrawn_cents: number;
  active_contracts: number;
  active_withdrawal_id: string | null;
  active_withdrawal_status: WithdrawalStatus | null;
  withdrawal_action: "AVAILABLE" | "UNAVAILABLE" | "UNDER_REVIEW" | "AWAITING_PAYMENT";
}

export interface UserCommission {
  id: string;
  contract_id: string;
  contract_number: string | null;
  tenant_name: string | null;
  base_amount_cents: number;
  percentage_applied: number | null;
  level_applied: string | null;
  amount_cents: number;
  status: CommissionStatus;
  created_at: string;
  available_at: string | null;
  withdrawal_id: string | null;
  withdrawal_status: WithdrawalStatus | null;
  receipt_available: boolean;
}

export interface UserWithdrawal {
  id: string;
  amount_cents: number;
  fee_cents: number;
  net_amount_cents: number;
  status: WithdrawalStatus;
  bank_name: string;
  holder_name: string;
  pix_key_type: "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "RANDOM";
  pix_key_masked: string;
  requested_at: string;
  approved_at: string | null;
  paid_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  receipt_available: boolean;
  contract_count: number;
}

export interface CommissionContract {
  id: string;
  number: string;
  status: string;
  start_date: string;
  end_date: string;
  premium_cents: number;
  tenant_name: string | null;
  financial_status: string;
  commission_status: CommissionStatus | null;
  commission_cents: number | null;
}

export interface FinanceSummary {
  revenue_received_cents: number;
  revenue_pending_cents: number;
  commissions_paid_cents: number;
  commissions_payable_cents: number;
  open_withdrawals: number;
  pending_review_withdrawals: number;
  paid_withdrawals: number;
  commission_count: number;
  payment_count: number;
}

export interface FinanceWithdrawal extends UserWithdrawal {
  user_id: string;
  requester_name: string;
  requester_email: string;
  user_type: string;
  paid_by: string | null;
  paid_by_name: string | null;
}

export interface FinanceCommission {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  user_type: string;
  contract_id: string;
  contract_number: string;
  base_amount_cents: number;
  percentage_applied: number | null;
  level_applied: string | null;
  amount_cents: number;
  status: CommissionStatus;
  available_at: string | null;
  withdrawal_id: string | null;
  created_at: string;
}

export interface WithdrawalContractDetails {
  contract_id: string;
  contract_number: string;
  tenant_name: string | null;
  owner_name: string | null;
  responsible_name: string | null;
  contract_value_cents: number;
  base_amount_cents: number;
  percentage_applied: number | null;
  commission_cents: number;
  start_date: string;
  last_payment_at: string | null;
  next_due_date: string | null;
  contract_status: string;
  financial_status: string;
  paid_installments: number;
  pending_installments: number;
  has_overdue: boolean;
  contract_url: string;
}

export interface WithdrawalDetails {
  withdrawal: UserWithdrawal & {
    user_id: string;
    user_type: string;
    reviewed_at: string | null;
    payment_notes: string | null;
    receipt_file_name: string | null;
    receipt_mime_type: string | null;
    receipt_size_bytes: number | null;
  };
  requester: {
    id: string;
    name: string;
    email: string;
    role: string;
    document: string | null;
    created_at: string;
    commission_level: string | null;
    active_contracts: number;
    withdrawal_count: number;
    total_accumulated_cents: number;
    total_withdrawn_cents: number;
  };
  contracts: WithdrawalContractDetails[];
  timeline: Array<{
    action: string;
    previous_status: string | null;
    new_status: string | null;
    created_at: string;
    actor_name: string | null;
  }>;
}

type JsonRecord = Record<string, unknown>;

const untypedSupabase = supabase as unknown as {
  rpc: (
    name: string,
    args: JsonRecord,
  ) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
};

const rpc = async <T>(name: string, args: JsonRecord = {}): Promise<T> => {
  const { data, error } = await untypedSupabase.rpc(name, args);
  if (error) throw toWithdrawalError(error);
  return data as T;
};

export class WithdrawalError extends Error {
  constructor(
    message: string,
    public readonly code = "WITHDRAWAL_ERROR",
  ) {
    super(message);
  }
}

export function toWithdrawalError(error: unknown) {
  if (error instanceof WithdrawalError) return error;
  const source = error as { message?: string; code?: string; context?: { body?: unknown } };
  const raw = String(source?.message || "");
  const messages: Array<[string, string]> = [
    ["WITHDRAWAL_AUTH_REQUIRED", "Sua sessão expirou. Entre novamente para continuar."],
    ["WITHDRAWAL_PROFILE_NOT_ALLOWED", "Seu perfil não possui acesso a este saque."],
    ["WITHDRAWAL_INVALID_BANK", "Informe um banco válido."],
    ["WITHDRAWAL_INVALID_HOLDER", "Informe o nome completo do titular."],
    ["WITHDRAWAL_INVALID_PIX", "Confira a chave Pix informada."],
    [
      "WITHDRAWAL_BALANCE_CHANGED",
      "Seu saldo disponível foi atualizado. Recarregue e tente novamente.",
    ],
    ["WITHDRAWAL_FORBIDDEN", "Você não possui permissão para executar esta ação."],
    ["WITHDRAWAL_REJECTION_REASON_REQUIRED", "Informe o motivo da recusa."],
    ["WITHDRAWAL_INVALID_RECEIPT", "O comprovante enviado não é permitido."],
  ];
  const match = messages.find(([code]) => raw.includes(code));
  return new WithdrawalError(
    match?.[1] || "Não foi possível concluir a operação financeira. Tente novamente.",
    match?.[0] || source?.code || "WITHDRAWAL_ERROR",
  );
}

export const formatCents = (cents: number | null | undefined) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(cents || 0) / 100,
  );

export const getUserFinancialSummary = () =>
  rpc<UserFinancialSummary>("get_user_financial_summary");
export const getMyCommissions = () => rpc<UserCommission[]>("get_my_commissions");
export const getMyWithdrawals = () => rpc<UserWithdrawal[]>("get_my_withdrawals");
export const getMyCommissionContracts = () =>
  rpc<CommissionContract[]>("get_my_commission_contracts");

export async function requestWithdrawal(data: NormalizedWithdrawalPixData, idempotencyKey: string) {
  return rpc<{
    ok: boolean;
    code?: string;
    withdrawal_id?: string;
    status?: WithdrawalStatus;
    amount_cents?: number;
  }>("request_withdrawal", {
    p_bank_name: data.bankName,
    p_holder_name: data.holderName,
    p_pix_key_type: data.pixKeyType,
    p_pix_key: data.pixKey,
    p_idempotency_key: idempotencyKey,
  });
}

export const getWithdrawalDetails = (withdrawalId: string) =>
  rpc<WithdrawalDetails | null>("get_withdrawal_details", {
    p_withdrawal_id: withdrawalId,
  });

export const approveWithdrawal = (withdrawalId: string) =>
  rpc<{ ok: boolean; code?: string; status?: WithdrawalStatus; issues?: unknown[] }>(
    "approve_withdrawal",
    { p_withdrawal_id: withdrawalId },
  );

export const rejectWithdrawal = (withdrawalId: string, reason: string) =>
  rpc<{ ok: boolean; code?: string; status?: WithdrawalStatus }>("reject_withdrawal", {
    p_withdrawal_id: withdrawalId,
    p_reason: reason,
  });

export const revealWithdrawalPix = (withdrawalId: string) =>
  rpc<{
    withdrawal_id: string;
    pix_key_type: string;
    pix_key: string;
    bank_name: string;
    holder_name: string;
  }>("reveal_withdrawal_pix", { p_withdrawal_id: withdrawalId });

export const getFinanceSummary = () => rpc<FinanceSummary>("get_finance_dashboard_summary");

export const listFinanceWithdrawals = (
  params: {
    scope?: "OPEN" | "PAID" | "ALL";
    search?: string;
    startDate?: string;
    endDate?: string;
    bank?: string;
    paidBy?: string;
    userType?: string;
    minCents?: number;
    maxCents?: number;
  } = {},
) =>
  rpc<FinanceWithdrawal[]>("list_finance_withdrawals", {
    p_scope: params.scope || "OPEN",
    p_search: params.search || null,
    p_start_date: params.startDate || null,
    p_end_date: params.endDate || null,
    p_bank: params.bank || null,
    p_paid_by: params.paidBy || null,
    p_user_type: params.userType || null,
    p_min_cents: params.minCents ?? null,
    p_max_cents: params.maxCents ?? null,
  });

export const listFinanceCommissions = () => rpc<FinanceCommission[]>("list_finance_commissions");

export async function markWithdrawalPaid(params: {
  withdrawalId: string;
  receipt: File;
  paymentNotes?: string;
}) {
  const body = new FormData();
  body.set("withdrawal_id", params.withdrawalId);
  body.set("receipt", params.receipt);
  body.set("confirmed", "true");
  if (params.paymentNotes?.trim()) body.set("payment_notes", params.paymentNotes.trim());
  const { data, error } = await supabase.functions.invoke("mark-withdrawal-paid", { body });
  if (error) throw toWithdrawalError(error);
  if (!data?.ok)
    throw new WithdrawalError(data?.error || "O pagamento não pôde ser confirmado.", data?.code);
  return data as { ok: true; withdrawal_id: string; status: "PAID" };
}

export async function getWithdrawalReceiptUrl(
  withdrawalId: string,
  accessType: "view" | "download" = "view",
) {
  const { data, error } = await supabase.functions.invoke("withdrawal-receipt-url", {
    body: { withdrawal_id: withdrawalId, access_type: accessType },
  });
  if (error) throw toWithdrawalError(error);
  if (!data?.ok || !data?.url) {
    throw new WithdrawalError(data?.error || "O comprovante não está disponível.", data?.code);
  }
  return data.url as string;
}
