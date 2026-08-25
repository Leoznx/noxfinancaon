export const DEMO_PROFILE_KEYS = ["proprietario", "corretor", "imobiliaria", "inquilino"] as const;

export type DemoProfileKey = (typeof DEMO_PROFILE_KEYS)[number];
export type DemoDecision = "aprovado" | "recusado" | "pendente";

export type DemoProfile = {
  key: DemoProfileKey;
  label: string;
  accountName: string;
  description: string;
  welcome: string;
  menu: string[];
  stats: Array<{ label: string; value: string }>;
};

export const DEMO_PROFILES: Record<DemoProfileKey, DemoProfile> = {
  proprietario: {
    key: "proprietario",
    label: "Proprietário",
    accountName: "João Proprietário",
    description: "Visão de imóveis, contratos, cobranças e acompanhamento da garantia.",
    welcome: "Acompanhe seus imóveis e contratações em um só lugar.",
    menu: ["Dashboard", "Nova Consulta", "Minhas Consultas", "Contratos Ativos", "Faturas", "Meu Perfil"],
    stats: [
      { label: "Contratos ativos", value: "3" },
      { label: "Imóveis protegidos", value: "3" },
      { label: "Faturas em dia", value: "100%" },
    ],
  },
  corretor: {
    key: "corretor",
    label: "Corretor",
    accountName: "João Corretor",
    description: "Visão comercial com consultas, contratos, carteira e comissões.",
    welcome: "Consulte novos clientes e acompanhe sua produção.",
    menu: ["Dashboard", "Nova Consulta", "Minhas Consultas", "Contratos Ativos", "Comissões", "Meu Perfil"],
    stats: [
      { label: "Consultas no mês", value: "18" },
      { label: "Aprovações", value: "14" },
      { label: "Conversão", value: "77,8%" },
    ],
  },
  imobiliaria: {
    key: "imobiliaria",
    label: "Imobiliária",
    accountName: "Imobiliária João & Cia",
    description: "Operação completa da imobiliária, corretores, contratos e cobranças.",
    welcome: "Gerencie sua operação de locação com agilidade.",
    menu: ["Painel Imobiliária", "Nova Consulta", "Minhas Consultas", "Contratos Ativos", "Meus Corretores", "Perfil Empresa"],
    stats: [
      { label: "Corretores", value: "8" },
      { label: "Contratos ativos", value: "32" },
      { label: "Produção mensal", value: "R$ 84 mil" },
    ],
  },
  inquilino: {
    key: "inquilino",
    label: "Inquilino",
    accountName: "João Inquilino",
    description: "Jornada do locatário com contratação, documentos e pagamentos.",
    welcome: "Sua fiança, documentos e pagamentos sempre à mão.",
    menu: ["Meu Seguro", "Contratar Seguro", "Minhas Consultas", "Documentos", "Faturas", "Meu Perfil"],
    stats: [
      { label: "Status do seguro", value: "Ativo" },
      { label: "Próximo vencimento", value: "10 Set" },
      { label: "Documentos", value: "4" },
    ],
  },
};

export const DEMO_CPF_SCENARIOS: Array<{
  cpf: string;
  decision: DemoDecision;
  label: string;
}> = [
  { cpf: "999.999.999-99", decision: "aprovado", label: "Aprovado" },
  { cpf: "888.888.888-88", decision: "recusado", label: "Recusado" },
  { cpf: "000.000.000-00", decision: "pendente", label: "Pendente" },
];

export const DEMO_PLANS = [
  {
    id: "fit",
    name: "NOX Fit",
    monthly: 200,
    coverage: "Até 30x o aluguel",
    details: "Proteção essencial para uma contratação simples e rápida.",
    featured: false,
  },
  {
    id: "smart",
    name: "NOX Smart",
    monthly: 240,
    coverage: "Até 30x + comissão",
    details: "Equilíbrio entre cobertura e benefícios para parceiros.",
    featured: true,
  },
  {
    id: "up",
    name: "NOX Up",
    monthly: 320,
    coverage: "Até 40x o aluguel",
    details: "Cobertura ampliada para operações que pedem proteção máxima.",
    featured: false,
  },
] as const;

export function isDemoProfileKey(value: string): value is DemoProfileKey {
  return (DEMO_PROFILE_KEYS as readonly string[]).includes(value);
}

export function maskDemoCpf(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  return digits
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

export function getDemoDecision(cpf: string): DemoDecision | null {
  const digits = cpf.replace(/\D/g, "");
  if (digits === "99999999999") return "aprovado";
  if (digits === "88888888888") return "recusado";
  if (digits === "00000000000") return "pendente";
  return null;
}
