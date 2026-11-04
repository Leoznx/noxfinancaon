import assert from "node:assert/strict";
import test from "node:test";

import { inferDemoPixKeyType, maskDemoPixKey } from "../src/lib/demo-withdrawal";

test("a simulação detecta o tipo de chave sem pedir um campo adicional", () => {
  assert.equal(inferDemoPixKeyType("financeiro@demo.nox"), "EMAIL");
  assert.equal(inferDemoPixKeyType("390.482.760-18"), "CPF");
  assert.equal(inferDemoPixKeyType("+55 47 99999-1004"), "PHONE");
  assert.equal(inferDemoPixKeyType("2dd85280-6807-4ef3-b823-799a0b55db8f"), "RANDOM");
});

test("a chave Pix simulada fica mascarada no histórico", () => {
  assert.equal(maskDemoPixKey("financeiro@demo.nox"), "fin••••nox");
  assert.equal(maskDemoPixKey("123"), "••••••");
});
