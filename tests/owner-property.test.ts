import assert from "node:assert/strict";
import test from "node:test";

import {
  EMPTY_OWNER_PROPERTY,
  normalizeCep,
  ownerPropertyTotalCents,
  validateOwnerProperty,
} from "../src/lib/owner-property";

const validProperty = {
  ...EMPTY_OWNER_PROPERTY,
  cep: "13010-111",
  street: "Rua das Flores",
  number: "120",
  neighborhood: "Centro",
  city: "Campinas",
  state: "SP",
  rentCents: 250_000,
};

test("normaliza o CEP sem aceitar mais de oito dígitos", () => {
  assert.equal(normalizeCep("13010111"), "13010-111");
  assert.equal(normalizeCep("13.010-11199"), "13010-111");
});

test("valida os campos obrigatórios e encargos condicionais", () => {
  assert.equal(validateOwnerProperty(validProperty), null);
  assert.equal(
    validateOwnerProperty({ ...validProperty, hasCondominium: true }),
    "Informe o valor do condomínio.",
  );
  assert.equal(
    validateOwnerProperty({ ...validProperty, hasIptu: true }),
    "Informe o valor do IPTU.",
  );
});

test("soma apenas os encargos habilitados", () => {
  assert.equal(
    ownerPropertyTotalCents({
      ...validProperty,
      hasCondominium: true,
      condominiumCents: 45_000,
      reserveFundCents: 5_000,
      garbageFeeCents: 1_500,
      hasIptu: true,
      iptuCents: 12_000,
    }),
    313_500,
  );
  assert.equal(
    ownerPropertyTotalCents({ ...validProperty, condominiumCents: 45_000, iptuCents: 12_000 }),
    250_000,
  );
});
