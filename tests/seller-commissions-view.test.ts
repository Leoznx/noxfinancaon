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
  return {
    id: "commission",
    month: 8,
    year: 2026,
    commission_amount: 35,
    bonus_amount: 0,
    reserve_amount: 5.25,
    released_amount: 29.75,
    status: "retida",
    created_at: "2026-08-20T12:00:00.000Z",
    eligible_at: null,
    client_name: null,
    paid_at: null,
    counted_at: null,
    contract_sequence: null,
    released_at: null,
    reserve_release_at: null,
    apolice_id: "policy",
    contract_id: "policy",
    apolices: null,
    ...overrides,
  };
}

// bc26aba mudou o resumo para a competência atual e total de comissão + bônus.
test("resume comissão e bônus apenas da competência atual", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 7, 24, 12) });
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

test("resumo exclui outras competências e estados fora da folha, inclusive na virada do ano", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2027, 0, 15, 12) });
  const rows = [
    row({
      id: "current",
      month: 1,
      year: 2027,
      status: "contabilizada",
      commission_amount: 25.25,
      bonus_amount: 0.5,
    }),
    row({
      id: "current-paid",
      month: 1,
      year: 2027,
      status: "paga",
      commission_amount: 35.5,
      bonus_amount: 0.25,
    }),
    row({ id: "previous-month", month: 12, year: 2026 }),
    row({ id: "same-month-previous-year", month: 1, year: 2026 }),
    row({ id: "future", month: 2, year: 2027 }),
    ...["pendente", "aguardando_primeira_parcela", "elegivel", "estornada", "cancelada"].map(
      (status) => row({ id: status, month: 1, year: 2027, status }),
    ),
  ];
  assert.deepEqual(summarizeCommissions(rows), {
    contratos: 2,
    comissao: 60.75,
    bonus: 0.75,
    total: 61.5,
  });
  assert.deepEqual(summarizeCommissions([]), {
    contratos: 0,
    comissao: 0,
    bonus: 0,
    total: 0,
  });
});

test("filtra período e estados conforme os status financeiros reais", () => {
  const rows = [
    row({ id: "retained-current" }),
    row({ id: "paid-current", status: "liberada_total" }),
    row({ id: "previous", month: 7, status: "liberada_total" }),
    row({ id: "old", month: 1 }),
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

test("calcula a entrada pela comissão integral e bônus, independentemente da liberação", () => {
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
