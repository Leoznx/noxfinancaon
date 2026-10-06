import assert from "node:assert/strict";
import test from "node:test";

import {
  calcularBonus,
  calcularComissaoContratos,
  calcularGanhoTotal,
} from "../src/lib/comissao-vendedor";

test("aplica as faixas progressivas por contrato dentro do mês", () => {
  assert.equal(calcularComissaoContratos(0), 0);
  assert.equal(calcularComissaoContratos(1), 25);
  assert.equal(calcularComissaoContratos(15), 375);
  assert.equal(calcularComissaoContratos(16), 410);
  assert.equal(calcularComissaoContratos(25), 725);
  assert.equal(calcularComissaoContratos(26), 770);
  assert.equal(calcularComissaoContratos(45), 1625);
});

test("soma os bônus cumulativos exatamente nos marcos", () => {
  assert.equal(calcularBonus(14), 0);
  assert.equal(calcularBonus(15), 400);
  assert.equal(calcularBonus(29), 400);
  assert.equal(calcularBonus(30), 1000);
  assert.equal(calcularBonus(44), 1000);
  assert.equal(calcularBonus(45), 2200);
});

test("total mensal combina comissão base e bônus", () => {
  assert.deepEqual(calcularGanhoTotal(45), {
    comissao: 1625,
    bonus: 2200,
    total: 3825,
  });
});
