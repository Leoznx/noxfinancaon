// Modelo oficial de comissionamento do Vendedor interno NOX
// Salário fixo informativo
export const SALARIO_FIXO_VENDEDOR = 1800;
export const META_PADRAO_VENDEDOR = 20;

/** Comissão escalonada por contratos válidos no mês */
export function calcularComissaoContratos(contratos: number): number {
  if (contratos <= 9) return 0;
  if (contratos <= 13) return contratos * 25;
  if (contratos <= 19) return contratos * 35;
  return 20 * 50 + (contratos - 20) * 80;
}

/** Bônus por marcos de contratos */
export function calcularBonus(contratos: number): number {
  let bonus = 0;
  if (contratos >= 20) bonus += 300;
  if (contratos >= 30) bonus += 600;
  if (contratos >= 40) bonus += 1000;
  return bonus;
}

export function calcularGanhoTotal(contratos: number) {
  const comissao = calcularComissaoContratos(contratos);
  const bonus = calcularBonus(contratos);
  return {
    salarioFixo: SALARIO_FIXO_VENDEDOR,
    comissao,
    bonus,
    total: SALARIO_FIXO_VENDEDOR + comissao + bonus,
  };
}

/** Receita LTV padrão de um contrato de 12 meses a R$ 350 */
export const RECEITA_LTV_CONTRATO = 4200;
