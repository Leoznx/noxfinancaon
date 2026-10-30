import assert from "node:assert/strict";
import test from "node:test";

import {
  buildContractBillingRows,
  summarizeContractBilling,
} from "../src/lib/contract-billing";
import type {
  TenantBillingConsultation,
  TenantInvoiceSource,
  TenantPaymentSource,
} from "../src/lib/tenant-billing";

const consultation: TenantBillingConsultation = {
  id: "consultation-1",
  payment_type: "imobiliaria",
  insurance_payment_method: "boleto",
  contract_period_months: 12,
};

const invoice: TenantInvoiceSource = {
  id: "invoice-1",
  consulta_id: consultation.id,
  asaas_payment_id: null,
  numero_parcela: 1,
  installment_total: 12,
  vencimento: "2026-10-15",
  valor: 386.5,
  status: "pending",
};

const payment: TenantPaymentSource = {
  id: "payment-1",
  consultation_id: consultation.id,
  asaas_payment_id: "pay_1",
  payment_method: "boleto",
  status: "received",
  value: 386.5,
  due_date: "2026-10-15",
  confirmed_at: "2026-10-14T12:00:00Z",
  received_at: "2026-10-14T12:00:00Z",
  pix_qr_code: null,
  pix_copy_paste: null,
  pix_expires_at: null,
  boleto_url: "https://example.test/boleto",
  boleto_barcode: "123",
  external_reference: `nox:consulta:${consultation.id}:installment:1`,
};

test("mostra faturamento centralizado da imobiliária no detalhe do contrato", () => {
  const rows = buildContractBillingRows({
    consultation,
    invoices: [invoice],
    payments: [payment],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "received");
  assert.equal(rows[0].linha_digitavel, "123");
});

test("reconcilia pagamento legado sem asaas_payment_id e não duplica total", () => {
  const rows = buildContractBillingRows({
    consultation: { ...consultation, payment_type: "inquilino" },
    invoices: [invoice],
    payments: [payment],
  });
  const summary = summarizeContractBilling(
    rows,
    new Date("2026-10-30T12:00:00-03:00"),
  );
  assert.equal(rows.length, 1);
  assert.equal(summary.total, 386.5);
  assert.equal(summary.paid, 386.5);
  assert.equal(summary.overdue, 0);
});

test("usa mensalidades somente como compatibilidade quando não há fonte canônica", () => {
  const rows = buildContractBillingRows({
    consultation,
    invoices: [],
    payments: [],
    legacyInstallments: [
      {
        id: "legacy-1",
        numero_parcela: 1,
        data_vencimento: "2026-11-10",
        valor: 270,
        status: "pendente",
      },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "legacy");
  assert.equal(rows[0].valor, 270);
});
