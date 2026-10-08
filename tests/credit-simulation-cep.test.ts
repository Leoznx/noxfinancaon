import assert from "node:assert/strict";
import test from "node:test";
import {
  CREDIT_SIMULATION_CEPS,
  selectOperationalCreditSimulationCep,
} from "../src/lib/creditSimulationCep";
import { CREDIT_SIMULATION_CEPS as WORKER_CEPS } from "../automation/creditSimulationCep";

test("mantém o contrato de CEPs técnicos igual ao worker", () => {
  assert.deepEqual(CREDIT_SIMULATION_CEPS, WORKER_CEPS);
  assert.equal(CREDIT_SIMULATION_CEPS.length, 23);
  assert.equal(CREDIT_SIMULATION_CEPS.every((cep) => /^\d{8}$/.test(cep)), true);
});

test("sorteia CEPs nos extremos da lista", () => {
  assert.equal(selectOperationalCreditSimulationCep(() => 0), "88340001");
  assert.equal(
    selectOperationalCreditSimulationCep(() => (CREDIT_SIMULATION_CEPS.length - 0.5) / CREDIT_SIMULATION_CEPS.length),
    "88349899",
  );
});
