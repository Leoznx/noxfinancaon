// Fonte única de verdade pros 4 cargos internos com link fixo de cadastro
// (/login/<cargo>nox) — usada tanto pela aba admin "Conta NOX" quanto pelas
// próprias páginas de cadastro e por qualquer redirecionamento futuro, pra
// nunca ter a rota/label/descrição escritas em mais de um lugar.
export const noxInternalAccounts = {
  vendedor: {
    label: "Vendedor",
    route: "/login/vendedornox",
    dashboardRoute: "/vendedor",
    cardDescription: "Cadastro destinado aos colaboradores do setor de vendas da NOX Fiança.",
    formTitle: "Criar conta de Vendedor NOX",
    formDescription: "Preencha seus dados para acessar o ambiente comercial da NOX Fiança.",
    badge: "Equipe interna NOX — Vendedor",
  },
  financeiro: {
    label: "Financeiro",
    route: "/login/financeironox",
    dashboardRoute: "/admin/financeiro",
    cardDescription: "Cadastro destinado aos colaboradores do setor financeiro da NOX Fiança.",
    formTitle: "Criar conta do Financeiro NOX",
    formDescription: "Preencha seus dados para acessar o ambiente financeiro da NOX Fiança.",
    badge: "Equipe interna NOX — Financeiro",
  },
  juridico: {
    label: "Jurídico",
    route: "/login/juridiconox",
    dashboardRoute: "/admin/aprovacoes",
    cardDescription: "Cadastro destinado aos colaboradores do setor jurídico da NOX Fiança.",
    formTitle: "Criar conta do Jurídico NOX",
    formDescription: "Preencha seus dados para acessar o ambiente jurídico da NOX Fiança.",
    badge: "Equipe interna NOX — Jurídico",
  },
  marketing: {
    label: "Marketing",
    route: "/login/marketingnox",
    dashboardRoute: "/admin/leads",
    cardDescription: "Cadastro destinado aos colaboradores do setor de marketing da NOX Fiança.",
    formTitle: "Criar conta de Marketing NOX",
    formDescription: "Preencha seus dados para acessar o ambiente de marketing da NOX Fiança.",
    badge: "Equipe interna NOX — Marketing",
  },
} as const;

export type NoxInternalRole = keyof typeof noxInternalAccounts;
export const NOX_INTERNAL_ROLES = Object.keys(noxInternalAccounts) as NoxInternalRole[];

// Fallback sempre é o domínio oficial de produção — nunca localhost nem a URL
// de preview da Vercel — pra um link copiado/aberto nunca apontar pro lugar
// errado mesmo que VITE_PUBLIC_SITE_URL não esteja configurada no ambiente.
// Páginas server-side que precisam do link (nenhuma hoje) devem montar a
// partir de process.env.APP_URL.
const PRODUCTION_APP_URL = "https://noxfianca.com";

export function buildRegistrationLink(role: NoxInternalRole) {
  const publicSiteUrl = (import.meta as any).env?.VITE_PUBLIC_SITE_URL || PRODUCTION_APP_URL;
  const base = String(publicSiteUrl).replace(/\/$/, "");
  return `${base}${noxInternalAccounts[role].route}`;
}
