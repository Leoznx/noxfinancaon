import assert from "node:assert/strict";
import test from "node:test";

import { billingAccountCopy } from "../src/lib/billing-account";

test("usa o nome da imobiliaria quando a conta e imobiliaria", () => {
  assert.deepEqual(billingAccountCopy("imobiliaria"), {
    role: "imobiliaria",
    title: "Imobiliária",
    subject: "A imobiliária",
    dataOwner: "da imobiliária",
  });
});

test("usa o nome do corretor quando a conta e corretor", () => {
  assert.equal(billingAccountCopy("corretor").title, "Corretor");
  assert.equal(billingAccountCopy("corretor").dataOwner, "do corretor");
});

test("usa o nome do proprietario quando a conta e proprietario", () => {
  assert.equal(billingAccountCopy("proprietario").title, "Proprietário");
  assert.equal(billingAccountCopy("proprietario").subject, "O proprietário");
});
