export const AGENCY_BILLING_MESSAGE =
  "Sua imobiliária parceira realizará o pagamentos das faturas através da cobrança feita a você.";

export type TenantBillingMethod = "boleto" | "pix" | "credit_card" | "unknown";

export type TenantBillingConsultation = {
  id: string;
  payment_type: string | null;
  insurance_payment_method: string | null;
  imovel?: {
    endereco: string | null;
    cidade: string | null;
    estado: string | null;
  } | null;
  plano?: { nome: string | null } | null;
};

export type TenantInvoiceSource = {
  id: string;
  consulta_id: string | null;
  asaas_payment_id?: string | null;
  numero_parcela: number | null;
  installment_total?: number | null;
  vencimento: string | null;
  valor: number | null;
  status: string | null;
  pago_em?: string | null;
  boleto_url?: string | null;
  linha_digitavel?: string | null;
};

export type TenantPaymentSource = {
  id: string;
  consultation_id: string | null;
  asaas_payment_id: string | null;
  payment_method: string | null;
  status: string | null;
  value: number | null;
  due_date: string | null;
  confirmed_at: string | null;
  received_at: string | null;
  pix_qr_code: string | null;
  pix_copy_paste: string | null;
  pix_expires_at: string | null;
  boleto_url: string | null;
  boleto_barcode: string | null;
  external_reference: string | null;
};

export type TenantBillingItem = {
  id: string;
  consultationId: string;
  localPaymentId: string | null;
  providerPaymentId: string | null;
  method: TenantBillingMethod;
  status: string;
  amount: number;
  dueDate: string | null;
  paidAt: string | null;
  installmentNumber: number;
  installmentTotal: number;
  boletoUrl: string | null;
  boletoBarcode: string | null;
  pixCopyPaste: string | null;
  pixQrCode: string | null;
  pixExpiresAt: string | null;
};

function normalizeMethod(value: string | null | undefined): TenantBillingMethod {
  if (value === "boleto" || value === "pix" || value === "credit_card") return value;
  return "unknown";
}

function installmentFromReference(reference: string | null | undefined) {
  const match = String(reference || "").match(/installment:(\d+)/i);
  return {
    number: match ? Number(match[1]) : 1,
    total: match ? 12 : 1,
  };
}

export function tenantBillingMethodLabel(method: TenantBillingMethod) {
  if (method === "boleto") return "Boleto";
  if (method === "pix") return "Pix";
  if (method === "credit_card") return "Cartão";
  return "Pagamento";
}

export function mergeTenantBillingItems(
  consultations: TenantBillingConsultation[],
  invoices: TenantInvoiceSource[],
  payments: TenantPaymentSource[],
): TenantBillingItem[] {
  const consultationById = new Map(consultations.map((item) => [item.id, item]));
  const tenantConsultationIds = new Set(
    consultations
      .filter((item) => item.payment_type !== "imobiliaria")
      .map((item) => item.id),
  );
  const paymentById = new Map(payments.map((item) => [item.id, item]));
  const usedPaymentIds = new Set<string>();
  const merged: TenantBillingItem[] = [];

  for (const invoice of invoices) {
    const consultationId = invoice.consulta_id || "";
    if (!tenantConsultationIds.has(consultationId)) continue;
    const payment = invoice.asaas_payment_id
      ? paymentById.get(invoice.asaas_payment_id)
      : undefined;
    if (payment) usedPaymentIds.add(payment.id);
    const consultation = consultationById.get(consultationId);

    merged.push({
      id: `invoice:${invoice.id}`,
      consultationId,
      localPaymentId: payment?.id || invoice.asaas_payment_id || null,
      providerPaymentId: payment?.asaas_payment_id || null,
      method: normalizeMethod(
        payment?.payment_method || consultation?.insurance_payment_method,
      ),
      status: payment?.status || invoice.status || "pending",
      amount: Number(payment?.value ?? invoice.valor ?? 0),
      dueDate: payment?.due_date || invoice.vencimento || null,
      paidAt: payment?.received_at || payment?.confirmed_at || invoice.pago_em || null,
      installmentNumber: Number(invoice.numero_parcela || 1),
      installmentTotal: Number(invoice.installment_total || 1),
      boletoUrl: payment?.boleto_url || invoice.boleto_url || null,
      boletoBarcode: payment?.boleto_barcode || invoice.linha_digitavel || null,
      pixCopyPaste: payment?.pix_copy_paste || null,
      pixQrCode: payment?.pix_qr_code || null,
      pixExpiresAt: payment?.pix_expires_at || null,
    });
  }

  for (const payment of payments) {
    const consultationId = payment.consultation_id || "";
    if (usedPaymentIds.has(payment.id) || !tenantConsultationIds.has(consultationId)) {
      continue;
    }
    const installment = installmentFromReference(payment.external_reference);
    merged.push({
      id: `payment:${payment.id}`,
      consultationId,
      localPaymentId: payment.id,
      providerPaymentId: payment.asaas_payment_id,
      method: normalizeMethod(payment.payment_method),
      status: payment.status || "pending",
      amount: Number(payment.value || 0),
      dueDate: payment.due_date,
      paidAt: payment.received_at || payment.confirmed_at,
      installmentNumber: installment.number,
      installmentTotal: installment.total,
      boletoUrl: payment.boleto_url,
      boletoBarcode: payment.boleto_barcode,
      pixCopyPaste: payment.pix_copy_paste,
      pixQrCode: payment.pix_qr_code,
      pixExpiresAt: payment.pix_expires_at,
    });
  }

  return merged.sort((a, b) => {
    const byDate =
      new Date(a.dueDate || "9999-12-31").getTime() -
      new Date(b.dueDate || "9999-12-31").getTime();
    return byDate || a.installmentNumber - b.installmentNumber;
  });
}
