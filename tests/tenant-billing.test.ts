import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENCY_BILLING_MESSAGE,
  mergeTenantBillingItems,
  tenantBillingMethodLabel,
  type TenantBillingConsultation,
  type TenantInvoiceSource,
  type TenantPaymentSource,
} from "../src/lib/tenant-billing";

const agency: TenantBillingConsultation = {
  id: "agency-contract",
  payment_type: "imobiliaria",
  insurance_payment_method: "boleto",
};
const tenant: TenantBillingConsultation = {
  id: "tenant-contract",
  payment_type: "inquilino",
  insurance_payment_method: "pix",
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
  assert.equal(result[0].installmentTotal, 12);
  assert.equal(tenantBillingMethodLabel(result[0].method), "Cartão");
});
