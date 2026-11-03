import assert from "node:assert/strict";
import test from "node:test";
import { contractBrokerLabel } from "../src/lib/contract-broker-label";

test("exibe o nome do corretor que originou a consulta", () => {
  assert.equal(
    contractBrokerLabel({
      directBrokerName: null,
      requesterName: "  Maria Corretora  ",
      requesterRole: "corretor",
    }),
    "Maria Corretora",
  );
});

test("identifica quando a própria imobiliária originou a consulta", () => {
  assert.equal(
    contractBrokerLabel({
      requesterName: "Alcance Imóveis",
      requesterRole: "imobiliaria",
    }),
    "Fez pela imobiliária",
  );

  assert.equal(
    contractBrokerLabel({
      requesterProfileId: "profile-imobiliaria",
      agencyProfileId: "profile-imobiliaria",
    }),
    "Fez pela imobiliária",
  );
});

test("preserva o corretor legado e o fallback quando a origem não é conclusiva", () => {
  assert.equal(
    contractBrokerLabel({ directBrokerName: "Corretor Legado" }),
    "Corretor Legado",
  );
  assert.equal(contractBrokerLabel({}), "Corretor não informado");
});
