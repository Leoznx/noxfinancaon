import assert from "node:assert/strict";
import test from "node:test";
import {
  calcularBonus,
  calcularComissaoContratos,
  calcularGanhoTotal,
  getNivelComissaoVendedor,
} from "../src/lib/comissao-vendedor";

test("aplica as três faixas progressivas por contrato", () => {
  assert.equal(calcularComissaoContratos(0), 0);
  assert.equal(calcularComissaoContratos(1), 35);
  assert.equal(calcularComissaoContratos(15), 525);
  assert.equal(calcularComissaoContratos(16), 580);
  assert.equal(calcularComissaoContratos(25), 1_075);
  assert.equal(calcularComissaoContratos(26), 1_150);
  assert.equal(calcularComissaoContratos(46), 2_650);
});

test("soma os bônus nos marcos 15, 30 e acima de 45", () => {
  assert.equal(calcularBonus(14), 0);
  assert.equal(calcularBonus(15), 400);
  assert.equal(calcularBonus(30), 1_000);
  assert.equal(calcularBonus(45), 1_000);
  assert.equal(calcularBonus(46), 2_200);
});

test("o total não inclui valor fixo", () => {
  assert.deepEqual(calcularGanhoTotal(15), { comissao: 525, bonus: 400, total: 925 });
});

test("indica o próximo nível e o nível máximo", () => {
  assert.equal(getNivelComissaoVendedor(0).nome, "Arranque");
  assert.equal(getNivelComissaoVendedor(16).nome, "Aceleração");
  assert.equal(getNivelComissaoVendedor(26).nome, "Elite");
  assert.equal(getNivelComissaoVendedor(46).proximoMarco, null);
});
