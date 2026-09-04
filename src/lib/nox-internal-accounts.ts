export type NoxInternalRole = "vendedor" | "financeiro" | "juridico" | "marketing";
export type SellerType = "sdr" | "closer";

export const noxInternalAccounts = {
  sdr: {
    label: "Vendedor SDR",
    route: "/login/sdrnox",
    dashboardRoute: "/vendedor",
    internalRole: "vendedor",
    sellerType: "sdr",
    cardDescription: "Prospecção, pré-atendimento, qualificação e agendamento para Closers.",
    formTitle: "Criar conta de Vendedor SDR",
    formDescription: "Cadastre-se para prospectar parceiros e distribuir reuniões para a equipe de fechamento.",
    badge: "Equipe comercial NOX — SDR",
  },
  closer: {
    label: "Vendedor Closer",
    route: "/login/closernox",
    dashboardRoute: "/vendedor",
    internalRole: "vendedor",
    sellerType: "closer",
    cardDescription: "Apresentação da plataforma, cadastro do parceiro e fechamento comercial.",
    formTitle: "Criar conta de Vendedor Closer",
    formDescription: "Cadastre-se para receber reuniões qualificadas e conduzir os fechamentos.",
    badge: "Equipe comercial NOX — Closer",
  },
  financeiro: {
    label: "Financeiro",
    route: "/login/financeironox",
    dashboardRoute: "/dashboard",
    internalRole: "financeiro",
    sellerType: null,
    cardDescription: "Cadastro destinado aos colaboradores do setor financeiro da NOX Fiança.",
    formTitle: "Criar conta do Financeiro NOX",
    formDescription: "Preencha seus dados para acessar o ambiente financeiro da NOX Fiança.",
    badge: "Equipe interna NOX — Financeiro",
  },
  juridico: {
    label: "Jurídico",
    route: "/login/juridiconox",
    dashboardRoute: "/dashboard",
    internalRole: "juridico",
    sellerType: null,
    cardDescription: "Cadastro destinado aos colaboradores do setor jurídico da NOX Fiança.",
    formTitle: "Criar conta do Jurídico NOX",
    formDescription: "Preencha seus dados para acessar o ambiente jurídico da NOX Fiança.",
    badge: "Equipe interna NOX — Jurídico",
  },
  marketing: {
    label: "Marketing",
    route: "/login/marketingnox",
    dashboardRoute: "/dashboard",
    internalRole: "marketing",
    sellerType: null,
    cardDescription: "Cadastro destinado aos colaboradores do setor de marketing da NOX Fiança.",
    formTitle: "Criar conta de Marketing NOX",
    formDescription: "Preencha seus dados para acessar o ambiente de marketing da NOX Fiança.",
    badge: "Equipe interna NOX — Marketing",
  },
} as const;

export type NoxInternalAccountType = keyof typeof noxInternalAccounts;
export const NOX_INTERNAL_ACCOUNT_TYPES = Object.keys(
  noxInternalAccounts,
) as NoxInternalAccountType[];
export const NOX_INTERNAL_ROLES: NoxInternalRole[] = [
  "vendedor",
  "financeiro",
  "juridico",
  "marketing",
];

const PRODUCTION_APP_URL = "https://noxfianca.com";

export function buildRegistrationLink(accountType: NoxInternalAccountType) {
  const publicSiteUrl = (import.meta as any).env?.VITE_PUBLIC_SITE_URL || PRODUCTION_APP_URL;
  return `${String(publicSiteUrl).replace(/\/$/, "")}${noxInternalAccounts[accountType].route}`;
}
