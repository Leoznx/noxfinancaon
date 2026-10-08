import assert from "node:assert/strict";
import test from "node:test";
import {
  CREDIT_SIMULATION_CEPS,
  selectRandomCreditSimulationCep,
} from "./creditSimulationCep";

test("mantém os CEPs operacionais válidos e sem duplicidade", () => {
  assert.equal(CREDIT_SIMULATION_CEPS.length, 23);
  assert.equal(new Set(CREDIT_SIMULATION_CEPS).size, CREDIT_SIMULATION_CEPS.length);
  assert.equal(CREDIT_SIMULATION_CEPS.every((cep) => /^\d{8}$/.test(cep)), true);
});

test("sorteia qualquer posição da lista", () => {
  assert.equal(selectRandomCreditSimulationCep(() => 0), "88340001");
  assert.equal(
    selectRandomCreditSimulationCep(() => CREDIT_SIMULATION_CEPS.length - 1),
    "88349899",
  );
});
