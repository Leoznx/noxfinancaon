import assert from "node:assert/strict";
import test from "node:test";
import { createCreditSimulationOperationKey } from "../src/lib/credit-simulation-idempotency";

const input = {
  tenantType: "PF",
  tenantName: "Maria da Silva",
  tenantDocument: "111.444.777-35",
  propertyType: "Residencial",
  propertyZip: "01310-100",
  propertyCity: "São Paulo",
  propertyState: "SP",
  propertyAddress: "São Paulo, SP",
  rentValue: 2500,
  condominiumValue: 450,
  feeValue: 120,
};

test("duplo clique e nova aba usam a mesma operação dentro da janela", () => {
  const first = createCreditSimulationOperationKey(input, Date.UTC(2026, 9, 16, 12, 1));
  const second = createCreditSimulationOperationKey(input, Date.UTC(2026, 9, 16, 12, 9));
  assert.equal(first.idempotencyKey, second.idempotencyKey);
  assert.match(first.idempotencyKey, /^[0-9a-f-]{36}$/i);
  assert.doesNotMatch(first.idempotencyKey, /11144477735/);
});

test("payload incompatível produz outra identidade de operação", () => {
  const first = createCreditSimulationOperationKey(input, Date.UTC(2026, 9, 16, 12, 1));
  const changed = createCreditSimulationOperationKey(
    { ...input, rentValue: input.rentValue + 1 },
    Date.UTC(2026, 9, 16, 12, 1),
  );
  assert.notEqual(first.fingerprint, changed.fingerprint);
  assert.notEqual(first.idempotencyKey, changed.idempotencyKey);
});

test("uma nova operação pode ser criada em outra janela temporal", () => {
  const first = createCreditSimulationOperationKey(input, Date.UTC(2026, 9, 16, 12, 1));
  const later = createCreditSimulationOperationKey(input, Date.UTC(2026, 9, 16, 12, 31));
  assert.equal(first.fingerprint, later.fingerprint);
  assert.notEqual(first.idempotencyKey, later.idempotencyKey);
});
