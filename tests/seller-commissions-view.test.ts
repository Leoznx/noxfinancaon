import assert from "node:assert/strict";
import test from "node:test";
import {
  filterCommissionHistory,
  getCommissionCustomerName,
  getCommissionEntryAmount,
  summarizeCommissions,
  type SellerCommissionRow,
} from "../src/lib/seller-commissions-view";

function row(overrides: Partial<SellerCommissionRow>): SellerCommissionRow {
  const now = new Date();
  return {
    id: "commission",
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    commission_amount: 35,
    bonus_amount: 0,
    reserve_amount: 5.25,
    released_amount: 29.75,
    status: "retida",
    created_at: "2026-08-20T12:00:00.000Z",
    released_at: null,
    reserve_release_at: null,
    apolice_id: "policy",
    contract_id: "policy",
    apolices: null,
    ...overrides,
  };
}

test("resume os valores financeiros sem arredondamento manual", () => {
  assert.deepEqual(
    summarizeCommissions([
      row({ id: "a" }),
      row({
        id: "b",
        commission_amount: 55,
        bonus_amount: 400,
        reserve_amount: 8.25,
        released_amount: 46.75,
      }),
    ]),
    { contratos: 2, comissao: 90, bonus: 400, total: 490 },
  );
});

test("filtra período e estados conforme os status financeiros reais", () => {
  const rows = [
    row({ id: "retained-current", month: 8, year: 2026 }),
    row({ id: "paid-current", month: 8, year: 2026, status: "liberada_total" }),
    row({ id: "previous", month: 7, year: 2026, status: "liberada_total" }),
    row({ id: "old", month: 1, year: 2026 }),
  ];
  const reference = new Date(2026, 7, 24);
  assert.deepEqual(
    filterCommissionHistory(rows, "paid", "current", reference).map((item) => item.id),
    ["paid-current"],
  );
  assert.deepEqual(
    filterCommissionHistory(rows, "retained", "current", reference).map((item) => item.id),
    ["retained-current"],
  );
  assert.deepEqual(
    filterCommissionHistory(rows, "all", "previous", reference).map((item) => item.id),
    ["previous"],
  );
  assert.deepEqual(
    filterCommissionHistory(rows, "all", "year", reference).map((item) => item.id),
    rows.map((item) => item.id),
  );
});

test("calcula a entrada pelo valor liberado e soma a bonificação", () => {
  assert.equal(
    getCommissionEntryAmount(
      row({ released_amount: 29.75, commission_amount: 35, bonus_amount: 400 }),
    ),
    435,
  );
  assert.equal(
    getCommissionEntryAmount(row({ released_amount: 0, commission_amount: 55, bonus_amount: 0 })),
    55,
  );
});

test("prioriza o nome real informado na consulta da apólice", () => {
  assert.equal(
    getCommissionCustomerName(
      row({
        apolices: {
          numero: "NOX-1",
          status: "ativa",
          consulta: {
            tenant_name: "João Silva",
            inquilino: { nome: "Nome antigo", razao_social: null },
          },
        },
      }),
    ),
    "João Silva",
  );
});
