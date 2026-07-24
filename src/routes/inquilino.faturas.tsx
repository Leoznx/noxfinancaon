import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  Copy,
  CreditCard,
  FileText,
  Landmark,
  QrCode,
  Receipt,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/AuthProvider";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { isPagamentoConcluido, MESES_PT, statusPagamentoLabel } from "@/lib/asaas-payment";
import {
  AGENCY_BILLING_MESSAGE,
  mergeTenantBillingItems,
  tenantBillingMethodLabel,
  type TenantBillingConsultation,
  type TenantBillingItem,
  type TenantInvoiceSource,
  type TenantPaymentSource,
} from "@/lib/tenant-billing";

export const Route = createFileRoute("/inquilino/faturas")({
  component: () => (
    <ProtectedRoute roles={["inquilino"]}>
      <FaturasInquilino />
    </ProtectedRoute>
  ),
});

const STATUS_ABERTO = ["pending", "overdue", "risk_analysis", "approved"];

const STATUS_CLASS: Record<string, string> = {
  paid: "bg-emerald-100 text-emerald-700 border-emerald-200",
  confirmed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  paid_via_consolidated: "bg-emerald-100 text-emerald-700 border-emerald-200",
  overdue: "bg-red-100 text-red-700 border-red-200",
  cancelled: "bg-neutral-100 text-neutral-700 border-neutral-200",
  refunded: "bg-neutral-100 text-neutral-700 border-neutral-200",
  partially_refunded: "bg-neutral-100 text-neutral-700 border-neutral-200",
  chargeback: "bg-red-100 text-red-700 border-red-200",
  chargeback_dispute: "bg-red-100 text-red-700 border-red-200",
  refused: "bg-red-100 text-red-700 border-red-200",
};

type BillingContract = TenantBillingConsultation & {
  items: TenantBillingItem[];
};

const brl = (value: number) =>
  `R$ ${Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

function statusInfo(item: TenantBillingItem, actionableId?: string) {
  if (item.status === "pending" && item.id !== actionableId) {
    return {
      label: "Agendada",
      cls: "bg-slate-100 text-slate-600 border-slate-200",
    };
  }
  return {
    label: statusPagamentoLabel(item.status),
    cls: STATUS_CLASS[item.status] || "bg-amber-100 text-amber-700 border-amber-200",
  };
}

function FaturasInquilino() {
  const { user } = useAuth();
  const [consultations, setConsultations] = useState<TenantBillingConsultation[]>([]);
  const [items, setItems] = useState<TenantBillingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const loadBilling = useCallback(async () => {
    if (!user?.id) return;
    setErrorMessage(null);

    try {
      const consultationSelect =
        "id, payment_type, insurance_payment_method, imovel:imoveis(endereco, cidade, estado), plano:planos(nome)";
      const [byUser, byEmail] = await Promise.all([
        supabase
          .from("consultas_credito")
          .select(consultationSelect)
          .eq("tenant_user_id", user.id),
        user.email
          ? supabase
              .from("consultas_credito")
              .select(consultationSelect)
              .ilike("tenant_email", user.email)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (byUser.error) throw byUser.error;
      if (byEmail.error) throw byEmail.error;

      const uniqueConsultations = Array.from(
        new Map(
          [...(byUser.data ?? []), ...(byEmail.data ?? [])].map((item: any) => [
            item.id,
            item,
          ]),
        ).values(),
      ) as TenantBillingConsultation[];
      setConsultations(uniqueConsultations);

      const consultationIds = uniqueConsultations.map((item) => item.id);
      if (!consultationIds.length) {
        setItems([]);
        return;
      }

      const [invoiceResult, paymentResult] = await Promise.all([
        supabase
          .from("faturas_inquilino")
          .select(
            "id, consulta_id, asaas_payment_id, numero_parcela, installment_total, vencimento, valor, status, pago_em, boleto_url, linha_digitavel",
          )
          .in("consulta_id", consultationIds),
        (supabase as any)
          .from("asaas_payments")
          .select(
            "id, consultation_id, asaas_payment_id, payment_method, status, value, due_date, confirmed_at, received_at, pix_qr_code, pix_copy_paste, pix_expires_at, boleto_url, boleto_barcode, external_reference",
          )
          .in("consultation_id", consultationIds),
      ]);
      if (invoiceResult.error) throw invoiceResult.error;
      if (paymentResult.error) throw paymentResult.error;

      setItems(
        mergeTenantBillingItems(
          uniqueConsultations,
          (invoiceResult.data ?? []) as unknown as TenantInvoiceSource[],
          (paymentResult.data ?? []) as unknown as TenantPaymentSource[],
        ),
      );
    } catch (error) {
      setConsultations([]);
      setItems([]);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível carregar suas faturas agora.",
      );
    }
  }, [user?.email, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    loadBilling().finally(() => setLoading(false));

    const channel = supabase
      .channel(`tenant-billing-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "faturas_inquilino",
          filter: `tenant_user_id=eq.${user.id}`,
        },
        loadBilling,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "asaas_payments",
          filter: `tenant_user_id=eq.${user.id}`,
        },
        loadBilling,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadBilling, user?.id]);

  const contracts = useMemo<BillingContract[]>(
    () =>
      consultations.map((consultation) => ({
        ...consultation,
        items: items.filter((item) => item.consultationId === consultation.id),
      })),
    [consultations, items],
  );

  const tenantItems = useMemo(
    () => items.filter((item) => contracts.some(
      (contract) =>
        contract.id === item.consultationId && contract.payment_type !== "imobiliaria",
    )),
    [contracts, items],
  );

  const actionableByContract = useMemo(() => {
    const result = new Map<string, string>();
    for (const contract of contracts) {
      const actionable = contract.items
        .filter((item) => STATUS_ABERTO.includes(item.status))
        .sort(
          (a, b) =>
            new Date(a.dueDate || "9999-12-31").getTime() -
            new Date(b.dueDate || "9999-12-31").getTime(),
        )[0];
      if (actionable) result.set(contract.id, actionable.id);
    }
    return result;
  }, [contracts]);

  const summary = useMemo(() => {
    const open = tenantItems.filter((item) => STATUS_ABERTO.includes(item.status));
    return {
      paid: tenantItems
        .filter((item) => isPagamentoConcluido(item.status))
        .reduce((sum, item) => sum + item.amount, 0),
      open: open.reduce((sum, item) => sum + item.amount, 0),
      overdue: tenantItems.filter((item) => item.status === "overdue"),
      next: [...open].sort(
        (a, b) =>
          new Date(a.dueDate || "9999-12-31").getTime() -
          new Date(b.dueDate || "9999-12-31").getTime(),
      )[0],
    };
  }, [tenantItems]);

  async function copyValue(value: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch {
      toast.error("Não foi possível copiar. Tente novamente.");
    }
  }

  async function refreshStatus(item: TenantBillingItem) {
    if (!item.providerPaymentId) return;
    setRefreshingId(item.id);
    try {
      const { data, error } = await supabase.functions.invoke("asaas-get-payment", {
        body: { paymentId: item.providerPaymentId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      await loadBilling();
      toast.success("Status atualizado.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível consultar o pagamento agora.",
      );
    } finally {
      setRefreshingId(null);
    }
  }

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-neutral-900">
            Minhas Faturas
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Acompanhe cobranças, vencimentos e pagamentos do seu contrato.
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-neutral-400">Carregando...</p>
        ) : errorMessage ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
            <p className="text-sm text-red-700">{errorMessage}</p>
            <Button className="mt-4" variant="outline" onClick={loadBilling}>
              Tentar novamente
            </Button>
          </div>
        ) : !contracts.length ? (
          <EmptyBilling />
        ) : (
          <>
            {tenantItems.length > 0 && (
              <>
                {summary.overdue.length > 0 && (
                  <div className="flex items-start gap-4 rounded-2xl border border-red-200 bg-red-50 p-5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10">
                      <AlertTriangle className="text-red-600" size={20} />
                    </div>
                    <div>
                      <p className="text-sm font-black text-red-700">
                        Existem {summary.overdue.length} mensalidade
                        {summary.overdue.length > 1 ? "s" : ""} vencida
                        {summary.overdue.length > 1 ? "s" : ""}.
                      </p>
                      <p className="mt-0.5 text-xs text-red-600/80">
                        Regularize o pagamento para manter sua fiança ativa.
                      </p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <SummaryCard
                    icon={CalendarClock}
                    label="Próximo vencimento"
                    value={
                      summary.next?.dueDate
                        ? new Date(`${summary.next.dueDate}T00:00:00`).toLocaleDateString(
                            "pt-BR",
                          )
                        : "—"
                    }
                  />
                  <SummaryCard icon={Wallet} label="Em aberto" value={brl(summary.open)} />
                  <SummaryCard icon={Receipt} label="Já pago" value={brl(summary.paid)} />
                </div>
              </>
            )}

            {contracts.map((contract) => (
              <ContractBilling
                key={contract.id}
                contract={contract}
                actionableId={actionableByContract.get(contract.id)}
                refreshingId={refreshingId}
                onCopy={copyValue}
                onRefresh={refreshStatus}
              />
            ))}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function ContractBilling({
  contract,
  actionableId,
  refreshingId,
  onCopy,
  onRefresh,
}: {
  contract: BillingContract;
  actionableId?: string;
  refreshingId: string | null;
  onCopy: (value: string, message: string) => Promise<void>;
  onRefresh: (item: TenantBillingItem) => Promise<void>;
}) {
  const address = contract.imovel
    ? [contract.imovel.endereco, contract.imovel.cidade, contract.imovel.estado]
        .filter(Boolean)
        .join(", ")
    : "Contrato de locação";

  if (contract.payment_type === "imobiliaria") {
    return (
      <section className="rounded-2xl border border-yellow-200 bg-yellow-50 px-6 py-12 text-center">
        <Building2 className="mx-auto mb-4 text-yellow-700" size={34} />
        <p className="mx-auto max-w-xl text-base font-semibold leading-relaxed text-neutral-800">
          {AGENCY_BILLING_MESSAGE}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div>
        <p className="text-sm font-black text-neutral-900">{address}</p>
        {contract.plano?.nome && (
          <p className="text-xs text-neutral-500">{contract.plano.nome}</p>
        )}
      </div>

      {!contract.items.length ? (
        <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center">
          <Receipt className="mx-auto mb-3 text-neutral-300" size={28} />
          <p className="text-sm text-neutral-500">
            Nenhuma cobrança foi gerada para este contrato ainda.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-neutral-50 text-[10px] uppercase tracking-widest text-neutral-500">
              <tr>
                <th className="px-6 py-4 text-left">Mensalidade</th>
                <th className="px-6 py-4 text-left">Vencimento</th>
                <th className="px-6 py-4 text-left">Valor</th>
                <th className="px-6 py-4 text-left">Forma</th>
                <th className="px-6 py-4 text-left">Status</th>
                <th className="px-6 py-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {contract.items.map((item) => {
                const status = statusInfo(item, actionableId);
                const [year, month] = String(item.dueDate || "").split("-").map(Number);
                return (
                  <tr key={item.id} className="hover:bg-neutral-50/60">
                    <td className="px-6 py-4 font-bold">
                      Mês {item.installmentNumber}
                      {item.installmentTotal > 1 ? ` de ${item.installmentTotal}` : ""}
                      {month && year ? (
                        <span className="block text-xs font-normal text-neutral-500">
                          {MESES_PT[month - 1]} de {year}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-6 py-4 text-neutral-700">
                      {item.dueDate
                        ? new Date(`${item.dueDate}T00:00:00`).toLocaleDateString("pt-BR")
                        : "—"}
                    </td>
                    <td className="px-6 py-4 font-black text-neutral-900">
                      {brl(item.amount)}
                    </td>
                    <td className="px-6 py-4">
                      <PaymentMethod method={item.method} />
                    </td>
                    <td className="px-6 py-4">
                      <Badge className={`${status.cls} border`}>{status.label}</Badge>
                      {item.paidAt && (
                        <span className="mt-1 block text-[10px] text-neutral-500">
                          Pago em {new Date(item.paidAt).toLocaleDateString("pt-BR")}
                        </span>
                      )}
                    </td>
                    <td className="space-x-1 whitespace-nowrap px-6 py-4 text-right">
                      {item.method === "boleto" && item.boletoUrl && (
                        <a href={item.boletoUrl} target="_blank" rel="noreferrer">
                          <Button size="sm" variant="outline">
                            <FileText className="mr-1" size={14} /> Ver boleto
                          </Button>
                        </a>
                      )}
                      {item.method === "boleto" && item.boletoBarcode && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onCopy(item.boletoBarcode!, "Linha digitável copiada.")}
                          title="Copiar linha digitável"
                        >
                          <Copy size={14} />
                        </Button>
                      )}
                      {item.method === "pix" && item.pixCopyPaste && (
                        <Button
                          size="sm"
                          className="bg-neutral-900 text-white hover:bg-neutral-800"
                          onClick={() => onCopy(item.pixCopyPaste!, "Código Pix copiado.")}
                        >
                          <QrCode className="mr-1" size={14} /> Copiar Pix
                        </Button>
                      )}
                      {item.providerPaymentId && !isPagamentoConcluido(item.status) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onRefresh(item)}
                          disabled={refreshingId === item.id}
                          title="Atualizar status"
                        >
                          <RefreshCw
                            size={14}
                            className={refreshingId === item.id ? "animate-spin" : ""}
                          />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PaymentMethod({ method }: { method: TenantBillingItem["method"] }) {
  const Icon = method === "pix" ? QrCode : method === "credit_card" ? CreditCard : Landmark;
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold text-neutral-700">
      <Icon size={14} />
      {tenantBillingMethodLabel(method)}
    </span>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Receipt;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 text-neutral-900">
      <div className="mb-2 flex items-center gap-2 opacity-80">
        <Icon size={14} />
        <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
      </div>
      <p className="text-xl font-black tracking-tight">{value}</p>
    </div>
  );
}

function EmptyBilling() {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-10 text-center">
      <Receipt className="mx-auto mb-3 text-neutral-300" size={32} />
      <p className="text-sm text-neutral-500">Nenhuma fatura disponível ainda.</p>
    </div>
  );
}
