import assert from "node:assert/strict";
import test from "node:test";
import { getDemoCareer } from "../src/lib/demo-career.ts";

for (const role of ["corretor", "imobiliaria", "proprietario"]) {
  test(`carreira demo ${role}: Prata, 15 contratos e progresso até Ouro`, () => {
    const career = getDemoCareer({ role, email: `${role}@nox.com` }, true);
    assert.ok(career);
    assert.equal(career.activeContracts, 15);
    const current = career.levels.find(
      (level) =>
        career.activeContracts >= level.min_contratos &&
        (level.max_contratos === null || career.activeContracts <= level.max_contratos),
    );
    const next = career.levels.find((level) => level.min_contratos > career.activeContracts);
    assert.ok(current && next);
    assert.equal(current.nome_nivel, "PRATA");
    assert.equal(next.nome_nivel, "OURO");
    assert.equal(next.min_contratos - career.activeContracts, 6);
    assert.equal(
      ((career.activeContracts - current.min_contratos) /
        (next.min_contratos - current.min_contratos)) *
        100,
      40,
    );
  });

  test(`conta real ${role} não recebe cenário demo, mesmo com marcador residual`, () => {
    assert.equal(getDemoCareer({ role, email: "cliente@example.com" }, true), null);
    assert.equal(getDemoCareer({ role, email: `${role}@nox.com` }, false), null);
    assert.equal(getDemoCareer({ role, email: null }, true), null);
  });
}

test("exige identidade correspondente ao perfil e não oferece carreira ao inquilino", () => {
  assert.equal(getDemoCareer({ role: "corretor", email: "imobiliaria@nox.com" }, true), null);
  assert.equal(getDemoCareer({ role: "inquilino", email: "inquilino@nox.com" }, true), null);
  assert.equal(getDemoCareer({ role: "admin", email: "corretor@nox.com" }, true), null);
  assert.equal(getDemoCareer(null, true), null);
});

test("normaliza email e deixa de fornecer cenário ao sair da demonstração", () => {
  const user = { role: "corretor", email: " CORRETOR@NOX.COM " };
  assert.equal(getDemoCareer(user, true)?.activeContracts, 15);
  assert.equal(getDemoCareer(user, false), null);
  assert.equal(getDemoCareer({ ...user, email: "real@example.com" }, true), null);
});
