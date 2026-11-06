import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  asaasBillingTypeForReissue,
  normalizeReissuablePaymentMethod,
  reissuedInvoiceDueDate,
} from "../supabase/functions/_shared/billing-automation.ts";
import { nextInvoiceDueDate, normalizePaymentDueDay } from "../src/lib/payment-due-date.ts";
import {
  canReconfigureInvoice,
  reconfigurablePaymentMethodLabel,
} from "../src/lib/invoice-reconfiguration.ts";
import { resolveInvoicePaymentLink } from "../supabase/functions/_shared/invoice-payment-link.ts";

test("reagenda na competencia original quando ela ainda esta no futuro", () => {
  assert.equal(reissuedInvoiceDueDate("2026-12-10", 25, "2026-11-03"), "2026-12-25");
  assert.equal(nextInvoiceDueDate("2026-12-10", 25, "2026-11-03"), "2026-12-25");
});

test("cobranca vencida usa a proxima data permitida", () => {
  assert.equal(reissuedInvoiceDueDate("2026-10-10", 5, "2026-11-03"), "2026-11-05");
  assert.equal(nextInvoiceDueDate("2026-10-10", 5, "2026-11-03"), "2026-11-05");
  assert.equal(reissuedInvoiceDueDate("2026-10-10", 18, "2026-11-03"), null);
  assert.equal(normalizePaymentDueDay(18), null);
});

test("backend valida vencimento, substitui a cobranca e cancela duplicadas", () => {
  const source = readFileSync(
    new URL("../supabase/functions/asaas-manage-payment/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /billingDueDay\?: number/);
  assert.match(source, /normalizeContractBillingDueDay\(body\.billingDueDay\)/);
  assert.match(source, /reissuedInvoiceDueDate/);
  assert.match(source, /cancelObsoleteInstallmentCharges/);
  assert.match(source, /method: "DELETE"/);
  assert.match(source, /pix_copy_paste: null/);
  assert.match(source, /linha_digitavel: null/);
  assert.match(source, /paymentMethod\?: ReissuablePaymentMethod/);
  assert.match(source, /normalizeReissuablePaymentMethod\(body\.paymentMethod\)/);
  assert.match(source, /resolveInvoicePaymentLink\(invoice, candidatesResult\.data \|\| \[\]/);
  assert.match(source, /persistRecoveredPaymentLink\(supabase, invoice, payment\)/);
  assert.match(source, /asaasBillingTypeForReissue\(method\)/);
  assert.match(source, /payment_method: method/);
  assert.match(source, /boleto_url:[\s\S]*method === "boleto"[\s\S]*: null/);
  assert.match(source, /pix_copy_paste: method === "pix"[\s\S]*: null/);
  assert.match(source, /request_key: requestKey/);
  assert.match(source, /notificationType: `payment_reissued:\$\{audit\.id\}`/);
  assert.match(
    source,
    /invoice = invoiceTransition\.row;\s+const invoiceReissueApplied =[\s\S]+if \(invoiceReissueApplied\)/,
  );
});

test("recupera vinculo legado da cobranca exibida pela mesma parcela", () => {
  const invoice = {
    id: "invoice-1",
    consulta_id: "consultation-1",
    billing_key: "legacy:invoice-1:installment:2",
    charge_kind: "monthly",
    numero_parcela: 2,
    vencimento: "2026-11-08",
    valor: 1_200,
  };
  const payment = {
    id: "local-payment-1",
    consultation_id: "consultation-1",
    asaas_payment_id: "pay_provider_1",
    external_reference: "nox:consultation-1:monthly:2",
    charge_kind: "monthly",
    value: 1_200,
    due_date: "2026-11-08",
    status: "pending",
  };
  const resolution = resolveInvoicePaymentLink(invoice, [payment]);
  assert.equal(resolution.payment?.id, payment.id);
  assert.equal(resolution.strategy, "installment");
  assert.equal(resolution.ambiguous, false);
});

test("prioriza chave exata e nunca cruza propostas", () => {
  const invoice = {
    consulta_id: "consultation-1",
    billing_key: "nox:consultation-1:monthly:3",
    charge_kind: "monthly",
    numero_parcela: 3,
    vencimento: "2026-12-10",
    valor: 900,
  };
  const wrongConsultation = {
    id: "wrong",
    consultation_id: "consultation-2",
    asaas_payment_id: "pay_wrong",
    external_reference: invoice.billing_key,
    value: 900,
    due_date: "2026-12-10",
    status: "pending",
  };
  const exact = {
    ...wrongConsultation,
    id: "exact",
    consultation_id: "consultation-1",
    asaas_payment_id: "pay_exact",
  };
  const resolution = resolveInvoicePaymentLink(invoice, [wrongConsultation, exact]);
  assert.equal(resolution.payment?.id, exact.id);
  assert.equal(resolution.strategy, "billing_key");
});

test("recusa conciliacao quando duas cobrancas permanecem igualmente compativeis", () => {
  const invoice = {
    consulta_id: "consultation-1",
    numero_parcela: 2,
    vencimento: "2026-11-08",
    valor: 1_200,
  };
  const candidate = {
    consultation_id: "consultation-1",
    external_reference: "legacy-payment",
    value: 1_200,
    due_date: "2026-11-08",
    status: "pending",
  };
  const resolution = resolveInvoicePaymentLink(invoice, [
    { ...candidate, id: "payment-1", asaas_payment_id: "pay_1" },
    { ...candidate, id: "payment-2", asaas_payment_id: "pay_2" },
  ]);
  assert.equal(resolution.payment, null);
  assert.equal(resolution.ambiguous, true);
});

test("prefere a cobranca aberta quando uma duplicada ja foi cancelada", () => {
  const invoice = {
    consulta_id: "consultation-1",
    numero_parcela: 2,
    vencimento: "2026-11-08",
    valor: 1_200,
  };
  const candidate = {
    consultation_id: "consultation-1",
    external_reference: "legacy-payment",
    value: 1_200,
    due_date: "2026-11-08",
  };
  const resolution = resolveInvoicePaymentLink(
    invoice,
    [
      { ...candidate, id: "cancelled", asaas_payment_id: "pay_old", status: "cancelled" },
      { ...candidate, id: "open", asaas_payment_id: "pay_current", status: "pending" },
    ],
    { preferCandidate: (payment) => payment.status === "pending" },
  );
  assert.equal(resolution.payment?.id, "open");
  assert.equal(resolution.strategy, "due_date");
});

test("migracao libera cartao e protege a reemissao contra repeticao", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20261103190000_card_payment_reissue_idempotency.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /requested_method IN \('boleto', 'pix', 'credit_card'\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS request_key text/);
  assert.match(migration, /CREATE UNIQUE INDEX[\s\S]*request_key/);
});

test("mapeia somente modalidades validas para o Asaas", () => {
  assert.equal(normalizeReissuablePaymentMethod("credit_card"), "credit_card");
  assert.equal(normalizeReissuablePaymentMethod("CREDIT_CARD"), "credit_card");
  assert.equal(normalizeReissuablePaymentMethod("debito"), null);
  assert.equal(asaasBillingTypeForReissue("boleto"), "BOLETO");
  assert.equal(asaasBillingTypeForReissue("pix"), "PIX");
  assert.equal(asaasBillingTypeForReissue("credit_card"), "CREDIT_CARD");
});

test("permite trocar cobranca aberta entre boleto, pix e cartao", () => {
  for (const method of ["boleto", "pix", "credit_card"] as const) {
    assert.equal(
      canReconfigureInvoice({
        invoiceId: "invoice-id",
        status: "pending",
        method,
      }),
      true,
    );
  }
  assert.equal(reconfigurablePaymentMethodLabel("credit_card"), "Cartão de crédito");
  assert.equal(
    canReconfigureInvoice({
      invoiceId: "invoice-id",
      status: "paid",
      method: "credit_card",
    }),
    false,
  );
  assert.equal(
    canReconfigureInvoice({
      invoiceId: "invoice-id",
      status: "processing",
      method: "credit_card",
    }),
    false,
  );
});

test("resumo rapido usa autorizacao canonica e indices de faturamento", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20261103150000_fast_active_tenant_invoice_summaries.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /get_visible_active_tenant_invoice_summaries/);
  assert.match(migration, /public\.can_view_policy\(auth\.uid\(\), policy\.id\)/);
  assert.match(migration, /faturas_inquilino_policy_status_due_idx/);
  assert.match(migration, /faturas_inquilino_consultation_status_due_idx/);
  assert.match(migration, /REVOKE ALL[\s\S]*FROM PUBLIC, anon/);
  assert.match(migration, /TO authenticated, service_role/);
});
