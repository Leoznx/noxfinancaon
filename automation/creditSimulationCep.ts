import { randomInt } from "node:crypto";

/**
 * CEPs operacionais usados somente no preenchimento do portal de crédito.
 * O CEP informado pelo usuário nunca é persistido nem enviado ao parceiro.
 */
export const CREDIT_SIMULATION_CEPS = [
  "88340001",
  "88340970",
  "88340600",
  "88343252",
  "88341000",
  "88341300",
  "88341500",
  "88341826",
  "88343099",
  "88343874",
  "88345006",
  "88345327",
  "88345500",
  "88345900",
  "88348001",
  "88348565",
  "88348360",
  "88348598",
  "88348601",
  "88348858",
  "88349153",
  "88349175",
  "88349899",
] as const;

export function selectRandomCreditSimulationCep(
  selectIndex: (maxExclusive: number) => number = randomInt,
): (typeof CREDIT_SIMULATION_CEPS)[number] {
  const index = selectIndex(CREDIT_SIMULATION_CEPS.length);
  const cep = CREDIT_SIMULATION_CEPS[index];
  if (!cep) throw new Error("O sorteio do CEP operacional retornou um índice inválido.");
  return cep;
}
