import assert from "node:assert/strict";
import test from "node:test";

import {
  DEMO_CAREER_ACTIVE_CONTRACTS,
  DEMO_CAREER_ROLES,
  getDemoCareerScenario,
} from "../src/lib/demo-career";

test("todas as contas demo com plano aparecem no nível Prata com 15 contratos", () => {
  for (const role of DEMO_CAREER_ROLES) {
    const scenario = getDemoCareerScenario(role);
    assert.ok(scenario);
    assert.equal(scenario.activeContracts, DEMO_CAREER_ACTIVE_CONTRACTS);
    assert.equal(scenario.currentLevel.nome_nivel, "PRATA");
    assert.equal(scenario.nextLevel?.nome_nivel, "OURO");
    assert.equal(scenario.remainingContracts, 6);
    assert.equal(scenario.progressPercent, 40);
  }
});

test("a conta demo do inquilino continua sem plano de carreira", () => {
  assert.equal(getDemoCareerScenario("inquilino"), null);
});
