import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeCanonicalTenantInvoices,
  pickNextOpenInvoice,
  pickRecurringInvoiceValue,
  tenantInvoiceInitialBreakdown,
  tenantInvoiceKindLabel,
} from "../src/lib/tenant-invoice-display";

const today = new Date("2026-10-30T12:00:00-03:00");

test("separa cobrança inicial da mensalidade recorrente", () => {
  const rows = normalizeCanonicalTenantInvoices(
    [
      {
        id: "initial",
        numero_parcela: 1,
        installment_total: 36,
        vencimento: "2026-11-15",
        valor: 386.5,
        status: "pending",
        charge_kind: "initial",
        components: { initialAmount: 386.5, monthlyAmount: 236.5 },
      },
      {
        id: "monthly",
        numero_parcela: 2,
        installment_total: 36,
        vencimento: "2026-12-15",
        valor: 236.5,
        status: "scheduled",
        charge_kind: "monthly",
      },
    ],
    today,
  );

  assert.equal(pickRecurringInvoiceValue(rows), 236.5);
  assert.equal(pickNextOpenInvoice(rows)?.id, "initial");
  assert.equal(tenantInvoiceKindLabel(rows[0]), "Cobrança inicial");
  assert.deepEqual(tenantInvoiceInitialBreakdown(rows[0]), {
    monthlyAmount: 236.5,
    initialExtrasAmount: 150,
  });
});

test("marca como vencida apenas uma cobrança aberta anterior ao dia atual", () => {
  const [row] = normalizeCanonicalTenantInvoices(
    [
      {
        id: "late",
        vencimento: "2026-10-15",
        valor: 236.5,
        status: "scheduled",
      },
    ],
    today,
  );
  assert.equal(row.status, "overdue");
});
