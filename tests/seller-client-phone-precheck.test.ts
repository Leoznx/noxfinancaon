import assert from "node:assert/strict";
import test from "node:test";
import {
  formatBrazilianPhoneInput,
  isValidBrazilianPhone,
  normalizeBrazilianPhone,
} from "../src/lib/seller-clients";

test("normaliza telefone nacional e remove o código 55 quando informado", () => {
  assert.equal(normalizeBrazilianPhone("(47) 99972-2251"), "47999722251");
  assert.equal(normalizeBrazilianPhone("+55 (47) 99972-2251"), "47999722251");
});

test("formata telefone com DDD enquanto o vendedor digita", () => {
  assert.equal(formatBrazilianPhoneInput("47999722251"), "(47) 99972-2251");
  assert.equal(formatBrazilianPhoneInput("4733224455"), "(47) 3322-4455");
});

test("aceita somente telefones brasileiros completos com DDD", () => {
  assert.equal(isValidBrazilianPhone("(47) 99972-2251"), true);
  assert.equal(isValidBrazilianPhone("(47) 3322-4455"), true);
  assert.equal(isValidBrazilianPhone("99972-2251"), false);
  assert.equal(isValidBrazilianPhone("479997222511"), false);
  assert.equal(isValidBrazilianPhone("(00) 99972-2251"), false);
});
