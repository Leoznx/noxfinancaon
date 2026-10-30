// Modelo oficial de comissionamento do Vendedor interno NOX.
// Não existe valor fixo: o ganho é composto somente por comissão + bônus.
export const MARCOS_BONUS_VENDEDOR = [
  { contratos: 15, rotulo: "15", bonus: 400 },
  { contratos: 30, rotulo: "30", bonus: 600 },
  { contratos: 45, rotulo: "45", bonus: 1200 },
] as const;

/** Comissão progressiva por contrato fechado no mês. */
export function calcularComissaoContratos(contratos: number): number {
  const total = Math.max(0, Math.floor(contratos));
  const primeiraFaixa = Math.min(total, 15) * 25;
  const segundaFaixa = Math.min(Math.max(total - 15, 0), 10) * 35;
  const terceiraFaixa = Math.max(total - 25, 0) * 45;
  return primeiraFaixa + segundaFaixa + terceiraFaixa;
}

/** Bônus cumulativos por marcos de contratos fechados. */
export function calcularBonus(contratos: number): number {
  let bonus = 0;
  if (contratos >= 15) bonus += 400;
  if (contratos >= 30) bonus += 600;
  if (contratos >= 45) bonus += 1200;
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

export type DesempenhoComissaoVendedor = {
  inicioFaixa: number;
  metaFaixa: number;
  realizadosNaFaixa: number;
  totalNaFaixa: number;
  percentual: number;
  faltam: number;
  situacao:
    | "Início da faixa"
    | "Construindo ritmo"
    | "Ritmo consistente"
    | "Perto da conquista"
    | "Faixa conquistada";
  proximaConquista: string;
  nivelMaximo: boolean;
};

/**
 * Representa o avanço dentro da faixa atual. Diferente do total bruto do mês,
 * esse percentual não superestima nem subestima o desempenho depois de uma
 * promoção: ao chegar à Aceleração, por exemplo, a régua passa a medir 15→25.
 */
export function getDesempenhoComissaoVendedor(contratos: number): DesempenhoComissaoVendedor {
  const total = Math.max(0, Math.floor(contratos));
  const faixa =
    total < 15
      ? { inicio: 0, meta: 15, conquista: "Bônus de R$ 400" }
      : total < 25
        ? { inicio: 15, meta: 25, conquista: "R$ 45 por contrato" }
        : total < 30
          ? { inicio: 25, meta: 30, conquista: "Mais R$ 600 de bônus" }
          : total < 45
            ? { inicio: 30, meta: 45, conquista: "Mais R$ 1.200 de bônus" }
            : null;

  if (!faixa) {
    return {
      inicioFaixa: 45,
      metaFaixa: 45,
      realizadosNaFaixa: 0,
      totalNaFaixa: 0,
      percentual: 100,
      faltam: 0,
      situacao: "Faixa conquistada",
      proximaConquista: "Nível máximo conquistado",
      nivelMaximo: true,
    };
  }

  const realizadosNaFaixa = Math.min(Math.max(total - faixa.inicio, 0), faixa.meta - faixa.inicio);
  const totalNaFaixa = faixa.meta - faixa.inicio;
  const percentual = Math.round((realizadosNaFaixa / totalNaFaixa) * 100);
  const situacao =
    percentual === 0
      ? "Início da faixa"
      : percentual < 35
        ? "Construindo ritmo"
        : percentual < 70
          ? "Ritmo consistente"
          : percentual < 100
            ? "Perto da conquista"
            : "Faixa conquistada";

  return {
    inicioFaixa: faixa.inicio,
    metaFaixa: faixa.meta,
    realizadosNaFaixa,
    totalNaFaixa,
    percentual,
    faltam: faixa.meta - total,
    situacao,
    proximaConquista: faixa.conquista,
    nivelMaximo: false,
  };
}

/** Texto motivacional compartilhado pelas telas de metas e comissões. */
export function getNivelComissaoVendedor(contratos: number): NivelComissaoVendedor {
  const total = Math.max(0, Math.floor(contratos));
  if (total < 15) {
    const faltam = 15 - total;
    return {
      nome: "Arranque",
      valorPorProximoContrato: 25,
      proximoMarco: 15,
      mensagem: `Faltam ${faltam} ${faltam === 1 ? "contrato" : "contratos"} para liberar o bônus de R$ 400 e avançar de nível.`,
    };
  }
  if (total < 25) {
    const faltam = 25 - total;
    return {
      nome: "Aceleração",
      valorPorProximoContrato: 35,
      proximoMarco: 25,
      mensagem: `Você já conquistou R$ 400 de bônus. Faltam ${faltam} ${faltam === 1 ? "contrato" : "contratos"} para chegar à faixa de R$ 45 por contrato.`,
    };
  }
  if (total < 30) {
    const faltam = 30 - total;
    return {
      nome: "Elite",
      valorPorProximoContrato: 45,
      proximoMarco: 30,
      mensagem: `Faixa máxima por contrato conquistada. Faltam ${faltam} ${faltam === 1 ? "contrato" : "contratos"} para somar mais R$ 600 de bônus.`,
    };
  }
  if (total < 45) {
    const faltam = 45 - total;
    return {
      nome: "Elite",
      valorPorProximoContrato: 45,
      proximoMarco: 45,
      mensagem: `Você já acumulou R$ 1.000 em bônus. Faltam ${faltam} ${faltam === 1 ? "contrato" : "contratos"} para somar mais R$ 1.200.`,
    };
  }
  return {
    nome: "Elite",
    valorPorProximoContrato: 45,
    proximoMarco: null,
    mensagem: "Nível máximo alcançado: R$ 45 por novo contrato e R$ 2.200 em bônus acumulados.",
  };
}

/** Receita LTV padrão de um contrato de 12 meses a R$ 350 */
export const RECEITA_LTV_CONTRATO = 4200;
