import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  demoCareerSimulation as career,
  demoCareerRoles,
} from "../src/lib/demo-career-simulation.ts";
test("local career matches silver progression without storage markers", () => {
  assert.equal(career.activeContracts, 15);
  assert.equal(career.currentLevel, "PRATA");
  assert.equal(career.progress, 40);
  assert.equal(career.remainingContracts, 6);
  assert.deepEqual(demoCareerRoles, ["corretor", "imobiliaria", "proprietario"]);
  assert.equal(
    career.levels.find((x) => x.name === "OURO").minimum - career.activeContracts,
    career.remainingContracts,
  );
  assert.doesNotMatch(
    readFileSync(new URL("../src/lib/demo-career-simulation.ts", import.meta.url), "utf8"),
    /import|fetch\(|Storage|supabase/i,
  );
});
test("combined career PR keeps identical synthetic thresholds and count", async (t) => {
  const file = new URL("../src/lib/demo-career.ts", import.meta.url);
  if (!existsSync(file)) { t.skip("Career PR is tested in the combined checkout"); return; }
  const { getDemoCareer } = await import(file.href);
  for (const role of demoCareerRoles) {
    const fixture = getDemoCareer({ email: `${role}@nox.com`, role }, true);
    assert.equal(fixture.activeContracts, career.activeContracts);
    assert.deepEqual(
      fixture.levels.map((n) => [
        n.nome_nivel,
        n.min_contratos,
        n.max_contratos,
        n.percentual_comissao,
      ]),
      career.levels.map((n) => [n.name, n.minimum, n.maximum, n.commission]),
    );
  }
});
