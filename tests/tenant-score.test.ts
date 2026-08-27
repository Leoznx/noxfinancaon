import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateTenantScore,
  TENANT_SCORE_BASE,
  TENANT_SCORE_MAX,
  type TenantScoreInvoice,
} from "../src/lib/tenant-score";

const TODAY = new Date(2026, 7, 26);

function invoice(
  id: string,
  dueDate: string,
  status = "overdue",
  paidAt: string | null = null,
): TenantScoreInvoice {
  return { id, dueDate, status, paidAt };
}

test("cadastro sem parcelas começa com 824 pontos", () => {
  const result = calculateTenantScore([], TODAY);
  assert.equal(result.score, TENANT_SCORE_BASE);
  assert.equal(result.earnedPoints, 0);
  assert.equal(result.lostPoints, 0);
});

test("pagamento antecipado e no vencimento respeitam as faixas", () => {
  const rows = [
    invoice("early", "2026-08-20", "paid", "2026-08-18T12:00:00Z"),
    invoice("on-time", "2026-08-20", "confirmed", "2026-08-20T12:00:00Z"),
  ];
  const first = calculateTenantScore(rows, TODAY);
  const second = calculateTenantScore(rows, TODAY);
  assert.deepEqual(first, second);
  assert.ok(first.events[0].points >= 15 && first.events[0].points <= 22);
  assert.ok(first.events[1].points >= 7 && first.events[1].points <= 22);
  assert.equal(first.score, TENANT_SCORE_BASE + first.earnedPoints);
});

test("atrasos usam as quatro faixas acumuladas no resultado", () => {
  const result = calculateTenantScore(
    [
      invoice("late-1", "2026-08-25"),
      invoice("late-4", "2026-08-22"),
      invoice("late-6", "2026-08-20"),
      invoice("late-31", "2026-07-26"),
    ],
    TODAY,
  );
  const lossFor = (kind: (typeof result.events)[number]["kind"]) =>
    Math.abs(result.events.find((event) => event.kind === kind)?.points ?? 0);
  const losses = result.events.map((event) => Math.abs(event.points));
  assert.ok(lossFor("late_1_3") >= 15 && lossFor("late_1_3") <= 21);
  assert.ok(lossFor("late_4_5") >= 21 && lossFor("late_4_5") <= 56);
  assert.ok(lossFor("late_6_30") >= 56 && lossFor("late_6_30") <= 123);
  assert.ok(lossFor("late_over_30") >= 123 && lossFor("late_over_30") <= 342);
  assert.equal(result.lostPoints, losses.reduce((sum, value) => sum + value, 0));
  assert.equal(result.score, Math.max(0, TENANT_SCORE_BASE - result.lostPoints));
});

test("ganhos nunca ultrapassam 950 pontos", () => {
  const rows = Array.from({ length: 20 }, (_, index) =>
    invoice(
      `early-${index}`,
      `2026-${String((index % 8) + 1).padStart(2, "0")}-20`,
      "paid",
      `2026-${String((index % 8) + 1).padStart(2, "0")}-10T12:00:00Z`,
    ),
  );
  assert.equal(calculateTenantScore(rows, TODAY).score, TENANT_SCORE_MAX);
});
