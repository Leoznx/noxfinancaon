import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  advanceSimulation,
  startSimulation,
  isSimulationCandidate,
  verifySimulationIdentity,
} from "../src/lib/demo-simulation.ts";

for (const role of ["proprietario", "corretor", "imobiliaria", "inquilino"]) {
  test(`${role}: verified demo completes without any network or persistence`, async () => {
    const user = { id: `test-${role}`, role, email: `${role}@nox.com` };
    assert.equal(await verifySimulationIdentity(user, async () => user), true);
    const previousFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw Error("Forbidden network");
    };
    try {
      let state = startSimulation();
      for (const expected of ["documentos", "contrato", "fatura", "recibo"]) {
        state = advanceSimulation(state);
        assert.equal(state.stage, expected);
      }
      assert.equal(state.history.length, 4);
      assert.deepEqual(advanceSimulation(state), state);
      assert.equal(startSimulation().history.length, 0);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
}
test("real account with residual demo marker never becomes eligible", async () => {
  const user = { id: "real-user", email: "real@example.com", role: "corretor", demo: true };
  assert.equal(isSimulationCandidate(user), false);
  assert.equal(
    await verifySimulationIdentity(user, async () => {
      throw Error("Should not read identity");
    }),
    false,
  );
});
test("verification denies forged cached identity, wrong subject, role, email and expired session", async () => {
  const expected = { id: "demo-user", role: "corretor", email: "corretor@nox.com" };
  for (const actual of [
    null,
    { ...expected, id: "other-user" },
    { ...expected, role: "admin" },
    { ...expected, email: "real@example.com" },
  ]) {
    assert.equal(await verifySimulationIdentity(expected, async () => actual), false);
  }
});
for (const scenario of ["recusado", "pendente"]) {
  test(`${scenario}: cannot advance to contract or billing`, () => {
    let state = startSimulation(scenario);
    for (let n = 0; n < 8; n++) state = advanceSimulation(state);
    assert.equal(state.stage, "analise");
    assert.equal(state.history.length, 1);
  });
}
test("simulator domain has no integration or persistence imports", () => {
  const source = readFileSync(new URL("../src/lib/demo-simulation.ts", import.meta.url), "utf8");
  assert.doesNotMatch(
    source,
    /\bimport\b|fetch\(|localStorage|sessionStorage|supabase|https?:\/\//,
  );
});

test("legacy demo writer fails before backend access", () => {
  const source = readFileSync(new URL("../src/lib/consultasCredito.ts", import.meta.url), "utf8");
  const body = source
    .split("export async function criarConsultaDemonstrativa(")[1]
    .split("\nexport async function ")[0];
  assert.match(body, /throw new Error/);
  assert.doesNotMatch(body, /supabase|upsertConsultaCredito|return criarConsultaParaAutomacao/);
});
