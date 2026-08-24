// Modelo oficial de comissionamento do Vendedor interno NOX.
// Não existe valor fixo: o ganho é composto somente por comissão + bônus.
export const MARCOS_BONUS_VENDEDOR = [
  { contratos: 15, rotulo: "15", bonus: 400 },
  { contratos: 30, rotulo: "30", bonus: 600 },
  { contratos: 46, rotulo: "45+", bonus: 1200 },
] as const;

/** Comissão progressiva por contrato fechado no mês. */
export function calcularComissaoContratos(contratos: number): number {
  const total = Math.max(0, Math.floor(contratos));
  const primeiraFaixa = Math.min(total, 15) * 35;
  const segundaFaixa = Math.min(Math.max(total - 15, 0), 10) * 55;
  const terceiraFaixa = Math.max(total - 25, 0) * 75;
  return primeiraFaixa + segundaFaixa + terceiraFaixa;
}

/** Bônus cumulativos por marcos de contratos fechados. */
export function calcularBonus(contratos: number): number {
  let bonus = 0;
  if (contratos >= 15) bonus += 400;
  if (contratos >= 30) bonus += 600;
  if (contratos > 45) bonus += 1200;
  return bonus;
}

export function calcularGanhoTotal(contratos: number) {
  const comissao = calcularComissaoContratos(contratos);
  const bonus = calcularBonus(contratos);
  return {
    comissao,
    bonus,
    total: comissao + bonus,
  };
}

export type NivelComissaoVendedor = {
  nome: "Arranque" | "Aceleração" | "Elite";
  valorPorProximoContrato: number;
  proximoMarco: number | null;
  mensagem: string;
};

/** Texto motivacional compartilhado pelas telas de metas e comissões. */
export function getNivelComissaoVendedor(contratos: number): NivelComissaoVendedor {
  const total = Math.max(0, Math.floor(contratos));
  if (total < 15) {
    const faltam = 15 - total;
    return {
      nome: "Arranque",
      valorPorProximoContrato: 35,
      proximoMarco: 15,
      mensagem: `Faltam ${faltam} ${faltam === 1 ? "contrato" : "contratos"} para liberar o bônus de R$ 400 e avançar de nível.`,
    };
  }
  if (total < 25) {
    const faltam = 25 - total;
    return {
      nome: "Aceleração",
      valorPorProximoContrato: 55,
      proximoMarco: 25,
      mensagem: `Você já conquistou R$ 400 de bônus. Faltam ${faltam} ${faltam === 1 ? "contrato" : "contratos"} para chegar à faixa de R$ 75 por contrato.`,
    };
  }
  if (total < 30) {
    const faltam = 30 - total;
    return {
      nome: "Elite",
      valorPorProximoContrato: 75,
      proximoMarco: 30,
      mensagem: `Faixa máxima por contrato conquistada. Faltam ${faltam} ${faltam === 1 ? "contrato" : "contratos"} para somar mais R$ 600 de bônus.`,
    };
  }
  if (total <= 45) {
    const faltam = 46 - total;
    return {
      nome: "Elite",
      valorPorProximoContrato: 75,
      proximoMarco: 46,
      mensagem: `Você já acumulou R$ 1.000 em bônus. Faltam ${faltam} ${faltam === 1 ? "contrato" : "contratos"} para somar mais R$ 1.200.`,
    };
  }
  return {
    nome: "Elite",
    valorPorProximoContrato: 75,
    proximoMarco: null,
    mensagem: "Nível máximo alcançado: R$ 75 por novo contrato e R$ 2.200 em bônus acumulados.",
  };
}

/** Receita LTV padrão de um contrato de 12 meses a R$ 350 */
export const RECEITA_LTV_CONTRATO = 4200;
