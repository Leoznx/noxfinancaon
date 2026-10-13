import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  Copy,
  CreditCard,
  ExternalLink,
  FileText,
  Landmark,
  Mail,
  MessageCircle,
  QrCode,
  Receipt,
  RefreshCw,
  RotateCw,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/AuthProvider";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  cardRegistrationStatusLabel,
  isPagamentoConcluido,
  isReissuablePaymentStatus,
  MESES_PT,
  statusPagamentoLabel,
  subscriptionStatusLabel,
} from "@/lib/asaas-payment";
import { manageAsaasSubscription, managePersistedAsaasPayment } from "@/lib/asaas-checkout";
import {
  AGENCY_BILLING_MESSAGE,
  mergeTenantBillingItems,
  tenantBillingMethodLabel,
  type TenantBillingConsultation,
  type TenantBillingItem,
  type TenantInvoiceSource,
  type TenantPaymentSource,
  type TenantSubscriptionSource,
} from "@/lib/tenant-billing";

export const Route = createFileRoute("/inquilino/faturas")({
  component: () => (
    <ProtectedRoute roles={["inquilino"]}>
      <FaturasInquilino />
    </ProtectedRoute>
  ),
});

const STATUS_ABERTO = ["pending", "processing", "overdue", "risk_analysis", "approved"];

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
  const [reissuingId, setReissuingId] = useState<string | null>(null);
  const [notifyingId, setNotifyingId] = useState<string | null>(null);

  const loadBilling = useCallback(async () => {
    if (!user?.id) return;
    setErrorMessage(null);

    try {
      const consultationSelect =
        "id, payment_type, insurance_payment_method, contract_period_months, imovel:imoveis(endereco, cidade, estado), plano:planos(nome)";
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

      const [invoiceResult, paymentResult, subscriptionResult] = await Promise.all([
        supabase
          .from("faturas_inquilino")
          .select("*, notifications:financial_notifications(*)")
          .in("consulta_id", consultationIds),
        (supabase as any)
          .from("asaas_payments")
          .select("*")
          .in("consultation_id", consultationIds),
        (supabase as any)
          .from("asaas_subscriptions")
          .select("*")
          .in("consultation_id", consultationIds)
          .order("created_at", { ascending: false }),
      ]);
      if (invoiceResult.error) throw invoiceResult.error;
      if (paymentResult.error) throw paymentResult.error;
      if (subscriptionResult.error) throw subscriptionResult.error;

      setItems(
        mergeTenantBillingItems(
          uniqueConsultations,
          (invoiceResult.data ?? []) as unknown as TenantInvoiceSource[],
          (paymentResult.data ?? []) as unknown as TenantPaymentSource[],
          (subscriptionResult.data ?? []) as unknown as TenantSubscriptionSource[],
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
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "asaas_subscriptions",
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
    if (item.method !== "credit_card" && !item.providerPaymentId) return;
    setRefreshingId(item.id);
    try {
      if (item.method === "credit_card") {
        await executarAcaoAssinatura(item, "refresh");
      } else {
        await managePersistedAsaasPayment({
          invoiceId: item.invoiceId,
          paymentId: item.providerPaymentId,
          consultationId: item.consultationId,
          action: "refresh",
        });
      }
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

  async function reissue(item: TenantBillingItem, method: "boleto" | "pix") {
    if (!item.invoiceId) {
      toast.error("Esta cobrança avulsa não possui uma mensalidade atualizável.");
      return;
    }
    setReissuingId(`${item.id}:${method}`);
    try {
      const payment = await managePersistedAsaasPayment({
        invoiceId: item.invoiceId,
        paymentId: item.providerPaymentId,
        consultationId: item.consultationId,
        action: "reissue",
        paymentMethod: method,
      });
      await loadBilling();
      if (method === "boleto" && payment.boleto?.pdfUrl) {
        window.open(payment.boleto.pdfUrl, "_blank", "noopener,noreferrer");
      }
      if (method === "pix" && payment.pix?.qrCode) {
        await copyValue(payment.pix.qrCode, "Pix atualizado copiado.");
      }
      toast.success(method === "boleto" ? "Boleto atualizado gerado." : "Pix atualizado gerado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar a cobrança.");
    } finally {
      setReissuingId(null);
    }
  }

  async function reissueInitialCheckout(item: TenantBillingItem) {
    const key = `${item.id}:initial-checkout`;
    setReissuingId(key);
    try {
      await executarAcaoAssinatura(item, "reissue_initial");
      await loadBilling();
      toast.success("Novo link da cobrança inicial gerado e enviado.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível gerar um novo link inicial.",
      );
    } finally {
      setReissuingId(null);
    }
  }

  async function reissueRecurringCheckout(item: TenantBillingItem) {
    const key = `${item.id}:recurring-checkout`;
    setReissuingId(key);
    try {
      await executarAcaoAssinatura(item, "reissue_checkout");
      await loadBilling();
      toast.success("Novo link de cadastro recorrente gerado e enviado.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível gerar um novo link de cadastro.",
      );
    } finally {
      setReissuingId(null);
    }
  }

  async function resend(item: TenantBillingItem, channel: "email" | "whatsapp") {
    const key = `${item.id}:${channel}`;
    setNotifyingId(key);
    try {
      const action = channel === "email" ? "resend_email" : "resend_whatsapp";
      if (item.method === "credit_card") {
        await executarAcaoAssinatura(item, action);
      } else {
        await managePersistedAsaasPayment({
          invoiceId: item.invoiceId,
          paymentId: item.providerPaymentId,
          consultationId: item.consultationId,
          action,
        });
      }
      toast.success(channel === "email" ? "Cobrança reenviada por e-mail." : "Cobrança reenviada por WhatsApp.");
      await loadBilling();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível reenviar a cobrança.");
    } finally {
      setNotifyingId(null);
    }
  }

  async function executarAcaoAssinatura(
    item: TenantBillingItem,
    action:
      | "refresh"
      | "resend_email"
      | "resend_whatsapp"
      | "reissue_initial"
      | "reissue_checkout",
  ) {
    if (!item.subscriptionLocalId || !item.subscriptionMode) {
      throw new Error("A assinatura recorrente ainda não está disponível para consulta.");
    }
    return manageAsaasSubscription({
      proposalId: item.consultationId,
      mode: item.subscriptionMode,
      selectedFireInsuranceMode: item.subscriptionFireMode,
      amount: item.subscriptionInitialAmount,
      monthlyAmount: item.subscriptionMonthlyAmount,
      action,
    });
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
                reissuingId={reissuingId}
                notifyingId={notifyingId}
                onCopy={copyValue}
                onRefresh={refreshStatus}
                onReissue={reissue}
                onReissueInitialCheckout={reissueInitialCheckout}
                onReissueRecurringCheckout={reissueRecurringCheckout}
                onResend={resend}
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
  reissuingId,
  notifyingId,
  onCopy,
  onRefresh,
  onReissue,
  onReissueInitialCheckout,
  onReissueRecurringCheckout,
  onResend,
}: {
  contract: BillingContract;
  actionableId?: string;
  refreshingId: string | null;
  reissuingId: string | null;
  notifyingId: string | null;
  onCopy: (value: string, message: string) => Promise<void>;
  onRefresh: (item: TenantBillingItem) => Promise<void>;
  onReissue: (item: TenantBillingItem, method: "boleto" | "pix") => Promise<void>;
  onReissueInitialCheckout: (item: TenantBillingItem) => Promise<void>;
  onReissueRecurringCheckout: (item: TenantBillingItem) => Promise<void>;
  onResend: (item: TenantBillingItem, channel: "email" | "whatsapp") => Promise<void>;
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
        <>
          {/* Mobile/tablet estreito (< md): cards empilhados, sem tabela pra arrastar. */}
          <div className="md:hidden divide-y divide-neutral-100 rounded-2xl border border-neutral-200 bg-white shadow-sm">
            {contract.items.map((item) => {
              const status = statusInfo(item, actionableId);
              const initialLinkExpired = ["cancelled", "expired"].includes(
                item.subscriptionInitialCheckoutStatus || "",
              );
              const recurringLinkExpired = ["cancelled", "expired"].includes(
                item.subscriptionCheckoutStatus || "",
              );
              const validPaymentLink =
                (!recurringLinkExpired ? item.subscriptionCheckoutUrl : null) ||
                (!initialLinkExpired ? item.paymentUrl : null);
              const [year, month] = String(item.dueDate || "").split("-").map(Number);
              return (
                <div key={item.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-neutral-900">
                        Mês {item.installmentNumber}
                        {item.installmentTotal > 1 ? ` de ${item.installmentTotal}` : ""}
                      </p>
                      {month && year ? (
                        <p className="text-xs text-neutral-500">
                          {MESES_PT[month - 1]} de {year}
                        </p>
                      ) : null}
                    </div>
                    <Badge className={`${status.cls} border shrink-0`}>{status.label}</Badge>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-neutral-600">
                      Vence{" "}
                      {item.dueDate
                        ? new Date(`${item.dueDate}T00:00:00`).toLocaleDateString("pt-BR")
                        : "—"}
                    </span>
                    <span className="font-black text-neutral-900">{brl(item.amount)}</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <PaymentMethod method={item.method} />
                    {item.paidAt && (
                      <span className="text-[10px] text-neutral-500">
                        Pago em {new Date(item.paidAt).toLocaleDateString("pt-BR")}
                      </span>
                    )}
                  </div>
                  {(item.providerPaymentId ||
                    item.subscriptionLocalId ||
                    item.notificationCount > 0) && (
                    <p className="break-all text-[10px] text-neutral-500">
                      {item.providerPaymentId ? `Asaas ${item.providerPaymentId}` : ""}
                      {item.subscriptionId ? ` · Assinatura ${item.subscriptionId}` : ""}
                      {item.subscriptionStatus
                        ? ` · ${subscriptionStatusLabel(item.subscriptionStatus)}`
                        : ""}
                      {item.cardRegistrationStatus
                        ? ` · ${cardRegistrationStatusLabel(item.cardRegistrationStatus)}`
                        : ""}
                      {item.notificationCount > 0
                        ? ` · ${item.notificationCount} notificação(ões)`
                        : ""}
                    </p>
                  )}

                  {(item.method === "boleto" ||
                    item.method === "pix" ||
                    item.subscriptionLocalId ||
                    (item.providerPaymentId && !isPagamentoConcluido(item.status))) && (
                    <div className="flex flex-wrap gap-2 pt-1">
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
                          <Copy size={14} className="mr-1" /> Copiar linha
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
                      {validPaymentLink && (
                        <a
                          href={validPaymentLink}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Button size="sm" variant="outline">
                            <ExternalLink className="mr-1" size={14} /> Abrir cobrança
                          </Button>
                        </a>
                      )}
                      {item.method !== "credit_card" &&
                        item.invoiceId &&
                        item.providerPaymentId &&
                        isReissuablePaymentStatus(item.status) && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onReissue(item, "boleto")}
                            disabled={reissuingId === `${item.id}:boleto`}
                          >
                            <FileText className="mr-1" size={14} /> Boleto atualizado
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onReissue(item, "pix")}
                            disabled={reissuingId === `${item.id}:pix`}
                          >
                            <QrCode className="mr-1" size={14} /> Gerar Pix
                          </Button>
                        </>
                      )}
                      {((item.method === "credit_card" && item.subscriptionLocalId) ||
                        (item.providerPaymentId && !isPagamentoConcluido(item.status))) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onRefresh(item)}
                          disabled={refreshingId === item.id}
                          title="Atualizar status"
                        >
                          <RefreshCw
                            size={14}
                            className={`mr-1 ${refreshingId === item.id ? "animate-spin" : ""}`}
                          />
                          Atualizar
                        </Button>
                      )}
                      {initialLinkExpired && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onReissueInitialCheckout(item)}
                          disabled={reissuingId === `${item.id}:initial-checkout`}
                        >
                          <RotateCw className="mr-1" size={14} /> Gerar novo link inicial
                        </Button>
                      )}
                      {recurringLinkExpired && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onReissueRecurringCheckout(item)}
                          disabled={reissuingId === `${item.id}:recurring-checkout`}
                        >
                          <RotateCw className="mr-1" size={14} /> Gerar novo link de cadastro
                        </Button>
                      )}
                      {!initialLinkExpired && !recurringLinkExpired && (item.invoiceId || item.providerPaymentId || item.subscriptionLocalId) && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onResend(item, "whatsapp")}
                            disabled={notifyingId !== null}
                          >
                            <MessageCircle className="mr-1" size={14} /> WhatsApp
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onResend(item, "email")}
                            disabled={notifyingId !== null}
                          >
                            <Mail className="mr-1" size={14} /> E-mail
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Tablet/desktop (md:+): tabela completa. */}
          <div className="hidden md:block overflow-x-auto rounded-2xl border border-neutral-200 bg-white shadow-sm">
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
                const initialLinkExpired = ["cancelled", "expired"].includes(
                  item.subscriptionInitialCheckoutStatus || "",
                );
                const recurringLinkExpired = ["cancelled", "expired"].includes(
                  item.subscriptionCheckoutStatus || "",
                );
                const validPaymentLink =
                  (!recurringLinkExpired ? item.subscriptionCheckoutUrl : null) ||
                  (!initialLinkExpired ? item.paymentUrl : null);
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
                      {item.providerPaymentId && (
                        <span
                          className="block max-w-40 truncate text-[10px] font-normal text-neutral-400"
                          title={item.providerPaymentId}
                        >
                          Asaas {item.providerPaymentId}
                        </span>
                      )}
                      {item.subscriptionLocalId && (
                        <span className="block text-[10px] font-normal text-neutral-500">
                          Assinatura {item.subscriptionStatus || "pendente"}
                        </span>
                      )}
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
                      {validPaymentLink && (
                        <a
                          href={validPaymentLink}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Button size="sm" variant="ghost" title="Abrir cobrança">
                            <ExternalLink size={14} />
                          </Button>
                        </a>
                      )}
                      {item.method !== "credit_card" &&
                        item.invoiceId &&
                        item.providerPaymentId &&
                        isReissuablePaymentStatus(item.status) && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onReissue(item, "boleto")}
                            disabled={reissuingId === `${item.id}:boleto`}
                          >
                            <FileText className="mr-1" size={14} /> Boleto atualizado
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onReissue(item, "pix")}
                            disabled={reissuingId === `${item.id}:pix`}
                          >
                            <QrCode className="mr-1" size={14} /> Gerar Pix
                          </Button>
                        </>
                      )}
                      {((item.method === "credit_card" && item.subscriptionLocalId) ||
                        (item.providerPaymentId && !isPagamentoConcluido(item.status))) && (
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
                      {initialLinkExpired && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onReissueInitialCheckout(item)}
                          disabled={reissuingId === `${item.id}:initial-checkout`}
                          title="Gerar novo link inicial"
                        >
                          <RotateCw size={14} />
                        </Button>
                      )}
                      {recurringLinkExpired && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onReissueRecurringCheckout(item)}
                          disabled={reissuingId === `${item.id}:recurring-checkout`}
                          title="Gerar novo link de cadastro"
                        >
                          <RotateCw size={14} />
                        </Button>
                      )}
                      {!initialLinkExpired && !recurringLinkExpired && (item.invoiceId || item.providerPaymentId || item.subscriptionLocalId) && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onResend(item, "whatsapp")}
                            disabled={notifyingId !== null}
                            title="Reenviar WhatsApp"
                          >
                            <MessageCircle size={14} />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onResend(item, "email")}
                            disabled={notifyingId !== null}
                            title="Reenviar e-mail"
                          >
                            <Mail size={14} />
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </>
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
