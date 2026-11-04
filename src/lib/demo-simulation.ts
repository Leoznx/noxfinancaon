// Local-only simulator: no storage, network, payment, signature or delivery adapters.
export type DemoIdentity = { id: string; email: string; role: string };
const roles = ["proprietario", "corretor", "imobiliaria", "inquilino"] as const;
export function isDemoSimulationEmail(email: string | undefined): boolean {
  return roles.some((role) => email?.toLowerCase() === `${role}@nox.com`);
}
export function isSimulationCandidate(user: DemoIdentity | null): boolean {
  return (
    !!user?.id &&
    roles.some((role) => user.role === role && user.email.toLowerCase() === `${role}@nox.com`)
  );
}
export async function verifySimulationIdentity(
  expected: DemoIdentity,
  readIdentity: () => Promise<DemoIdentity | null>,
): Promise<boolean> {
  if (!isSimulationCandidate(expected)) return false;
  const verified = await readIdentity();
  return (
    !!verified &&
    verified.id === expected.id &&
    verified.role === expected.role &&
    verified.email.toLowerCase() === expected.email.toLowerCase() &&
    isSimulationCandidate(verified)
  );
}
export type Scenario = "aprovado" | "recusado" | "pendente";
export type Stage = "analise" | "documentos" | "contrato" | "fatura" | "recibo";
export type Simulation = { scenario: Scenario; stage: Stage; history: string[] };
export const steps: Record<Stage, { title: string; detail: string; action: string }> = {
  analise: {
    title: "Análise de crédito",
    detail:
      "Pessoa Exemplo · CPF fictício 999.999.999-99 · aluguel R$ 2.000,00 · condomínio R$ 400,00 · taxas R$ 100,00.",
    action: "Simular análise",
  },
  documentos: {
    title: "Documentos do exemplo",
    detail:
      "Identidade e comprovante fictícios disponíveis. Nenhum arquivo pessoal é solicitado ou enviado.",
    action: "Simular conferência",
  },
  contrato: {
    title: "Contrato DEMO-001",
    detail:
      "Imóvel Exemplo · vigência ilustrativa de 12 meses · garantia demonstrativa R$ 250,00/mês. Este resumo não é um contrato e não tem validade jurídica.",
    action: "Simular ativação sem assinatura",
  },
  fatura: {
    title: "Fatura DEMO-001/01",
    detail:
      "Parcela 1 de 12 · R$ 250,00 · em aberto. Não há boleto, QR Code, chave Pix ou checkout pagável.",
    action: "Simular pagamento",
  },
  recibo: {
    title: "Recibo demonstrativo",
    detail:
      "R$ 250,00 · pagamento simulado concluído · saldo demonstrativo R$ 0,00. Nenhum valor foi cobrado. Sem validade financeira.",
    action: "Concluído",
  },
};
export function startSimulation(scenario: Scenario = "aprovado"): Simulation {
  return { scenario, stage: "analise", history: [] };
}
export function advanceSimulation(state: Simulation): Simulation {
  if (state.stage === "recibo") return state;
  if (state.stage === "analise" && state.scenario !== "aprovado") {
    return {
      ...state,
      history: [
        state.scenario === "recusado"
          ? "Crédito recusado no cenário fictício. Reinicie para tentar outro cenário."
          : "Em análise no cenário fictício. Reinicie para escolher um resultado.",
      ],
    };
  }
  const order: Stage[] = ["analise", "documentos", "contrato", "fatura", "recibo"];
  return {
    ...state,
    stage: order[order.indexOf(state.stage) + 1],
    history: [...state.history, `${steps[state.stage].title}: simulação concluída`],
  };
}
