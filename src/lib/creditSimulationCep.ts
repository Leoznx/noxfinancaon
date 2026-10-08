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

/**
 * Preenche o campo técnico consumido pela automação sem misturá-lo ao CEP
 * informado pelo usuário, que permanece somente nos dados internos do imóvel.
 */
export function selectOperationalCreditSimulationCep(
  random: () => number = Math.random,
): (typeof CREDIT_SIMULATION_CEPS)[number] {
  const cep = CREDIT_SIMULATION_CEPS[Math.floor(random() * CREDIT_SIMULATION_CEPS.length)];
  if (!cep) throw new Error("Não foi possível selecionar um CEP operacional.");
  return cep;
}
