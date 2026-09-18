import assert from "node:assert/strict";
import test from "node:test";

import { getSellerClientActivityStatus } from "../src/lib/seller-clients";

test("prioriza contrato ativo no resumo do cliente", () => {
  assert.equal(
    getSellerClientActivityStatus({
      active_contract_count: 1,
      weekly_consultation_count: 2,
      total_consultation_count: 4,
    }),
    "active_contract",
  );
});

test("diferencia consulta semanal, historica e cliente sem consulta", () => {
  assert.equal(
    getSellerClientActivityStatus({
      active_contract_count: 0,
      weekly_consultation_count: 1,
      total_consultation_count: 1,
    }),
    "consulted_this_week",
  );
  assert.equal(
    getSellerClientActivityStatus({
      active_contract_count: 0,
      weekly_consultation_count: 0,
      total_consultation_count: 3,
    }),
    "inactive_this_week",
  );
  assert.equal(
    getSellerClientActivityStatus({
      active_contract_count: 0,
      weekly_consultation_count: 0,
      total_consultation_count: 0,
    }),
    "never_consulted",
  );
});
