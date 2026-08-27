import assert from "node:assert/strict";
import test from "node:test";

import { filterMonthlyRevenue, normalizeOwnerDashboard } from "../src/lib/owner-dashboard";

test("normaliza o contrato da RPC sem inventar percentuais", () => {
  const data = normalizeOwnerDashboard({
    summary: {
      property_count: "3",
      current_month_received: "1250.50",
      month_change_percent: null,
    },
    monthly_revenue: [{ month_start: "2026-08-01", amount: "1250.50" }],
  });

  assert.equal(data.summary.propertyCount, 3);
  assert.equal(data.summary.currentMonthReceived, 1250.5);
  assert.equal(data.summary.monthChangePercent, null);
  assert.equal(data.monthlyRevenue[0]?.amount, 1250.5);
  assert.deepEqual(data.contracts, []);
});

test("filtra 3, 6, ano corrente e 12 meses a partir da mesma leitura", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    monthStart: new Date(2025, 8 + index, 1).toISOString().slice(0, 10),
    amount: index + 1,
  }));

  assert.equal(filterMonthlyRevenue(rows, "3", new Date(2026, 7, 1)).length, 3);
  assert.equal(filterMonthlyRevenue(rows, "6", new Date(2026, 7, 1)).length, 6);
  assert.equal(filterMonthlyRevenue(rows, "12", new Date(2026, 7, 1)).length, 12);
  assert.equal(filterMonthlyRevenue(rows, "year", new Date(2026, 7, 1)).length, 8);
});
