import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  reissuedInvoiceDueDate,
} from "../supabase/functions/_shared/billing-automation.ts";
import {
  nextInvoiceDueDate,
  normalizePaymentDueDay,
} from "../src/lib/payment-due-date.ts";

test("reagenda na competencia original quando ela ainda esta no futuro", () => {
  assert.equal(
    reissuedInvoiceDueDate("2026-12-10", 25, "2026-11-03"),
    "2026-12-25",
  );
  assert.equal(
    nextInvoiceDueDate("2026-12-10", 25, "2026-11-03"),
    "2026-12-25",
  );
});

test("cobranca vencida usa a proxima data permitida", () => {
  assert.equal(
    reissuedInvoiceDueDate("2026-10-10", 5, "2026-11-03"),
    "2026-11-05",
  );
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
