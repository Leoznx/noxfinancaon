import { useCallback, useEffect, useMemo, useState } from "react";
import { createLazyFileRoute } from "@tanstack/react-router";
import {
  AlertCircle,
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  FileText,
  Landmark,
  Loader2,
  Medal,
  Receipt,
  RefreshCw,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { DashboardLayout } from "@/components/DashboardLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { WithdrawalDetailsDialog } from "@/components/comissoes/WithdrawalDetailsDialog";
import { WithdrawalRequestDialog } from "@/components/comissoes/WithdrawalRequestDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { fetchNivelInfo, type NivelInfo } from "@/lib/niveis-parceria";
import {
  COMMISSION_STATUS_LABELS,
  FINANCIAL_STATUS_LABELS,
  formatCents,
  getMyCommissionContracts,
  getMyCommissions,
  getMyWithdrawals,
  getUserFinancialSummary,
  toWithdrawalError,
  WITHDRAWAL_STATUS_LABELS,
  type CommissionContract,
  type CommissionStatus,
  type UserCommission,
  type UserFinancialSummary,
  type UserWithdrawal,
  type WithdrawalStatus,
} from "@/lib/withdrawals";

export const Route = createLazyFileRoute("/minhas-comissoes")({
  component: () => (
    <ProtectedRoute roles={["corretor", "imobiliaria", "proprietario"]}>
      <ErrorBoundary nome="comissões">
        <CommissionsPage />
      </ErrorBoundary>
    </ProtectedRoute>
  ),
});

const emptySummary: UserFinancialSummary = {
  pending_cents: 0,
  available_cents: 0,
  reserved_cents: 0,
  total_accumulated_cents: 0,
  total_withdrawn_cents: 0,
  active_contracts: 0,
  active_withdrawal_id: null,
  active_withdrawal_status: null,
  withdrawal_action: "UNAVAILABLE",
};

const withdrawalTone: Record<WithdrawalStatus, string> = {
  PENDING_REVIEW: "border-amber-200 bg-amber-50 text-amber-800",
  APPROVED: "border-blue-200 bg-blue-50 text-blue-800",
  AWAITING_PAYMENT: "border-indigo-200 bg-indigo-50 text-indigo-800",
  PAID: "border-emerald-200 bg-emerald-50 text-emerald-800",
  REJECTED: "border-red-200 bg-red-50 text-red-800",
  CANCELLED: "border-neutral-200 bg-neutral-100 text-neutral-700",
  MANUAL_REVIEW: "border-orange-200 bg-orange-50 text-orange-800",
};

const commissionTone: Record<CommissionStatus, string> = {
  PENDING: "border-amber-200 bg-amber-50 text-amber-800",
  AVAILABLE: "border-emerald-200 bg-emerald-50 text-emerald-800",
  RESERVED: "border-blue-200 bg-blue-50 text-blue-800",
  PAID: "border-neutral-200 bg-neutral-100 text-neutral-800",
  REVERSED: "border-red-200 bg-red-50 text-red-800",
  MANUAL_REVIEW: "border-orange-200 bg-orange-50 text-orange-800",
};

const financialTone: Record<string, string> = {
  ON_TIME: "border-emerald-200 bg-emerald-50 text-emerald-800",
  PAYMENT_PENDING: "border-amber-200 bg-amber-50 text-amber-800",
  OVERDUE: "border-red-200 bg-red-50 text-red-800",
  CANCELLED: "border-red-200 bg-red-50 text-red-800",
  CLOSED: "border-neutral-200 bg-neutral-100 text-neutral-700",
  UNDER_REVIEW: "border-orange-200 bg-orange-50 text-orange-800",
};

function CommissionsPage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<UserFinancialSummary>(emptySummary);
  const [commissions, setCommissions] = useState<UserCommission[]>([]);
  const [withdrawals, setWithdrawals] = useState<UserWithdrawal[]>([]);
  const [contracts, setContracts] = useState<CommissionContract[]>([]);
  const [level, setLevel] = useState<NivelInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("contracts");
  const [requestOpen, setRequestOpen] = useState(false);
  const [detailsId, setDetailsId] = useState<string | null>(null);

  const load = useCallback(
    async (background = false) => {
      if (!user?.id) return;
      if (background) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const [nextSummary, nextCommissions, nextWithdrawals, nextContracts, nextLevel] =
          await Promise.all([
            getUserFinancialSummary(),
            getMyCommissions(),
            getMyWithdrawals(),
            getMyCommissionContracts(),
            fetchNivelInfo(user.id, user.role),
          ]);
        setSummary(nextSummary || emptySummary);
        setCommissions(Array.isArray(nextCommissions) ? nextCommissions : []);
        setWithdrawals(Array.isArray(nextWithdrawals) ? nextWithdrawals : []);
        setContracts(Array.isArray(nextContracts) ? nextContracts : []);
        setLevel(nextLevel);
      } catch (loadError) {
        setError(toWithdrawalError(loadError).message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [user?.id, user?.role],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!user?.id) return;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => load(true), 180);
    };
    const channel = supabase
      .channel(`commission-dashboard-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "withdrawal_requests",
          filter: `user_id=eq.${user.id}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "comissoes",
          filter: `beneficiario_id=eq.${user.id}`,
        },
        refresh,
      )
      .subscribe();
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [load, user?.id]);

  const activeContracts = useMemo(
    () =>
      contracts.filter((contract) => ["ativa", "active"].includes(contract.status.toLowerCase())),
    [contracts],
  );

  const action = useMemo(() => {
    if (refreshing) return { label: "Atualizando...", disabled: true };
    if (summary.withdrawal_action === "AWAITING_PAYMENT") {
      return { label: "Aguardando pagamento", disabled: true };
    }
    if (summary.withdrawal_action === "UNDER_REVIEW") {
      return { label: "Saque em análise", disabled: true };
    }
    if (summary.withdrawal_action === "AVAILABLE" && summary.available_cents > 0) {
      return { label: "Solicitar saque", disabled: false };
    }
    return { label: "Saldo indisponível", disabled: true };
  }, [refreshing, summary.available_cents, summary.withdrawal_action]);

  if (loading) {
    return (
      <DashboardLayout>
        <CommissionSkeleton />
      </DashboardLayout>
    );
  }

  if (error) {
    return (
      <DashboardLayout>
        <div className="mx-auto my-12 max-w-xl rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
          <AlertCircle className="mx-auto mb-4 h-10 w-10 text-red-600" />
          <h1 className="text-xl font-black text-red-950">
            Não foi possível carregar seus dados financeiros
          </h1>
          <p className="mt-2 text-sm text-red-800">{error}</p>
          <Button className="mt-6" onClick={() => load()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Tentar novamente
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-8 animate-fade-in">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-neutral-950">
              Gestão Financeira
            </h1>
            <p className="mt-2 font-medium text-neutral-500">
              Acompanhe suas comissões e solicite saques de forma prática e segura.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </header>

        <section className="overflow-hidden rounded-3xl border border-neutral-800 bg-gradient-to-br from-neutral-950 to-neutral-900 p-6 text-white shadow-xl shadow-neutral-950/10 sm:p-8">
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-start">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-yellow-400">
                Saldo disponível para saque
              </p>
              <p className="mt-2 text-4xl font-black tracking-tight sm:text-5xl">
                {formatCents(summary.available_cents)}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-neutral-300">
                <Badge className="border-yellow-400/40 bg-yellow-400/10 text-yellow-300">
                  <Medal className="mr-1 h-3.5 w-3.5" /> Nível{" "}
                  {level?.nivelAtual?.nome_nivel || "—"}
                </Badge>
                <span>
                  <strong className="text-white">
                    {level?.nivelAtual?.percentual_comissao || 0}%
                  </strong>{" "}
                  de comissão por contrato
                </span>
              </div>
              {summary.reserved_cents > 0 && (
                <p className="mt-3 text-xs text-neutral-400">
                  {formatCents(summary.reserved_cents)} estão reservados em uma solicitação ativa.
                </p>
              )}
            </div>
            <Button
              size="lg"
              disabled={action.disabled}
              onClick={() => setRequestOpen(true)}
              className="min-w-52 border border-yellow-400 bg-yellow-400 font-black text-neutral-950 shadow-lg shadow-yellow-400/20 hover:bg-yellow-300 disabled:border-neutral-700 disabled:bg-neutral-800 disabled:text-neutral-500"
            >
              {refreshing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Wallet className="mr-2 h-4 w-4" />
              )}
              {action.label}
            </Button>
          </div>

          <div className="mt-7 border-t border-white/10 pt-5">
            <div className="mb-3 flex items-end justify-between gap-4 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
              <span>Progresso para {level?.proximoNivel?.nome_nivel || "o nível máximo"}</span>
              <span className="text-right text-neutral-300">
                {level?.contratosAtivos || 0}
                {level?.proximoNivel ? ` / ${level.proximoNivel.min_contratos}` : " contratos"}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-yellow-400 transition-all duration-700"
                style={{ width: `${levelProgress(level)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              {level?.proximoNivel
                ? `Faltam ${Math.max(0, level.proximoNivel.min_contratos - level.contratosAtivos)} contratos para ${level.proximoNivel.percentual_comissao}% de comissão.`
                : "Você alcançou o maior nível disponível."}
            </p>
          </div>
        </section>

        <section className="grid gap-5 md:grid-cols-3">
          <SummaryCard
            icon={Clock3}
            iconClass="bg-amber-50 text-amber-600"
            label="Saldo pendente"
            value={formatCents(summary.pending_cents)}
            description="Aguardando a regra financeira"
            action="Ver detalhes"
            onClick={() => setActiveTab("commissions")}
          />
          <SummaryCard
            icon={TrendingUp}
            iconClass="bg-emerald-50 text-emerald-600"
            label="Total acumulado"
            value={formatCents(summary.total_accumulated_cents)}
            description="Histórico real na NOX"
            action="Ver histórico"
            onClick={() => setActiveTab("commissions")}
          />
          <SummaryCard
            icon={Wallet}
            iconClass="bg-purple-50 text-purple-600"
            label="Já sacado"
            value={formatCents(summary.total_withdrawn_cents)}
            description="Somente saques pagos"
            action="Ver saques"
            onClick={() => setActiveTab("withdrawals")}
          />
        </section>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-auto min-h-12 w-full justify-start gap-1 overflow-x-auto overflow-y-hidden rounded-2xl border border-neutral-100 bg-white p-1.5 shadow-sm">
            <TabsTrigger
              value="contracts"
              className="h-10 shrink-0 gap-2 px-4 data-[state=active]:bg-neutral-950 data-[state=active]:text-white"
            >
              <BriefcaseBusiness className="h-4 w-4" /> Contratos ativos
              <Badge variant="secondary" className="ml-1">
                {activeContracts.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="commissions"
              className="h-10 shrink-0 gap-2 px-4 data-[state=active]:bg-neutral-950 data-[state=active]:text-white"
            >
              <Clock3 className="h-4 w-4" /> Histórico de comissões
              <Badge variant="secondary" className="ml-1">
                {commissions.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="withdrawals"
              className="h-10 shrink-0 gap-2 px-4 data-[state=active]:bg-neutral-950 data-[state=active]:text-white"
            >
              <Landmark className="h-4 w-4" /> Meus saques
              <Badge variant="secondary" className="ml-1">
                {withdrawals.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="contracts" className="mt-5">
            <ContractsList contracts={activeContracts} />
          </TabsContent>
          <TabsContent value="commissions" className="mt-5">
            <CommissionsList commissions={commissions} onOpenWithdrawal={setDetailsId} />
          </TabsContent>
          <TabsContent value="withdrawals" className="mt-5">
            <WithdrawalsList withdrawals={withdrawals} onOpen={setDetailsId} />
          </TabsContent>
        </Tabs>
      </div>

      <WithdrawalRequestDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        availableCents={summary.available_cents}
        onSuccess={async () => {
          setActiveTab("withdrawals");
          await load(true);
        }}
      />
      <WithdrawalDetailsDialog
        withdrawalId={detailsId}
        open={Boolean(detailsId)}
        onOpenChange={(open) => !open && setDetailsId(null)}
      />
    </DashboardLayout>
  );
}

function SummaryCard({
  icon: Icon,
  iconClass,
  label,
  value,
  description,
  action,
  onClick,
}: {
  icon: typeof Clock3;
  iconClass: string;
  label: string;
  value: string;
  description: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <Card className="rounded-2xl border-neutral-200 shadow-sm">
      <CardContent className="p-6">
        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${iconClass}`}>
          <Icon className="h-5 w-5" />
        </div>
        <p className="mt-5 text-[10px] font-black uppercase tracking-wider text-neutral-400">
          {label}
        </p>
        <p className="mt-1 text-2xl font-black text-neutral-950">{value}</p>
        <p className="mt-1 text-xs text-neutral-500">{description}</p>
        <button
          className="mt-5 flex w-full items-center justify-between border-t border-neutral-100 pt-4 text-sm font-bold text-neutral-600 hover:text-neutral-950"
          onClick={onClick}
        >
          {action} <ArrowRight className="h-4 w-4" />
        </button>
      </CardContent>
    </Card>
  );
}

function ContractsList({ contracts }: { contracts: CommissionContract[] }) {
  if (contracts.length === 0) {
    return (
      <EmptyState
        icon={BriefcaseBusiness}
        title="Você ainda não possui contratos ativos"
        description="Quando um contrato real for ativado, ele aparecerá aqui com sua situação financeira."
      />
    );
  }
  return (
    <div className="space-y-3">
      {contracts.map((contract) => (
        <article
          key={contract.id}
          className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"
        >
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div className="flex gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-yellow-200 bg-yellow-50 text-yellow-700">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <p className="font-black text-neutral-950">Apólice #{contract.number}</p>
                <p className="mt-0.5 text-sm text-neutral-500">
                  {contract.tenant_name || "Inquilino não informado"}
                </p>
                <p className="mt-1 text-xs text-neutral-400">
                  {new Date(contract.start_date).toLocaleDateString("pt-BR")} →{" "}
                  {new Date(contract.end_date).toLocaleDateString("pt-BR")}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <Badge
                className={financialTone[contract.financial_status] || financialTone.UNDER_REVIEW}
              >
                {FINANCIAL_STATUS_LABELS[contract.financial_status] || "Em análise"}
              </Badge>
              {contract.commission_status && (
                <Badge className={commissionTone[contract.commission_status]}>
                  {COMMISSION_STATUS_LABELS[contract.commission_status]}
                </Badge>
              )}
            </div>
          </div>
          <div className="mt-5 grid gap-3 border-t border-neutral-100 pt-4 sm:grid-cols-2">
            <MiniValue label="Prêmio" value={formatCents(contract.premium_cents)} />
            <MiniValue
              label="Comissão"
              value={
                contract.commission_cents != null
                  ? formatCents(contract.commission_cents)
                  : "Aguardando geração"
              }
            />
          </div>
        </article>
      ))}
    </div>
  );
}

function CommissionsList({
  commissions,
  onOpenWithdrawal,
}: {
  commissions: UserCommission[];
  onOpenWithdrawal: (id: string) => void;
}) {
  if (commissions.length === 0) {
    return (
      <EmptyState
        icon={Clock3}
        title="Nenhuma comissão registrada"
        description="As comissões surgem somente após a ativação real de contratos elegíveis."
      />
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[820px] text-left">
          <thead className="bg-neutral-50 text-[10px] font-black uppercase tracking-wider text-neutral-500">
            <tr>
              <th className="px-5 py-4">Contrato</th>
              <th className="px-5 py-4">Valor-base</th>
              <th className="px-5 py-4">Percentual</th>
              <th className="px-5 py-4">Comissão</th>
              <th className="px-5 py-4">Status</th>
              <th className="px-5 py-4">Data</th>
              <th className="px-5 py-4 text-right">Saque</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {commissions.map((commission) => (
              <tr key={commission.id} className="hover:bg-neutral-50/70">
                <td className="px-5 py-4">
                  <p className="font-bold text-neutral-950">
                    #{commission.contract_number || commission.contract_id.slice(0, 8)}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {commission.tenant_name || "Inquilino"}
                  </p>
                </td>
                <td className="px-5 py-4 text-sm">{formatCents(commission.base_amount_cents)}</td>
                <td className="px-5 py-4 text-sm">
                  {commission.percentage_applied != null
                    ? `${commission.percentage_applied}%`
                    : "—"}
                </td>
                <td className="px-5 py-4 font-black text-neutral-950">
                  {formatCents(commission.amount_cents)}
                </td>
                <td className="px-5 py-4">
                  <Badge className={commissionTone[commission.status]}>
                    {COMMISSION_STATUS_LABELS[commission.status]}
                  </Badge>
                </td>
                <td className="px-5 py-4 text-xs text-neutral-500">
                  {new Date(commission.created_at).toLocaleDateString("pt-BR")}
                </td>
                <td className="px-5 py-4 text-right">
                  {commission.withdrawal_id ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onOpenWithdrawal(commission.withdrawal_id!)}
                    >
                      {commission.receipt_available ? <Receipt className="mr-2 h-4 w-4" /> : null}{" "}
                      Ver saque
                    </Button>
                  ) : (
                    <span className="text-xs text-neutral-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="divide-y md:hidden">
        {commissions.map((commission) => (
          <article key={commission.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-black">
                  Contrato #{commission.contract_number || commission.contract_id.slice(0, 8)}
                </p>
                <p className="text-xs text-neutral-500">
                  {new Date(commission.created_at).toLocaleDateString("pt-BR")}
                </p>
              </div>
              <Badge className={commissionTone[commission.status]}>
                {COMMISSION_STATUS_LABELS[commission.status]}
              </Badge>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <MiniValue label="Valor-base" value={formatCents(commission.base_amount_cents)} />
              <MiniValue label="Comissão" value={formatCents(commission.amount_cents)} />
            </div>
            {commission.withdrawal_id && (
              <Button
                className="mt-3 w-full"
                variant="outline"
                onClick={() => onOpenWithdrawal(commission.withdrawal_id!)}
              >
                Ver saque vinculado
              </Button>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

function WithdrawalsList({
  withdrawals,
  onOpen,
}: {
  withdrawals: UserWithdrawal[];
  onOpen: (id: string) => void;
}) {
  if (withdrawals.length === 0) {
    return (
      <EmptyState
        icon={Landmark}
        title="Nenhuma solicitação de saque encontrada"
        description="Quando houver saldo disponível, sua solicitação aparecerá aqui."
      />
    );
  }
  return (
    <div className="space-y-4">
      {withdrawals.map((withdrawal) => (
        <article
          key={withdrawal.id}
          className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"
        >
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-2xl font-black text-neutral-950">
                  {formatCents(withdrawal.amount_cents)}
                </p>
                <Badge className={withdrawalTone[withdrawal.status]}>
                  {WITHDRAWAL_STATUS_LABELS[withdrawal.status]}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-neutral-500">
                Solicitado em {new Date(withdrawal.requested_at).toLocaleString("pt-BR")}
              </p>
              <p className="mt-2 text-sm font-semibold text-neutral-800">
                {withdrawal.bank_name} · {withdrawal.holder_name}
              </p>
              <p className="mt-0.5 font-mono text-xs text-neutral-500">
                {withdrawal.pix_key_type} · {withdrawal.pix_key_masked}
              </p>
            </div>
            <Button variant="outline" onClick={() => onOpen(withdrawal.id)}>
              {withdrawal.receipt_available && (
                <Receipt className="mr-2 h-4 w-4 text-emerald-600" />
              )}{" "}
              Ver detalhes
            </Button>
          </div>
          <CompactTimeline status={withdrawal.status} />
          {withdrawal.rejection_reason && (
            <p className="mt-4 rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-800">
              <strong>Motivo:</strong> {withdrawal.rejection_reason}
            </p>
          )}
        </article>
      ))}
    </div>
  );
}

function CompactTimeline({ status }: { status: WithdrawalStatus }) {
  const steps =
    status === "REJECTED"
      ? ["Solicitado", "Em análise", "Recusado"]
      : ["Solicitado", "Em análise", "Aprovado", "Aguardando pagamento", "Pago"];
  const activeIndex =
    status === "PENDING_REVIEW"
      ? 1
      : status === "APPROVED" || status === "AWAITING_PAYMENT"
        ? 3
        : status === "PAID"
          ? 4
          : status === "REJECTED"
            ? 2
            : 1;
  return (
    <div className="mt-5 overflow-x-auto pb-1">
      <div className="flex min-w-[520px] items-center">
        {steps.map((step, index) => (
          <div key={step} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-black ${index <= activeIndex ? "border-yellow-400 bg-yellow-400 text-neutral-950" : "border-neutral-200 bg-white text-neutral-400"}`}
              >
                {index < activeIndex ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <span className="mt-1 whitespace-nowrap text-[10px] font-bold text-neutral-500">
                {step}
              </span>
            </div>
            {index < steps.length - 1 && (
              <span
                className={`mx-2 h-px flex-1 ${index < activeIndex ? "bg-yellow-400" : "bg-neutral-200"}`}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-wider text-neutral-400">{label}</p>
      <p className="mt-1 text-sm font-bold text-neutral-900">{value}</p>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Clock3;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-200 bg-white px-6 py-16 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-neutral-50 text-neutral-300">
        <Icon className="h-8 w-8" />
      </div>
      <h3 className="mt-5 text-lg font-black text-neutral-950">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-neutral-500">{description}</p>
    </div>
  );
}

function CommissionSkeleton() {
  return (
    <div className="animate-pulse space-y-7">
      <div className="h-16 w-80 rounded-xl bg-neutral-100" />
      <div className="h-64 rounded-3xl bg-neutral-900" />
      <div className="grid gap-5 md:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="h-44 rounded-2xl bg-neutral-100" />
        ))}
      </div>
      <div className="h-80 rounded-2xl bg-neutral-100" />
    </div>
  );
}

function levelProgress(level: NivelInfo | null) {
  if (!level?.nivelAtual) return 0;
  if (!level.proximoNivel) return 100;
  const start = Number(level.nivelAtual.min_contratos || 0);
  const target = Number(level.proximoNivel.min_contratos || start + 1);
  return Math.max(
    0,
    Math.min(100, ((level.contratosAtivos - start) / Math.max(1, target - start)) * 100),
  );
}
