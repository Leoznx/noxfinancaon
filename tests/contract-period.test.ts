import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTRACT_PERIOD_OPTIONS,
  formatContractPeriodMonths,
  normalizeContractPeriodMonths,
  resolveContractPeriodMonths,
} from "../src/lib/contract-period";

test("aceita os periodos sugeridos e um valor inteiro personalizado", () => {
  assert.deepEqual(CONTRACT_PERIOD_OPTIONS, [6, 12, 24, 36]);
  assert.equal(normalizeContractPeriodMonths("48"), 48);
  assert.equal(normalizeContractPeriodMonths(120), 120);
});

test("rejeita periodo vazio, fracionario ou fora do intervalo operacional", () => {
  assert.equal(normalizeContractPeriodMonths(""), null);
  assert.equal(normalizeContractPeriodMonths("12.5"), null);
  assert.equal(normalizeContractPeriodMonths(0), null);
  assert.equal(normalizeContractPeriodMonths(121), null);
});

test("aplica 12 meses somente como fallback para contratos legados", () => {
  assert.equal(resolveContractPeriodMonths(null), 12);
  assert.equal(resolveContractPeriodMonths(24), 24);
});

test("formata corretamente singular e plural", () => {
  assert.equal(formatContractPeriodMonths(1), "1 mês");
  assert.equal(formatContractPeriodMonths(18), "18 meses");
});
