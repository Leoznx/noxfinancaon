import {
  mergeTenantBillingItems,
  type TenantBillingConsultation,
  type TenantInvoiceSource,
  type TenantPaymentSource,
  type TenantSubscriptionSource,
} from "@/lib/tenant-billing";

export type LegacyContractInstallment = {
  id: string;
  numero_parcela?: number | null;
  data_vencimento: string | null;
  valor: number | null;
  status: string | null;
  data_pagamento?: string | null;
  boleto_url?: string | null;
  linha_digitavel?: string | null;
  codigo_barras?: string | null;
  comprovante_url?: string | null;
};

export type ContractBillingRow = {
  id: string;
  numero_parcela: number;
  installment_total: number;
  data_vencimento: string | null;
  valor: number;
  status: string;
  data_pagamento: string | null;
  boleto_url: string | null;
  linha_digitavel: string | null;
  comprovante_url: string | null;
  source: "invoice" | "payment" | "legacy";
};

export type ContractBillingStatus =
  | "pago"
  | "pendente"
  | "vencido"
  | "cancelado";

export function buildContractBillingRows({
  consultation,
  invoices,
  payments,
  subscriptions = [],
  legacyInstallments = [],
}: {
  consultation: TenantBillingConsultation;
  invoices: TenantInvoiceSource[];
  payments: TenantPaymentSource[];
  subscriptions?: TenantSubscriptionSource[];
  legacyInstallments?: LegacyContractInstallment[];
}): ContractBillingRow[] {
  const canonical = mergeTenantBillingItems(
    [consultation],
    invoices,
    payments,
    subscriptions,
    { includeAgencyBilling: true },
  ).map<ContractBillingRow>((item) => ({
    id: item.id,
    numero_parcela: item.installmentNumber,
    installment_total: item.installmentTotal,
    data_vencimento: item.dueDate,
    valor: item.amount,
    status: item.status,
    data_pagamento: item.paidAt,
    boleto_url: item.paymentUrl || item.boletoUrl,
    linha_digitavel: item.boletoBarcode || item.pixCopyPaste,
    comprovante_url: null,
    source: item.invoiceId ? "invoice" : "payment",
  }));

  // `mensalidades` é o modelo anterior ao faturamento canônico. Usá-lo
  // somente como fallback evita duplicar parcelas de contratos migrados.
  if (canonical.length > 0) return canonical;

  return legacyInstallments
    .map<ContractBillingRow>((installment, index) => ({
      id: `legacy:${installment.id}`,
      numero_parcela: Number(installment.numero_parcela || index + 1),
      installment_total: legacyInstallments.length,
      data_vencimento: installment.data_vencimento,
      valor: Number(installment.valor || 0),
      status: installment.status || "pendente",
      data_pagamento: installment.data_pagamento || null,
      boleto_url: installment.boleto_url || null,
      linha_digitavel:
        installment.linha_digitavel || installment.codigo_barras || null,
      comprovante_url: installment.comprovante_url || null,
      source: "legacy",
    }))
    .sort((first, second) => {
      const byDate =
        new Date(first.data_vencimento || "9999-12-31").getTime() -
        new Date(second.data_vencimento || "9999-12-31").getTime();
      return byDate || first.numero_parcela - second.numero_parcela;
    });
}

export function resolveContractBillingStatus(
  row: Pick<ContractBillingRow, "status" | "data_vencimento">,
  today = new Date(),
): ContractBillingStatus {
  const status = String(row.status || "pending").toLowerCase();
  if (
    ["pago", "paid", "received", "confirmed", "paid_via_consolidated"].includes(
      status,
    )
  ) {
    return "pago";
  }
  if (["cancelado", "cancelled", "canceled", "refunded"].includes(status)) {
    return "cancelado";
  }

  const currentDay = new Date(today);
  currentDay.setHours(0, 0, 0, 0);
  const dueDate = row.data_vencimento
    ? new Date(`${row.data_vencimento.slice(0, 10)}T00:00:00`)
    : null;
  if (
    ["overdue", "vencido", "atrasado"].includes(status) ||
    (dueDate && dueDate < currentDay)
  ) {
    return "vencido";
  }
  return "pendente";
}

export function summarizeContractBilling(
  rows: ContractBillingRow[],
  today = new Date(),
) {
  const normalized = rows.map((row) => ({
    ...row,
    statusReal: resolveContractBillingStatus(row, today),
  }));
  const sum = (status?: ContractBillingStatus) =>
    normalized
      .filter((row) => !status || row.statusReal === status)
      .reduce((total, row) => total + Number(row.valor || 0), 0);
  const pendingRows = normalized.filter(
    (row) => row.statusReal === "pendente",
  );

  return {
    rows: normalized,
    total: sum(),
    paid: sum("pago"),
    pending: sum("pendente"),
    overdue: sum("vencido"),
    openCount: normalized.filter(
      (row) => row.statusReal === "pendente" || row.statusReal === "vencido",
    ).length,
    overdueCount: normalized.filter((row) => row.statusReal === "vencido")
      .length,
    nextDueDate: pendingRows[0]?.data_vencimento || null,
  };
}
