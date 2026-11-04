export const DEMO_CAREER_ACTIVE_CONTRACTS = 15;

export const DEMO_CAREER_ROLES = ["corretor", "imobiliaria", "proprietario"] as const;

export type DemoCareerLevel = {
  id: string;
  tipo_perfil: (typeof DEMO_CAREER_ROLES)[number];
  nome_nivel: "BRONZE" | "PRATA" | "OURO" | "DIAMANTE";
  percentual_comissao: number;
  min_contratos: number;
  max_contratos: number | null;
  bonus_renovacao: number;
  ordem: number;
  ativo: true;
};

const LEVEL_TEMPLATES = [
  { nome_nivel: "BRONZE", percentual_comissao: 1, min_contratos: 0, max_contratos: 10 },
  { nome_nivel: "PRATA", percentual_comissao: 1.5, min_contratos: 11, max_contratos: 20 },
  { nome_nivel: "OURO", percentual_comissao: 2, min_contratos: 21, max_contratos: 30 },
  { nome_nivel: "DIAMANTE", percentual_comissao: 2.5, min_contratos: 31, max_contratos: null },
] as const;

export function getDemoCareerScenario(role: string) {
  if (!(DEMO_CAREER_ROLES as readonly string[]).includes(role)) return null;

  const careerRole = role as (typeof DEMO_CAREER_ROLES)[number];
  const levels: DemoCareerLevel[] = LEVEL_TEMPLATES.map((level, index) => ({
    ...level,
    id: `demo-career-${careerRole}-${level.nome_nivel.toLowerCase()}`,
    tipo_perfil: careerRole,
    bonus_renovacao: 0,
    ordem: index + 1,
    ativo: true,
  }));
  const currentLevel =
    [...levels].reverse().find((level) => DEMO_CAREER_ACTIVE_CONTRACTS >= level.min_contratos) ??
    levels[0];
  const currentIndex = levels.findIndex((level) => level.id === currentLevel.id);
  const nextLevel = levels[currentIndex + 1] ?? null;
  const remainingContracts = nextLevel
    ? Math.max(0, nextLevel.min_contratos - DEMO_CAREER_ACTIVE_CONTRACTS)
    : 0;
  const progressPercent = nextLevel
    ? Math.round(
        ((DEMO_CAREER_ACTIVE_CONTRACTS - currentLevel.min_contratos) /
          Math.max(1, nextLevel.min_contratos - currentLevel.min_contratos)) *
          100,
      )
    : 100;

  return {
    activeContracts: DEMO_CAREER_ACTIVE_CONTRACTS,
    levels,
    currentLevel,
    nextLevel,
    remainingContracts,
    progressPercent,
  };
}
