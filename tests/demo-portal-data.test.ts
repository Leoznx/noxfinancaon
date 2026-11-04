import assert from "node:assert/strict";
import test from "node:test";

import {
  getDemoBrokers,
  getDemoCollectionInvoices,
  getDemoCommissionDashboard,
  getDemoConsultations,
  getDemoPolicies,
  getDemoTenantBilling,
  getDemoTenantInvoiceSummaries,
  isDemoRecordId,
} from "../src/lib/demo-portal-data";

test("a apresentação possui históricos variados sem usar identificadores reais", () => {
  const consultations = getDemoConsultations();
  const policies = getDemoPolicies();
  const summaries = getDemoTenantInvoiceSummaries();
  const collections = getDemoCollectionInvoices();

  assert.equal(consultations.length, 7);
  assert.equal(policies.length, 6);
  assert.equal(summaries.length, 6);
  assert.equal(collections.length, 18);
  assert.ok(consultations.every((row) => isDemoRecordId(row.id)));
  assert.ok(policies.every((row) => isDemoRecordId(row.id)));
  assert.ok(summaries.every((row) => isDemoRecordId(row.apolice_id)));
  assert.ok(
    collections.every(
      (row) =>
        isDemoRecordId(row.id) &&
        isDemoRecordId(row.consulta_id) &&
        row.asaas_payment_id === null &&
        row.payment_url === null &&
        row.boleto_url === null,
    ),
  );
  assert.deepEqual(
    new Set(consultations.map((row) => row.status)),
    new Set(["aprovado", "em_analise", "recusado", "falta_documentos", "processando"]),
  );
  assert.deepEqual(
    new Set(summaries.map((row) => row.status)),
    new Set(["a_vencer", "em_dia", "vencido"]),
  );
});

test("corretores e comissões demonstram estados comerciais diferentes", () => {
  const brokers = getDemoBrokers();
  const dashboard = getDemoCommissionDashboard();

  assert.equal(brokers.length, 6);
  assert.ok(brokers.some((broker) => broker.membership_status === "pending"));
  assert.ok(brokers.some((broker) => broker.commission_allocation_mode === "split_50"));
  assert.ok(dashboard.commissions.length >= 5);
  assert.ok(dashboard.commissions.some((commission) => commission.status === "AVAILABLE"));
  assert.ok(dashboard.commissions.some((commission) => commission.status === "PAID"));
  assert.equal(dashboard.summary.withdrawal_action, "AVAILABLE");
  assert.equal(dashboard.summary.active_contracts, 15);
  assert.equal(dashboard.level?.contratosAtivos, 15);
  assert.equal(dashboard.level?.nivelAtual?.nome_nivel, "PRATA");
  assert.equal(dashboard.contracts.length, 15);
  assert.ok(dashboard.contracts.every((contract) => /^2026-\d{6}$/.test(contract.number)));
});

test("o inquilino demo recebe vários contratos e faturas sem referências de cobrança externa", () => {
  const billing = getDemoTenantBilling();

  assert.equal(billing.consultations.length, 3);
  assert.equal(billing.items.length, 9);
  assert.ok(billing.items.some((item) => item.status === "overdue"));
  assert.ok(billing.items.some((item) => item.status === "paid"));
  assert.ok(
    billing.items.every(
      (item) =>
        item.invoiceId === null &&
        item.providerPaymentId === null &&
        item.paymentUrl === null &&
        item.boletoUrl === null,
    ),
  );
});
