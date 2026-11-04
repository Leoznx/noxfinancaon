import { DEMO_PROFILES } from "./demo-accounts";

// Presentation-only data. Never persist these counts or levels in Supabase.
const DEMO_CAREER = {
  activeContracts: 15,
  levels: [
    {
      nome_nivel: "BRONZE",
      min_contratos: 0,
      max_contratos: 10,
      percentual_comissao: 1,
      bonus_renovacao: 0,
      ordem: 1,
    },
    {
      nome_nivel: "PRATA",
      min_contratos: 11,
      max_contratos: 20,
      percentual_comissao: 1.5,
      bonus_renovacao: 0,
      ordem: 2,
    },
    {
      nome_nivel: "OURO",
      min_contratos: 21,
      max_contratos: 30,
      percentual_comissao: 2,
      bonus_renovacao: 0,
      ordem: 3,
    },
    {
      nome_nivel: "DIAMANTE",
      min_contratos: 31,
      max_contratos: null,
      percentual_comissao: 2.5,
      bonus_renovacao: 0,
      ordem: 4,
    },
  ],
};

export function getDemoCareer(
  user: { email?: string | null; role: string } | null | undefined,
  demoSessionActive: boolean,
) {
  if (!demoSessionActive || !user) return null;
  const role = user.role;
  if (role !== "corretor" && role !== "imobiliaria" && role !== "proprietario") return null;
  if (user.email?.trim().toLowerCase() !== DEMO_PROFILES[role].email.toLowerCase()) return null;
  return DEMO_CAREER;
}
