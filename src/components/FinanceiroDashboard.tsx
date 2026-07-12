import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  Banknote,
  Clock,
  DollarSign,
  Eye,
  FileWarning,
  Receipt,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  type FinanceCommission,
  type FinanceSummary,
  type FinanceWithdrawal,
  formatCents,
  getFinanceSummary,
  listFinanceCommissions,
  listFinanceWithdrawals,
} from "@/lib/withdrawals";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface FinanceInvoice {
  id: string;
  valor: number;
  status: string;
  vencimento: string;
  pago_em: string | null;
  numero_parcela: number;
  apolice_id: string | null;
}

interface DashboardData {
  summary: FinanceSummary;
  invoices: FinanceInvoice[];
  commissions: FinanceCommission[];
  withdrawals: FinanceWithdrawal[];
}

type Priority = {
  kind: "invoice" | "withdrawal" | "commission";
  type: string;
  id: string;
  name: string;
  document: string;
  valueCents: number;
  date: string;
  delayDays: number;
};

const EMPTY_SUMMARY: FinanceSummary = {
  revenue_received_cents: 0,
  revenue_pending_cents: 0,
  commissions_paid_cents: 0,
  commissions_payable_cents: 0,
  open_withdrawals: 0,
  pending_review_withdrawals: 0,
  paid_withdrawals: 0,
  commission_count: 0,
  payment_count: 0,
};

const PAID_INVOICE_STATUSES = new Set(["paid", "pago", "received", "paid_via_consolidated"]);
const CANCELLED_INVOICE_STATUSES = new Set([
  "cancelled",
  "canceled",
  "cancelado",
  "refunded",
  "partially_refunded",
]);
const OPEN_WITHDRAWAL_STATUSES = new Set([
  "PENDING_REVIEW",
  "APPROVED",
  "AWAITING_PAYMENT",
  "MANUAL_REVIEW",
]);

const normalizeStatus = (status: string) => status.trim().toLowerCase();
const isPaidInvoice = (status: string) => PAID_INVOICE_STATUSES.has(normalizeStatus(status));
const isCancelledInvoice = (status: string) =>
  CANCELLED_INVOICE_STATUSES.has(normalizeStatus(status));

const localDateKey = (value: string | Date) => {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
};

const isToday = (iso: string | null) =>
  Boolean(iso && localDateKey(iso) === localDateKey(new Date()));

const isThisMonth = (iso: string | null) => {
  if (!iso) return false;
  const date = new Date(iso);
  const now = new Date();
  return (
    !Number.isNaN(date.getTime()) &&
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth()
  );
};

const isOverdueInvoice = (invoice: FinanceInvoice) =>
  !isPaidInvoice(invoice.status) &&
  !isCancelledInvoice(invoice.status) &&
  localDateKey(invoice.vencimento) < localDateKey(new Date());

const daysOverdue = (iso: string) => {
  const dueDate = new Date(`${localDateKey(iso)}T12:00:00`);
  const today = new Date(`${localDateKey(new Date())}T12:00:00`);
  if (Number.isNaN(dueDate.getTime())) return 0;
  return Math.max(0, Math.floor((today.getTime() - dueDate.getTime()) / 86_400_000));
};

const reaisToCents = (value: number) => Math.round(Number(value || 0) * 100);

const formatDate = (value: string) => {
  const dateOnly = localDateKey(value);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${dateOnly}T12:00:00`)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("pt-BR");
};

export function FinanceiroDashboard() {
  const [data, setData] = useState<DashboardData>({
    summary: EMPTY_SUMMARY,
    invoices: [],
    commissions: [],
    withdrawals: [],
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoaded = useRef(false);
  const requestInFlight = useRef(false);

  const load = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    if (hasLoaded.current) setRefreshing(true);
    else setLoading(true);

    try {
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

      setData({
        summary,
        withdrawals,
        commissions,
        invoices: (invoiceResult.data ?? []) as FinanceInvoice[],
      });
      setError(null);
      hasLoaded.current = true;
    } catch {
      setError(
        hasLoaded.current
          ? "Não foi possível atualizar os dados. Os últimos valores carregados continuam visíveis."
          : "Não foi possível carregar o painel financeiro. Verifique sua conexão e tente novamente.",
      );
    } finally {
      requestInFlight.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();

    const interval = window.setInterval(() => void load(), 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);

    const channel = supabase
      .channel("financeiro-dashboard-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "faturas_inquilino" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "comissoes" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "withdrawal_requests" },
        () => void load(),
      )
      .subscribe();

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const stats = useMemo(() => {
    const receivedTodayCents = data.invoices
      .filter((invoice) => isPaidInvoice(invoice.status) && isToday(invoice.pago_em))
      .reduce((sum, invoice) => sum + reaisToCents(invoice.valor), 0);
    const dueTodayCents = data.invoices
      .filter(
        (invoice) =>
          !isPaidInvoice(invoice.status) &&
          !isCancelledInvoice(invoice.status) &&
          localDateKey(invoice.vencimento) === localDateKey(new Date()),
      )
      .reduce((sum, invoice) => sum + reaisToCents(invoice.valor), 0);
    const overdueInvoices = data.invoices.filter(isOverdueInvoice);
    const overdueCents = overdueInvoices.reduce(
      (sum, invoice) => sum + reaisToCents(invoice.valor),
      0,
    );
    const pendingPaymentCount = data.invoices.filter(
      (invoice) => !isPaidInvoice(invoice.status) && !isCancelledInvoice(invoice.status),
    ).length;
    const receivedThisMonthCents = data.invoices
      .filter((invoice) => isPaidInvoice(invoice.status) && isThisMonth(invoice.pago_em))
      .reduce((sum, invoice) => sum + reaisToCents(invoice.valor), 0);
    const pendingTransferCents = data.withdrawals
      .filter((withdrawal) => OPEN_WITHDRAWAL_STATUSES.has(withdrawal.status))
      .reduce((sum, withdrawal) => sum + withdrawal.net_amount_cents, 0);

    return {
      receivedTodayCents,
      dueTodayCents,
      overdueCents,
      overdueCount: overdueInvoices.length,
      pendingPaymentCount,
      receivedThisMonthCents,
      pendingTransferCents,
    };
  }, [data.invoices, data.withdrawals]);

  const alert = useMemo(() => {
    if (stats.overdueCount > 10) {
      return {
        tone: "critical" as const,
        message: "Alerta grave: há mais de 10 faturas vencidas que precisam de acompanhamento.",
      };
    }
    if (stats.overdueCount > 5) {
      return {
        tone: "strong" as const,
        message: "Alerta: há mais de 5 faturas vencidas. Priorize a conferência da cobrança.",
      };
    }
    if (stats.overdueCount > 0) {
      return {
        tone: "attention" as const,
        message: `${stats.overdueCount} fatura(s) vencida(s) aguardam acompanhamento.`,
      };
    }
    if (data.summary.pending_review_withdrawals > 0) {
      return {
        tone: "attention" as const,
        message: `${data.summary.pending_review_withdrawals} saque(s) aguardam análise financeira.`,
      };
    }
    return { tone: "ok" as const, message: "Fluxo financeiro dentro do controle." };
  }, [data.summary.pending_review_withdrawals, stats.overdueCount]);

  const priorities = useMemo<Priority[]>(() => {
    const overdue: Priority[] = data.invoices
      .filter(isOverdueInvoice)
      .sort(
        (first, second) =>
          new Date(first.vencimento).getTime() - new Date(second.vencimento).getTime(),
      )
      .slice(0, 8)
      .map((invoice) => ({
        kind: "invoice",
        type: "Fatura vencida",
        id: invoice.id,
        name: `Parcela ${invoice.numero_parcela}`,
        document: invoice.apolice_id ? `Apólice ${invoice.apolice_id.slice(0, 8)}` : "Sem apólice",
        valueCents: reaisToCents(invoice.valor),
        date: invoice.vencimento,
        delayDays: daysOverdue(invoice.vencimento),
      }));

    const withdrawals: Priority[] = data.withdrawals
      .filter((withdrawal) => OPEN_WITHDRAWAL_STATUSES.has(withdrawal.status))
      .slice(0, 5)
      .map((withdrawal) => ({
        kind: "withdrawal",
        type:
          withdrawal.status === "AWAITING_PAYMENT"
            ? "Saque a pagar"
            : withdrawal.status === "MANUAL_REVIEW"
              ? "Saque em revisão"
              : "Saque solicitado",
        id: withdrawal.id,
        name: withdrawal.requester_name || withdrawal.requester_email,
        document: `${withdrawal.bank_name} · ${withdrawal.pix_key_masked}`,
        valueCents: withdrawal.net_amount_cents,
        date: withdrawal.requested_at,
        delayDays: 0,
      }));

    const commissions: Priority[] = data.commissions
      .filter(
        (commission) => commission.status === "AVAILABLE" || commission.status === "MANUAL_REVIEW",
      )
      .slice(0, 5)
      .map((commission) => ({
        kind: "commission",
        type: commission.status === "MANUAL_REVIEW" ? "Comissão em revisão" : "Comissão disponível",
        id: commission.id,
        name: commission.user_name || commission.user_email,
        document: commission.contract_number
          ? `Contrato ${commission.contract_number}`
          : "Contrato não informado",
        valueCents: commission.amount_cents,
        date: commission.available_at || commission.created_at,
        delayDays: 0,
      }));

    return [...overdue, ...withdrawals, ...commissions].slice(0, 12);
  }, [data.commissions, data.invoices, data.withdrawals]);

  if (loading && !hasLoaded.current) {
    return <DashboardLoading />;
  }

  if (error && !hasLoaded.current) {
    return <DashboardError message={error} onRetry={() => void load()} />;
  }

  const alertStyle = {
    critical: "bg-red-50 border-red-300 text-red-900",
    strong: "bg-orange-50 border-orange-300 text-orange-900",
    attention: "bg-amber-50 border-amber-200 text-amber-900",
    ok: "bg-emerald-50 border-emerald-200 text-emerald-900",
  }[alert.tone];
  const AlertIcon = alert.tone === "ok" ? ShieldCheck : AlertTriangle;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-neutral-900">
            <Wallet className="text-neutral-900" size={28} strokeWidth={1.5} />
            Painel Financeiro
          </h1>
          <p className="mt-2 font-medium text-neutral-500">
            Acompanhe recebimentos, faturas, comissões e saques com dados atualizados.
          </p>
        </div>
        {refreshing && (
          <Badge variant="outline" className="w-fit gap-2 text-xs text-neutral-500">
            <RefreshCw size={12} className="animate-spin" /> Atualizando
          </Badge>
        )}
      </div>

      {error && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold">{error}</p>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={refreshing}>
            Tentar novamente
          </Button>
        </div>
      )}

      <div className={`flex items-start gap-3 rounded-xl border p-4 ${alertStyle}`}>
        <AlertIcon size={20} className="mt-0.5 shrink-0" />
        <p className="text-sm font-semibold">{alert.message}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Receita recebida"
          value={formatCents(data.summary.revenue_received_cents)}
          Icon={TrendingUp}
          tone="green"
        />
        <StatCard
          label="Receita pendente"
          value={formatCents(data.summary.revenue_pending_cents)}
          Icon={Clock}
          tone="blue"
        />
        <StatCard
          label="Vencidos"
          value={formatCents(stats.overdueCents)}
          Icon={TrendingDown}
          tone="red"
        />
        <StatCard
          label="Pagamentos pendentes"
          value={String(stats.pendingPaymentCount)}
          Icon={Receipt}
          tone="amber"
        />
        <StatCard
          label="Comissões a pagar"
          value={formatCents(data.summary.commissions_payable_cents)}
          Icon={DollarSign}
          tone="neutral"
        />
        <StatCard
          label="Saques em aberto"
          value={String(data.summary.open_withdrawals)}
          Icon={Banknote}
          tone="orange"
        />
        <StatCard
          label="Repasses pendentes"
          value={formatCents(stats.pendingTransferCents)}
          Icon={FileWarning}
          tone="amber"
        />
        <StatCard
          label="Recebido no mês"
          value={formatCents(stats.receivedThisMonthCents)}
          Icon={Activity}
          tone="green"
        />
      </div>

      <section className="rounded-xl border border-neutral-200 bg-white p-6">
        <h2 className="mb-4 text-lg font-bold text-neutral-900">Movimentação financeira</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <MovBar
            label="Recebido hoje"
            valueCents={stats.receivedTodayCents}
            color="bg-emerald-600"
          />
          <MovBar
            label="Recebido no mês"
            valueCents={stats.receivedThisMonthCents}
            color="bg-neutral-900"
          />
          <MovBar label="A receber hoje" valueCents={stats.dueTodayCents} color="bg-blue-600" />
          <MovBar label="Vencidos" valueCents={stats.overdueCents} color="bg-red-600" />
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
        <div className="border-b border-neutral-100 p-6">
          <h2 className="text-lg font-bold text-neutral-900">Prioridades financeiras</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Faturas vencidas mais antigas, saques em aberto e comissões disponíveis.
          </p>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-neutral-50">
              <TableRow>
                <TableHead className="px-6">Tipo</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Atraso</TableHead>
                <TableHead className="pr-6 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!priorities.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-neutral-500">
                    Nenhuma prioridade financeira no momento.
                  </TableCell>
                </TableRow>
              ) : (
                priorities.map((priority) => (
                  <TableRow
                    key={`${priority.kind}-${priority.id}`}
                    className={priority.delayDays > 0 ? "bg-red-50/40" : ""}
                  >
                    <TableCell className="px-6 text-xs font-semibold uppercase text-neutral-600">
                      {priority.type}
                    </TableCell>
                    <TableCell className="font-semibold">{priority.name}</TableCell>
                    <TableCell className="text-xs text-neutral-500">{priority.document}</TableCell>
                    <TableCell className="font-semibold tabular-nums">
                      {formatCents(priority.valueCents)}
                    </TableCell>
                    <TableCell className="text-xs text-neutral-500">
                      {formatDate(priority.date)}
                    </TableCell>
                    <TableCell
                      className={`text-xs font-semibold ${
                        priority.delayDays > 0 ? "text-red-700" : "text-neutral-400"
                      }`}
                    >
                      {priority.delayDays > 0 ? `${priority.delayDays}d` : "—"}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <Link
                        to={
                          priority.kind === "invoice" ? "/admin/faturamento" : "/admin/financeiro"
                        }
                      >
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Ver ${priority.type.toLowerCase()}`}
                        >
                          <Eye size={14} />
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function DashboardLoading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Carregando painel financeiro">
      <div className="h-20 animate-pulse rounded-xl bg-neutral-100" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div
            key={index}
            className="h-36 animate-pulse rounded-xl border border-neutral-100 bg-white"
          />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-xl border border-neutral-100 bg-white" />
    </div>
  );
}

function DashboardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-red-50 text-red-700">
        <AlertTriangle size={22} />
      </div>
      <h1 className="text-xl font-bold text-neutral-900">Painel financeiro indisponível</h1>
      <p className="mx-auto mt-2 max-w-lg text-sm text-neutral-500">{message}</p>
      <Button className="mt-6" onClick={onRetry}>
        <RefreshCw size={16} /> Tentar novamente
      </Button>
    </div>
  );
}

function StatCard({
  label,
  value,
  Icon,
  tone,
}: {
  label: string;
  value: string;
  Icon: LucideIcon;
  tone: "neutral" | "amber" | "blue" | "green" | "red" | "orange";
}) {
  const tones: Record<typeof tone, string> = {
    neutral: "border-neutral-200 bg-neutral-50 text-neutral-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    red: "border-red-200 bg-red-50 text-red-700",
    orange: "border-orange-200 bg-orange-50 text-orange-700",
  };

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 transition-all hover:shadow-md">
      <div className={`mb-4 inline-flex rounded-lg border p-2 ${tones[tone]}`}>
        <Icon size={18} strokeWidth={1.5} />
      </div>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-neutral-400">
        {label}
      </p>
      <h3 className="text-2xl font-bold tabular-nums text-neutral-900">{value}</h3>
    </div>
  );
}

function MovBar({
  label,
  valueCents,
  color,
}: {
  label: string;
  valueCents: number;
  color: string;
}) {
  const percentage = Math.min(100, (valueCents / Math.max(valueCents, 500_000)) * 100);

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-neutral-600">{label}</p>
        <p className="text-sm font-bold tabular-nums text-neutral-900">{formatCents(valueCents)}</p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
