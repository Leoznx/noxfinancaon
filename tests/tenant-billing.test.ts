import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENCY_BILLING_MESSAGE,
  mergeTenantBillingItems,
  tenantBillingMethodLabel,
  type TenantBillingConsultation,
  type TenantInvoiceSource,
  type TenantPaymentSource,
  type TenantSubscriptionSource,
} from "../src/lib/tenant-billing";

const agency: TenantBillingConsultation = {
  id: "agency-contract",
  payment_type: "imobiliaria",
  insurance_payment_method: "boleto",
  contract_period_months: 12,
};
const tenant: TenantBillingConsultation = {
  id: "tenant-contract",
  payment_type: "inquilino",
  insurance_payment_method: "pix",
  contract_period_months: 24,
};

const invoice: TenantInvoiceSource = {
  id: "invoice-1",
  consulta_id: "tenant-contract",
  asaas_payment_id: "payment-1",
  numero_parcela: 1,
  installment_total: 12,
  vencimento: "2026-08-10",
  valor: 460,
  status: "pending",
  boleto_url: null,
  linha_digitavel: null,
};

const payment: TenantPaymentSource = {
  id: "payment-1",
  consultation_id: "tenant-contract",
  asaas_payment_id: "pay_asaas_1",
  payment_method: "pix",
  status: "confirmed",
  value: 460,
  due_date: "2026-08-10",
  confirmed_at: "2026-08-09T12:00:00Z",
  received_at: null,
  pix_qr_code: "base64",
  pix_copy_paste: "pix-code",
  pix_expires_at: "2027-08-10T00:00:00Z",
  boleto_url: null,
  boleto_barcode: null,
  external_reference: "nox:consulta:tenant-contract:installment:1",
};

const subscription: TenantSubscriptionSource = {
  id: "subscription-local-1",
  consultation_id: "tenant-contract",
  mode: "checkout",
  asaas_subscription_id: "sub_asaas_1",
  checkout_url: "https://asaas.example/checkout",
  status: "pending",
  card_registration_status: "awaiting_card",
  initial_amount: 377.5,
  monthly_amount: 277.5,
  fire_insurance_payment_mode: "embutido",
};

test("contratos pagos pela imobiliária nunca expõem cobranças ao inquilino", () => {
  const result = mergeTenantBillingItems(
    [agency],
    [{ ...invoice, consulta_id: agency.id }],
    [{ ...payment, consultation_id: agency.id }],
  );
  assert.deepEqual(result, []);
  assert.equal(
    AGENCY_BILLING_MESSAGE,
    "Sua imobiliária parceira realizará o pagamentos das faturas através da cobrança feita a você.",
  );
});

test("une a mensalidade ao pagamento Pix e preserva o status real", () => {
  const result = mergeTenantBillingItems([tenant], [invoice], [payment]);
  assert.equal(result.length, 1);
  assert.equal(result[0].method, "pix");
  assert.equal(result[0].status, "confirmed");
  assert.equal(result[0].pixCopyPaste, "pix-code");
  assert.equal(result[0].installmentTotal, 12);
});

test("inclui pagamentos gerados sem linha correspondente em faturas_inquilino", () => {
  const card = {
    ...payment,
    id: "payment-card",
    payment_method: "credit_card",
    external_reference: "nox:consulta:tenant-contract:installment:2",
  };
  const result = mergeTenantBillingItems([tenant], [], [card]);
  assert.equal(result.length, 1);
  assert.equal(result[0].method, "credit_card");
  assert.equal(result[0].installmentNumber, 2);
  assert.equal(result[0].installmentTotal, 24);
  assert.equal(tenantBillingMethodLabel(result[0].method), "Cartão");
});

test("usa o período do contrato quando a fatura antiga não informa o total", () => {
  const result = mergeTenantBillingItems(
    [tenant],
    [{ ...invoice, installment_total: null }],
    [payment],
  );
  assert.equal(result[0].installmentTotal, 24);
});

test("reidrata a parcela mensal recorrente pelo novo externalReference", () => {
  const monthlyPayment = {
    ...payment,
    id: "payment-monthly-7",
    external_reference: "nox:consulta:tenant-contract:monthly:7",
  };
  const result = mergeTenantBillingItems([tenant], [], [monthlyPayment]);
  assert.equal(result.length, 1);
  assert.equal(result[0].installmentNumber, 7);
  assert.equal(result[0].installmentTotal, 24);
});

test("anexa a assinatura recorrente oficial para retomada e reenvio", () => {
  const cardPayment = { ...payment, payment_method: "credit_card" };
  const result = mergeTenantBillingItems([tenant], [invoice], [cardPayment], [subscription]);
  assert.equal(result[0].subscriptionLocalId, "subscription-local-1");
  assert.equal(result[0].subscriptionId, "sub_asaas_1");
  assert.equal(result[0].subscriptionMode, "checkout");
  assert.equal(result[0].subscriptionCheckoutUrl, "https://asaas.example/checkout");
  assert.equal(result[0].cardRegistrationStatus, "awaiting_card");
});
