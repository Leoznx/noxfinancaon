import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  FileCheck2,
  History,
  Loader2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  TrendingUp,
  Upload,
  WalletCards,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { WithdrawalDetailsDialog } from "@/components/comissoes/WithdrawalDetailsDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { validateWithdrawalReceiptFile } from "@/lib/withdrawal-pix";
import {
  approveWithdrawal,
  COMMISSION_STATUS_LABELS,
  formatCents,
  getFinanceSummary,
  getWithdrawalReceiptUrl,
  listFinanceCommissions,
  listFinanceWithdrawals,
  markWithdrawalPaid,
  rejectWithdrawal,
  toWithdrawalError,
  WITHDRAWAL_STATUS_LABELS,
  type CommissionStatus,
  type FinanceCommission,
  type FinanceSummary,
  type FinanceWithdrawal,
  type WithdrawalStatus,
} from "@/lib/withdrawals";

export const Route = createFileRoute("/admin/financeiro")({
  component: () => (
    <ProtectedRoute roles={["admin", "admin_master", "financeiro"]} moduleKey="financeiro">
      <FinanceiroAdminPage />
    </ProtectedRoute>
  ),
});

type FinanceFilters = {
  search: string;
  startDate: string;
  endDate: string;
  bank: string;
  paidBy: string;
  userType: string;
  minValue: string;
  maxValue: string;
};

const EMPTY_FILTERS: FinanceFilters = {
  search: "",
  startDate: "",
  endDate: "",
  bank: "",
  paidBy: "",
  userType: "",
  minValue: "",
  maxValue: "",
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

const WITHDRAWAL_TONES: Record<WithdrawalStatus, string> = {
  PENDING_REVIEW: "border-amber-200 bg-amber-50 text-amber-800",
  APPROVED: "border-blue-200 bg-blue-50 text-blue-800",
  AWAITING_PAYMENT: "border-indigo-200 bg-indigo-50 text-indigo-800",
  PAID: "border-emerald-200 bg-emerald-50 text-emerald-800",
  REJECTED: "border-red-200 bg-red-50 text-red-800",
  CANCELLED: "border-neutral-200 bg-neutral-100 text-neutral-700",
  MANUAL_REVIEW: "border-orange-200 bg-orange-50 text-orange-800",
};

const COMMISSION_TONES: Record<CommissionStatus, string> = {
  PENDING: "border-amber-200 bg-amber-50 text-amber-800",
  AVAILABLE: "border-emerald-200 bg-emerald-50 text-emerald-800",
  RESERVED: "border-indigo-200 bg-indigo-50 text-indigo-800",
  PAID: "border-emerald-200 bg-emerald-100 text-emerald-900",
  REVERSED: "border-red-200 bg-red-50 text-red-800",
  MANUAL_REVIEW: "border-orange-200 bg-orange-50 text-orange-800",
};

const REJECTION_REASONS = [
  "Dados Pix incorretos",
  "Titular divergente",
  "Contrato com pendência",
  "Comissão em revisão",
  "Solicitação duplicada",
  "Outro",
] as const;

const dateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString("pt-BR") : "—";

function currencyInputToCents(value: string) {
  if (!value.trim()) return undefined;
  const amount = Number(value.replace(",", "."));
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : undefined;
}

function withdrawalParams(filters: FinanceFilters) {
  return {
    search: filters.search.trim() || undefined,
    startDate: filters.startDate || undefined,
    endDate: filters.endDate || undefined,
    bank: filters.bank.trim() || undefined,
    paidBy: filters.paidBy || undefined,
    userType: filters.userType || undefined,
    minCents: currencyInputToCents(filters.minValue),
    maxCents: currencyInputToCents(filters.maxValue),
  };
}

function FinanceiroAdminPage() {
  const [summary, setSummary] = useState<FinanceSummary>(EMPTY_SUMMARY);
  const [openWithdrawals, setOpenWithdrawals] = useState<FinanceWithdrawal[]>([]);
  const [payments, setPayments] = useState<FinanceWithdrawal[]>([]);
  const [commissions, setCommissions] = useState<FinanceCommission[]>([]);
  const [draftFilters, setDraftFilters] = useState<FinanceFilters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<FinanceFilters>(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [approveTarget, setApproveTarget] = useState<FinanceWithdrawal | null>(null);
  const [rejectTarget, setRejectTarget] = useState<FinanceWithdrawal | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<FinanceWithdrawal | null>(null);

  const loadData = useCallback(async (activeFilters: FinanceFilters, quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const params = withdrawalParams(activeFilters);
      const [nextSummary, nextOpen, nextPayments, nextCommissions] = await Promise.all([
        getFinanceSummary(),
        listFinanceWithdrawals({ ...params, scope: "OPEN" }),
        listFinanceWithdrawals({ ...params, scope: "PAID" }),
        listFinanceCommissions(),
      ]);
      setSummary(nextSummary);
      setOpenWithdrawals(nextOpen);
      setPayments(nextPayments);
      setCommissions(nextCommissions);
    } catch (loadError) {
      const message = toWithdrawalError(loadError).message;
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData(filters);
  }, [filters, loadData]);

  useEffect(() => {
    const channel = supabase
      .channel("finance-withdrawals-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "withdrawal_requests" },
        () => void loadData(filters, true),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "comissoes" },
        () => void loadData(filters, true),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [filters, loadData]);

  const payerOptions = useMemo(() => {
    const values = new Map<string, string>();
    payments.forEach((payment) => {
      if (payment.paid_by) values.set(payment.paid_by, payment.paid_by_name || payment.paid_by);
    });
    return Array.from(values, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR"),
    );
  }, [payments]);

  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    const min = currencyInputToCents(draftFilters.minValue);
    const max = currencyInputToCents(draftFilters.maxValue);
    if (min != null && max != null && min > max) {
      toast.error("O valor mínimo não pode ser maior que o valor máximo.");
      return;
    }
    if (
      draftFilters.startDate &&
      draftFilters.endDate &&
      draftFilters.startDate > draftFilters.endDate
    ) {
      toast.error("A data inicial não pode ser posterior à data final.");
      return;
    }
    setFilters({ ...draftFilters });
  };

  const clearFilters = () => {
    setDraftFilters(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
  };

  return (
    <DashboardLayout>
      <div className="space-y-7 pb-10">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-yellow-600">
              Operação financeira
            </p>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-neutral-950">Financeiro</h1>
            <p className="mt-2 text-sm text-neutral-500">
              Saques manuais, comissões e comprovantes com dados reais e trilha auditável.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void loadData(filters, true)}
            disabled={loading || refreshing}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </header>

        <SummaryGrid summary={summary} loading={loading} />

        <FilterPanel
          filters={draftFilters}
          onChange={setDraftFilters}
          payerOptions={payerOptions}
          loading={loading}
          onSubmit={applyFilters}
          onClear={clearFilters}
        />

        {error && !loading && (
          <div className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-bold">Os dados financeiros não puderam ser carregados.</p>
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </div>
            <Button variant="outline" onClick={() => void loadData(filters)}>
              Tentar novamente
            </Button>
          </div>
        )}

        <Tabs defaultValue="withdrawals" className="space-y-5">
          <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-sm">
            <FinanceTab
              value="withdrawals"
              icon={Banknote}
              label="Saques"
              count={summary.open_withdrawals}
            />
            <FinanceTab
              value="commissions"
              icon={WalletCards}
              label="Comissões"
              count={summary.commission_count}
            />
            <FinanceTab
              value="payments"
              icon={History}
              label="Pagamentos"
              count={summary.paid_withdrawals}
            />
          </TabsList>

          <TabsContent value="withdrawals">
            <WithdrawalsTable
              rows={openWithdrawals}
              loading={loading}
              onDetails={setDetailsId}
              onApprove={setApproveTarget}
              onReject={setRejectTarget}
              onPay={setPaymentTarget}
            />
          </TabsContent>

          <TabsContent value="commissions">
            <CommissionsTable rows={commissions} loading={loading} onWithdrawal={setDetailsId} />
          </TabsContent>

          <TabsContent value="payments">
            <PaymentsTable rows={payments} loading={loading} onDetails={setDetailsId} />
          </TabsContent>
        </Tabs>
      </div>

      <WithdrawalDetailsDialog
        withdrawalId={detailsId}
        open={Boolean(detailsId)}
        onOpenChange={(open) => !open && setDetailsId(null)}
        manager
      />
      <ApproveDialog
        target={approveTarget}
        onClose={() => setApproveTarget(null)}
        onCompleted={() => loadData(filters, true)}
      />
      <RejectDialog
        target={rejectTarget}
        onClose={() => setRejectTarget(null)}
        onCompleted={() => loadData(filters, true)}
      />
      <PaymentDialog
        target={paymentTarget}
        onClose={() => setPaymentTarget(null)}
        onCompleted={() => loadData(filters, true)}
      />
    </DashboardLayout>
  );
}

function SummaryGrid({ summary, loading }: { summary: FinanceSummary; loading: boolean }) {
  const cards = [
    {
      icon: TrendingUp,
      label: "Faturamento recebido",
      value: formatCents(summary.revenue_received_cents),
      detail: `${summary.payment_count} pagamento(s) efetivamente recebido(s)`,
      tone: "bg-emerald-50 text-emerald-700",
    },
    {
      icon: History,
      label: "Faturamento a receber",
      value: formatCents(summary.revenue_pending_cents),
      detail: "Cobranças ainda pendentes nos gateways",
      tone: "bg-amber-50 text-amber-700",
    },
    {
      icon: CheckCircle2,
      label: "Comissões pagas",
      value: formatCents(summary.commissions_paid_cents),
      detail: `${summary.paid_withdrawals} saque(s) com pagamento confirmado`,
      tone: "bg-violet-50 text-violet-700",
    },
    {
      icon: WalletCards,
      label: "Comissões a pagar",
      value: formatCents(summary.commissions_payable_cents),
      detail: "Disponíveis mais reservas ainda não pagas",
      tone: "bg-yellow-50 text-yellow-700",
    },
  ];

  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label} className="rounded-2xl border-neutral-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-wider text-neutral-400">
                  {card.label}
                </p>
                <p className="mt-2 truncate text-2xl font-black text-neutral-950">
                  {loading ? "—" : card.value}
                </p>
              </div>
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${card.tone}`}
              >
                <card.icon className="h-5 w-5" />
              </div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-neutral-500">{card.detail}</p>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

function FilterPanel({
  filters,
  onChange,
  payerOptions,
  loading,
  onSubmit,
  onClear,
}: {
  filters: FinanceFilters;
  onChange: (filters: FinanceFilters) => void;
  payerOptions: Array<{ id: string; name: string }>;
  loading: boolean;
  onSubmit: (event: FormEvent) => void;
  onClear: () => void;
}) {
  const set = (key: keyof FinanceFilters, value: string) => onChange({ ...filters, [key]: value });

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm sm:p-5"
    >
      <div className="mb-4 flex items-center gap-2">
        <SlidersHorizontal className="h-4 w-4 text-yellow-600" />
        <h2 className="font-black text-neutral-950">Filtros financeiros</h2>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="md:col-span-2">
          <Label htmlFor="finance-search">Busca</Label>
          <div className="relative mt-1.5">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <Input
              id="finance-search"
              value={filters.search}
              onChange={(event) => set("search", event.target.value)}
              className="pl-9"
              placeholder="Nome, e-mail, contrato ou chave Pix"
            />
          </div>
        </div>
        <Field label="Data inicial" id="finance-start">
          <Input
            id="finance-start"
            type="date"
            value={filters.startDate}
            onChange={(event) => set("startDate", event.target.value)}
          />
        </Field>
        <Field label="Data final" id="finance-end">
          <Input
            id="finance-end"
            type="date"
            value={filters.endDate}
            onChange={(event) => set("endDate", event.target.value)}
          />
        </Field>
        <Field label="Banco" id="finance-bank">
          <Input
            id="finance-bank"
            value={filters.bank}
            onChange={(event) => set("bank", event.target.value)}
            placeholder="Ex.: Nubank"
          />
        </Field>
        <div>
          <Label>Responsável pelo pagamento</Label>
          <Select
            value={filters.paidBy || "all"}
            onValueChange={(value) => set("paidBy", value === "all" ? "" : value)}
          >
            <SelectTrigger className="mt-1.5">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {payerOptions.map((payer) => (
                <SelectItem key={payer.id} value={payer.id}>
                  {payer.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Tipo de usuário</Label>
          <Select
            value={filters.userType || "all"}
            onValueChange={(value) => set("userType", value === "all" ? "" : value)}
          >
            <SelectTrigger className="mt-1.5">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="corretor">Corretor</SelectItem>
              <SelectItem value="imobiliaria">Imobiliária</SelectItem>
              <SelectItem value="proprietario">Proprietário</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor mínimo" id="finance-min">
            <Input
              id="finance-min"
              type="number"
              min="0"
              step="0.01"
              value={filters.minValue}
              onChange={(event) => set("minValue", event.target.value)}
              placeholder="0,00"
            />
          </Field>
          <Field label="Valor máximo" id="finance-max">
            <Input
              id="finance-max"
              type="number"
              min="0"
              step="0.01"
              value={filters.maxValue}
              onChange={(event) => set("maxValue", event.target.value)}
              placeholder="0,00"
            />
          </Field>
        </div>
      </div>
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onClear} disabled={loading}>
          Limpar filtros
        </Button>
        <Button
          type="submit"
          className="bg-neutral-950 text-white hover:bg-neutral-800"
          disabled={loading}
        >
          <Search className="mr-2 h-4 w-4" /> Aplicar filtros
        </Button>
      </div>
    </form>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function FinanceTab({
  value,
  icon: Icon,
  label,
  count,
}: {
  value: string;
  icon: LucideIcon;
  label: string;
  count: number;
}) {
  return (
    <TabsTrigger
      value={value}
      className="min-w-max gap-2 rounded-xl px-4 py-2.5 data-[state=active]:bg-neutral-950 data-[state=active]:text-white"
    >
      <Icon className="h-4 w-4" /> {label}
      <Badge className="ml-1 border-0 bg-yellow-400 px-1.5 text-neutral-950 hover:bg-yellow-400">
        {count}
      </Badge>
    </TabsTrigger>
  );
}

function WithdrawalsTable({
  rows,
  loading,
  onDetails,
  onApprove,
  onReject,
  onPay,
}: {
  rows: FinanceWithdrawal[];
  loading: boolean;
  onDetails: (id: string) => void;
  onApprove: (row: FinanceWithdrawal) => void;
  onReject: (row: FinanceWithdrawal) => void;
  onPay: (row: FinanceWithdrawal) => void;
}) {
  return (
    <DataTable
      title="Solicitações em acompanhamento"
      description="Saques não pagos que exigem análise ou pagamento."
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">Solicitante</TableHead>
            <TableHead>Valor</TableHead>
            <TableHead>Valor líquido</TableHead>
            <TableHead>Pix</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Data</TableHead>
            <TableHead className="pr-5 text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <EmptyRow columns={7} loading />
          ) : rows.length === 0 ? (
            <EmptyRow columns={7}>Nenhuma solicitação de saque encontrada.</EmptyRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="pl-5">
                  <PersonCell name={row.requester_name} secondary={row.requester_email} />
                </TableCell>
                <TableCell className="font-bold">{formatCents(row.amount_cents)}</TableCell>
                <TableCell>{formatCents(row.net_amount_cents)}</TableCell>
                <TableCell>
                  <PixCell row={row} />
                </TableCell>
                <TableCell>
                  <WithdrawalBadge status={row.status} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm text-neutral-600">
                  {dateTime(row.requested_at)}
                </TableCell>
                <TableCell className="pr-5">
                  <div className="flex min-w-max justify-end gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => onDetails(row.id)}>
                      <Eye className="mr-1.5 h-4 w-4" />
                      Detalhes
                    </Button>
                    {(
                      ["PENDING_REVIEW", "APPROVED", "MANUAL_REVIEW"] as WithdrawalStatus[]
                    ).includes(row.status) && (
                      <Button
                        size="sm"
                        className="bg-emerald-700 hover:bg-emerald-800"
                        onClick={() => onApprove(row)}
                      >
                        <CheckCircle2 className="mr-1.5 h-4 w-4" />
                        Aprovar
                      </Button>
                    )}
                    {!(["PAID", "REJECTED", "CANCELLED"] as WithdrawalStatus[]).includes(
                      row.status,
                    ) && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-200 text-red-700 hover:bg-red-50"
                        onClick={() => onReject(row)}
                      >
                        <XCircle className="mr-1.5 h-4 w-4" />
                        Recusar
                      </Button>
                    )}
                    {row.status === "AWAITING_PAYMENT" && (
                      <Button
                        size="sm"
                        className="bg-yellow-400 font-bold text-neutral-950 hover:bg-yellow-300"
                        onClick={() => onPay(row)}
                      >
                        <FileCheck2 className="mr-1.5 h-4 w-4" />
                        Marcar como pago
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </DataTable>
  );
}

function CommissionsTable({
  rows,
  loading,
  onWithdrawal,
}: {
  rows: FinanceCommission[];
  loading: boolean;
  onWithdrawal: (id: string) => void;
}) {
  return (
    <DataTable
      title="Comissões reais"
      description="Valores gerados pelo backend e vinculados aos contratos de origem."
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">Usuário</TableHead>
            <TableHead>Contrato</TableHead>
            <TableHead>Valor-base</TableHead>
            <TableHead>Percentual</TableHead>
            <TableHead>Comissão</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Disponível em</TableHead>
            <TableHead className="pr-5">Saque vinculado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <EmptyRow columns={8} loading />
          ) : rows.length === 0 ? (
            <EmptyRow columns={8}>Nenhuma comissão registrada.</EmptyRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="pl-5">
                  <PersonCell name={row.user_name} secondary={row.user_email} />
                </TableCell>
                <TableCell>
                  <a
                    className="inline-flex items-center gap-1 font-bold text-neutral-900 hover:underline"
                    href={`/apolices/${row.contract_id}`}
                  >
                    {row.contract_number || row.contract_id.slice(0, 8)}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </TableCell>
                <TableCell>{formatCents(row.base_amount_cents)}</TableCell>
                <TableCell>
                  {row.percentage_applied == null ? "—" : `${row.percentage_applied}%`}
                </TableCell>
                <TableCell className="font-bold">{formatCents(row.amount_cents)}</TableCell>
                <TableCell>
                  <Badge className={COMMISSION_TONES[row.status]}>
                    {COMMISSION_STATUS_LABELS[row.status]}
                  </Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {dateTime(row.available_at)}
                </TableCell>
                <TableCell className="pr-5">
                  {row.withdrawal_id ? (
                    <Button
                      variant="link"
                      className="h-auto p-0 font-bold text-neutral-900"
                      onClick={() => onWithdrawal(row.withdrawal_id!)}
                    >
                      Abrir saque
                    </Button>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </DataTable>
  );
}

function PaymentsTable({
  rows,
  loading,
  onDetails,
}: {
  rows: FinanceWithdrawal[];
  loading: boolean;
  onDetails: (id: string) => void;
}) {
  const openReceipt = async (row: FinanceWithdrawal, accessType: "view" | "download") => {
    const popup = window.open("", "_blank");
    try {
      const url = await getWithdrawalReceiptUrl(row.id, accessType);
      if (popup) popup.location.href = url;
      else window.location.assign(url);
    } catch (error) {
      popup?.close();
      toast.error(toWithdrawalError(error).message);
    }
  };

  return (
    <DataTable
      title="Pagamentos realizados"
      description="Saques pagos manualmente, com responsável e comprovante privado."
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">Solicitante</TableHead>
            <TableHead>Valor pago</TableHead>
            <TableHead>Banco</TableHead>
            <TableHead>Pix</TableHead>
            <TableHead>Pago em</TableHead>
            <TableHead>Responsável</TableHead>
            <TableHead>Comprovante</TableHead>
            <TableHead className="pr-5 text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <EmptyRow columns={8} loading />
          ) : rows.length === 0 ? (
            <EmptyRow columns={8}>Nenhum pagamento de comissão registrado.</EmptyRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="pl-5">
                  <PersonCell name={row.requester_name} secondary={row.requester_email} />
                </TableCell>
                <TableCell className="font-bold text-emerald-700">
                  {formatCents(row.net_amount_cents)}
                </TableCell>
                <TableCell>{row.bank_name}</TableCell>
                <TableCell>
                  <PixCell row={row} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">{dateTime(row.paid_at)}</TableCell>
                <TableCell>{row.paid_by_name || "—"}</TableCell>
                <TableCell>
                  {row.receipt_available ? (
                    <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800">
                      <FileCheck2 className="mr-1 h-3 w-3" />
                      Disponível
                    </Badge>
                  ) : (
                    <Badge variant="destructive">Ausente</Badge>
                  )}
                </TableCell>
                <TableCell className="pr-5">
                  <div className="flex min-w-max justify-end gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => onDetails(row.id)}>
                      <Eye className="mr-1.5 h-4 w-4" />
                      Detalhes
                    </Button>
                    {row.receipt_available && (
                      <>
                        <Button
                          size="icon"
                          variant="outline"
                          aria-label="Visualizar comprovante"
                          onClick={() => void openReceipt(row, "view")}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="outline"
                          aria-label="Baixar comprovante"
                          onClick={() => void openReceipt(row, "download")}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </DataTable>
  );
}

function DataTable({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <div className="border-b border-neutral-100 px-5 py-4">
        <h2 className="font-black text-neutral-950">{title}</h2>
        <p className="mt-1 text-sm text-neutral-500">{description}</p>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

function EmptyRow({
  columns,
  loading = false,
  children,
}: {
  columns: number;
  loading?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <TableRow>
      <TableCell colSpan={columns} className="h-44 text-center text-neutral-500">
        {loading ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando dados reais...
          </span>
        ) : (
          children
        )}
      </TableCell>
    </TableRow>
  );
}

function PersonCell({ name, secondary }: { name: string; secondary: string }) {
  return (
    <div className="min-w-44">
      <p className="font-bold text-neutral-950">{name || "—"}</p>
      <p className="truncate text-xs text-neutral-500">{secondary}</p>
    </div>
  );
}

function PixCell({ row }: { row: FinanceWithdrawal }) {
  return (
    <div className="min-w-36">
      <p className="text-xs font-bold uppercase text-neutral-400">{row.pix_key_type}</p>
      <p className="font-mono text-xs text-neutral-700">{row.pix_key_masked}</p>
    </div>
  );
}

function WithdrawalBadge({ status }: { status: WithdrawalStatus }) {
  return <Badge className={WITHDRAWAL_TONES[status]}>{WITHDRAWAL_STATUS_LABELS[status]}</Badge>;
}

function ApproveDialog({
  target,
  onClose,
  onCompleted,
}: {
  target: FinanceWithdrawal | null;
  onClose: () => void;
  onCompleted: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const approve = async () => {
    if (!target || submitting) return;
    setSubmitting(true);
    try {
      const result = await approveWithdrawal(target.id);
      if (!result.ok) {
        if (result.code === "CONTRACT_REVIEW_REQUIRED")
          toast.error(
            "Um ou mais contratos possuem pendências. O saque foi enviado para revisão manual.",
          );
        else toast.error("O status atual não permite aprovar esta solicitação.");
        await onCompleted();
        onClose();
        return;
      }
      toast.success("Saque aprovado e encaminhado para pagamento manual.");
      onClose();
      await onCompleted();
    } catch (error) {
      toast.error(toWithdrawalError(error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent className="max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle>Confirmar aprovação do saque</DialogTitle>
          <DialogDescription>
            A aprovação reserva o valor, mas não confirma o pagamento.
          </DialogDescription>
        </DialogHeader>
        {target && (
          <div className="space-y-4">
            <div className="rounded-xl bg-neutral-950 p-4 text-white">
              <p className="text-xs font-bold uppercase text-yellow-400">
                Valor para pagamento manual
              </p>
              <p className="mt-1 text-3xl font-black">{formatCents(target.net_amount_cents)}</p>
            </div>
            <dl className="grid gap-3 rounded-xl border p-4 text-sm sm:grid-cols-2">
              <Info label="Solicitante" value={target.requester_name} />
              <Info label="Banco" value={target.bank_name} />
              <Info label="Titular" value={target.holder_name} />
              <Info label="Chave Pix" value={`${target.pix_key_type} · ${target.pix_key_masked}`} />
              <Info label="Contratos" value={String(target.contract_count)} />
            </dl>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            className="bg-emerald-700 hover:bg-emerald-800"
            onClick={() => void approve()}
            disabled={submitting}
          >
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            Confirmar aprovação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({
  target,
  onClose,
  onCompleted,
}: {
  target: FinanceWithdrawal | null;
  onClose: () => void;
  onCompleted: () => Promise<void>;
}) {
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (target) {
      setCategory("");
      setDescription("");
      setSubmitting(false);
    }
  }, [target]);
  const reject = async () => {
    if (!target || submitting) return;
    if (!category) {
      toast.error("Selecione o motivo da recusa.");
      return;
    }
    if (category === "Outro" && description.trim().length < 3) {
      toast.error("Descreva o motivo da recusa.");
      return;
    }
    const reason = description.trim() ? `${category}: ${description.trim()}` : category;
    setSubmitting(true);
    try {
      const result = await rejectWithdrawal(target.id, reason);
      if (!result.ok) {
        toast.error("O status atual não permite recusar esta solicitação.");
        await onCompleted();
        onClose();
        return;
      }
      toast.success("Saque recusado. O saldo reservado foi liberado.");
      onClose();
      await onCompleted();
    } catch (error) {
      toast.error(toWithdrawalError(error).message);
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent className="max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle>Recusar solicitação</DialogTitle>
          <DialogDescription>
            O motivo será exibido ao solicitante e o saldo reservado será liberado pelo servidor.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Motivo obrigatório</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder="Selecione um motivo" />
              </SelectTrigger>
              <SelectContent>
                {REJECTION_REASONS.map((reason) => (
                  <SelectItem key={reason} value={reason}>
                    {reason}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="rejection-description">
              Descrição complementar {category === "Outro" ? "(obrigatória)" : "(opcional)"}
            </Label>
            <Textarea
              id="rejection-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="mt-1.5 min-h-24"
              maxLength={700}
              placeholder="Contexto seguro para o usuário e para a auditoria"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={() => void reject()} disabled={submitting}>
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <XCircle className="mr-2 h-4 w-4" />
            )}
            Confirmar recusa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({
  target,
  onClose,
  onCompleted,
}: {
  target: FinanceWithdrawal | null;
  onClose: () => void;
  onCompleted: () => Promise<void>;
}) {
  const [receipt, setReceipt] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (target) {
      setReceipt(null);
      setNotes("");
      setConfirmed(false);
      setFileError(null);
      setSubmitting(false);
    }
  }, [target]);
  const selectReceipt = (file: File | null) => {
    const validation = validateWithdrawalReceiptFile(file);
    if (!validation.valid) {
      setReceipt(null);
      setFileError(validation.error);
      return;
    }
    setReceipt(file);
    setFileError(null);
  };
  const pay = async () => {
    if (!target || submitting) return;
    const validation = validateWithdrawalReceiptFile(receipt);
    if (!validation.valid) {
      setFileError(validation.error);
      return;
    }
    if (!confirmed) {
      toast.error("Confirme que o pagamento foi realizado.");
      return;
    }
    setSubmitting(true);
    try {
      await markWithdrawalPaid({ withdrawalId: target.id, receipt: receipt!, paymentNotes: notes });
      toast.success("Pagamento confirmado. O comprovante já está disponível para o usuário.");
      onClose();
      await onCompleted();
    } catch (error) {
      toast.error(toWithdrawalError(error).message);
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-xl overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>Confirmar pagamento do saque</DialogTitle>
          <DialogDescription>
            Use este fluxo somente depois de realizar o Pix manualmente no banco da empresa.
          </DialogDescription>
        </DialogHeader>
        {target && (
          <div className="space-y-5">
            <div className="rounded-xl bg-neutral-950 p-4 text-white">
              <p className="text-xs font-bold uppercase text-yellow-400">Valor exato pago</p>
              <p className="mt-1 text-3xl font-black">{formatCents(target.net_amount_cents)}</p>
            </div>
            <dl className="grid gap-3 rounded-xl border p-4 text-sm sm:grid-cols-2">
              <Info label="Solicitante" value={target.requester_name} />
              <Info label="Solicitado em" value={dateTime(target.requested_at)} />
              <Info label="Banco" value={target.bank_name} />
              <Info label="Titular" value={target.holder_name} />
              <Info label="Chave Pix" value={`${target.pix_key_type} · ${target.pix_key_masked}`} />
              <Info label="Contratos" value={String(target.contract_count)} />
            </dl>
            <div>
              <Label htmlFor="payment-receipt">Anexar comprovante de pagamento *</Label>
              <label
                htmlFor="payment-receipt"
                className={`mt-1.5 flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed p-6 text-center transition ${fileError ? "border-red-300 bg-red-50" : "border-neutral-200 hover:border-yellow-400 hover:bg-yellow-50"}`}
              >
                <Upload className="mb-2 h-6 w-6 text-neutral-500" />
                <span className="font-bold text-neutral-900">
                  {receipt ? receipt.name : "Selecionar PDF ou imagem"}
                </span>
                <span className="mt-1 text-xs text-neutral-500">
                  PDF, JPG, JPEG, PNG ou WEBP · máximo 10 MB
                </span>
                <Input
                  id="payment-receipt"
                  type="file"
                  className="sr-only"
                  accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp"
                  disabled={submitting}
                  onChange={(event) => selectReceipt(event.target.files?.[0] ?? null)}
                />
              </label>
              {fileError && (
                <p className="mt-1.5 text-xs font-medium text-red-600" role="alert">
                  {fileError}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="payment-notes">Observação do pagamento (opcional)</Label>
              <Textarea
                id="payment-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                maxLength={1000}
                className="mt-1.5"
                placeholder="Ex.: comprovante conferido no internet banking"
              />
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
              <Checkbox
                checked={confirmed}
                onCheckedChange={(value) => setConfirmed(value === true)}
                disabled={submitting}
                className="mt-0.5"
              />
              <span className="text-sm font-medium leading-relaxed text-neutral-700">
                Confirmo que o pagamento foi realizado para os dados informados nesta solicitação.
              </span>
            </label>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            className="bg-yellow-400 font-bold text-neutral-950 hover:bg-yellow-300"
            onClick={() => void pay()}
            disabled={submitting || !receipt || !confirmed}
          >
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileCheck2 className="mr-2 h-4 w-4" />
            )}
            Confirmar pagamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-black uppercase tracking-wider text-neutral-400">{label}</dt>
      <dd className="mt-1 break-words font-semibold text-neutral-900">{value || "—"}</dd>
    </div>
  );
}
