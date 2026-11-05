import assert from "node:assert/strict";
import test from "node:test";
import {
  calcularBonus,
  calcularComissaoContratos,
  calcularGanhoTotal,
  getNivelComissaoVendedor,
} from "../src/lib/comissao-vendedor";

// Regra registrada em bc26aba e em 20261006170000_seller_monthly_payroll_commissions.sql.
test("aplica as faixas mensais de R$ 25, R$ 35 e R$ 45 por contrato", () => {
  for (const [contracts, expected] of [
    [0, 0],
    [1, 25],
    [14, 350],
    [15, 375],
    [16, 410],
    [25, 725],
    [26, 770],
    [46, 1670],
  ]) {
    assert.equal(calcularComissaoContratos(contracts), expected, `${contracts} contratos`);
  }
});

test("soma os bônus cumulativos exatamente nos marcos 15, 30 e 45", () => {
  for (const [contracts, expected] of [
    [14, 0],
    [15, 400],
    [29, 400],
    [30, 1000],
    [44, 1000],
    [45, 2200],
    [46, 2200],
  ]) {
    assert.equal(calcularBonus(contracts), expected, `${contracts} contratos`);
  }
});

test("o total não inclui valor fixo", () => {
  assert.deepEqual(calcularGanhoTotal(0), { comissao: 0, bonus: 0, total: 0 });
  assert.deepEqual(calcularGanhoTotal(15), { comissao: 375, bonus: 400, total: 775 });
});

test("indica o próximo nível e o nível máximo", () => {
  assert.equal(getNivelComissaoVendedor(0).nome, "Arranque");
  assert.equal(getNivelComissaoVendedor(16).nome, "Aceleração");
  assert.equal(getNivelComissaoVendedor(26).nome, "Elite");
  assert.equal(getNivelComissaoVendedor(46).proximoMarco, null);
});
