import type { DadosSimulacao } from "@/components/simulacao/FormularioSimulacao";

export const DEMO_PROFILE_KEYS = ["proprietario", "corretor", "imobiliaria", "inquilino"] as const;

export type DemoProfileKey = (typeof DEMO_PROFILE_KEYS)[number];
export type DemoDecision = "aprovado" | "recusado" | "pendente";

export type DemoProfile = {
  key: DemoProfileKey;
  label: string;
  description: string;
  email: string;
  password: string;
  startPath: "/dashboard" | "/inquilino/painel";
};

export const DEMO_PROFILES: Record<DemoProfileKey, DemoProfile> = {
  proprietario: {
    key: "proprietario",
    label: "Proprietário",
    description: "A mesma conta e as mesmas telas usadas por um proprietário real.",
    email: "proprietario@nox.com",
    password: "nox12345",
    startPath: "/dashboard",
  },
  corretor: {
    key: "corretor",
    label: "Corretor",
    description: "A mesma conta e as mesmas telas usadas por um corretor real.",
    email: "corretor@nox.com",
    password: "nox12345",
    startPath: "/dashboard",
  },
  imobiliaria: {
    key: "imobiliaria",
    label: "Imobiliária",
    description: "A mesma conta e as mesmas telas usadas por uma imobiliária real.",
    email: "imobiliaria@nox.com",
    password: "nox12345",
    startPath: "/dashboard",
  },
  inquilino: {
    key: "inquilino",
    label: "Inquilino",
    description: "A mesma conta e as mesmas telas usadas por um inquilino real.",
    email: "inquilino@nox.com",
    password: "nox12345",
    startPath: "/inquilino/painel",
  },
};

export const DEMO_CPF_SCENARIOS: Array<{
  cpf: string;
  decision: DemoDecision;
  label: string;
}> = [
  { cpf: "999.999.999-99", decision: "aprovado", label: "Aprovado" },
  { cpf: "888.888.888-88", decision: "recusado", label: "Recusado" },
  { cpf: "000.000.000-00", decision: "pendente", label: "Em análise" },
];

export const DEMO_SIMULATION_DATA: DadosSimulacao = {
  tipoInquilino: "PF",
  inquilinos: [{ cpf: "999.999.999-99", nome: "João da Silva" }],
  razaoSocial: "",
  cnpj: "",
  tipoImovel: "Residencial",
  cep: "88330-015",
  endereco: { cidade: "Balneário Camboriú", uf: "SC" },
  valores: { aluguel: 2000, condominio: 400, taxas: 100 },
};

export const DEMO_COMPLEMENTARY_DATA = {
  imovel: {
    cep: "88330-015",
    subtipo: "Apartamento",
    endereco: "Avenida Atlântica",
    bairro: "Centro",
    cidade: "Balneário Camboriú",
    estado: "SC",
    numero: "2200",
    complemento: "Apto 1201",
  },
  inquilino: {
    nome: "João da Silva",
    nascimentoISO: "1990-05-15",
    email: "inquilino@nox.com",
    telefone: "(47) 99999-9999",
  },
  paymentType: "inquilino" as const,
  contratoAssinado: "sim" as const,
  documentoFoto: "cnh" as const,
} as const;

export function isDemoProfileKey(value: string): value is DemoProfileKey {
  return (DEMO_PROFILE_KEYS as readonly string[]).includes(value);
}

export function getDemoDecision(cpf: string): DemoDecision | null {
  const digits = cpf.replace(/\D/g, "");
  if (digits === "99999999999") return "aprovado";
  if (digits === "88888888888") return "recusado";
  if (digits === "00000000000") return "pendente";
  return null;
}

export function isDemoDocument(value: string): boolean {
  return getDemoDecision(value) !== null;
}
