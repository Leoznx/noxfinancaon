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
  assert.match(source, /asaasBillingTypeForReissue\(method\)/);
  assert.match(source, /payment_method: method/);
  assert.match(source, /boleto_url:[\s\S]*method === "boleto"[\s\S]*: null/);
  assert.match(source, /pix_copy_paste: method === "pix"[\s\S]*: null/);
  assert.match(source, /request_key: requestKey/);
  assert.match(source, /notificationType: `payment_reissued:\$\{audit\.id\}`/);
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
