import {
  ShieldCheck,
  LayoutDashboard,
  Search,
  FileText,
  FileCheck2,
  Users,
  Building2,
  UserCog,
  Home,
  DollarSign,
  AlertCircle,
  BarChart3,
  Settings,
  LogOut,
  Award,
  History,
  User,
  UserCheck,
  Medal,
  UserPlus,
  Bell,
  Receipt,
  Briefcase,
  Wallet,
  ShieldAlert,
  KeyRound,
  UserCircle,
  Crown,
  Scale,
  Megaphone,
  Headphones,
  Trophy,
  Target,
  BookOpen,
  Menu,
  X,
  Users2,
  Shuffle,
  IdCard,
  ContactRound,
  MonitorPlay,
  ArrowRight,
  Gift,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SinoNotificacoes } from "./SinoNotificacoes";
import { useState, useEffect } from "react";

import { LogoNox } from "./LogoNox";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Button } from "./ui/button";
import { useAuth } from "./AuthProvider";
import { getCachedHeaderProfile, setCachedHeaderProfile } from "@/lib/profile-cache";
import { getCachedNivelInfo, loadNivelInfo } from "@/lib/nivel-cache";
import type { NivelInfo } from "@/lib/niveis-parceria";
import {
  getCachedPermissoesCargo,
  loadPermissoesCargo,
  podeVerModulo,
  type PermissoesPorModulo,
} from "@/lib/permissoes-cache";
import { isDemoSession } from "@/lib/demo-session";

const CARGOS_INTERNOS_GATEADOS = [
  "juridico",
  "financeiro",
  "marketing",
  "suporte",
  "vendedor",
] as const;

type MenuItem = {
  icon: LucideIcon;
  label: string;
  href: string;
  module?: string;
  highlight?: boolean;
  keywords?: string[];
  children?: MenuSubItem[];
  sellerTypes?: Array<"sdr" | "closer">;
};

type MenuSubItem = {
  label: string;
  href: string;
  keywords?: string[];
};

type VisibleMenuItem = Omit<MenuItem, "children"> & {
  parentLabel?: string;
};

function normalizeMenuSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// module: chave em role_permissions (ver permissoes-cache.ts). Admin/admin_master/
// analista vê o catálogo administrativo sem a gestão financeira; os módulos aqui
// só são usados pra filtrar o catálogo pros cargos internos gateados abaixo.
const adminItems: MenuItem[] = [
  {
    icon: LayoutDashboard,
    label: "Dashboard Admin",
    href: "/dashboard",
    module: "dashboard_admin",
  },
  { icon: UserCheck, label: "Aprovações", href: "/admin/aprovacoes", module: "aprovacoes" },
  {
    icon: IdCard,
    label: "Aprovações de Documentos",
    href: "/admin/verificacoes",
    module: "documentos",
  },
  { icon: Search, label: "Consultas", href: "/admin/consultas", module: "consultas" },
  { icon: FileText, label: "Contratos Ativos", href: "/admin/contratos", module: "contratos" },
  {
    icon: Users,
    label: "Usuários",
    href: "/admin/usuarios",
    module: "usuarios",
    children: [
      { label: "Todos os usuários", href: "/admin/usuarios?tab=todos" },
      { label: "Proprietários", href: "/admin/usuarios?tab=proprietario" },
      { label: "Imobiliárias", href: "/admin/usuarios?tab=imobiliaria" },
      { label: "Inquilinos", href: "/admin/usuarios?tab=inquilino" },
      { label: "Corretores", href: "/admin/usuarios?tab=corretor" },
      { label: "Equipe e administradores", href: "/admin/usuarios?tab=equipe" },
    ],
  },
  {
    icon: DollarSign,
    label: "Financeiro",
    href: "/admin/financeiro",
    module: "financeiro",
    children: [
      { label: "Saques", href: "/admin/financeiro?tab=withdrawals" },
      { label: "Comissões", href: "/admin/financeiro?tab=commissions" },
      { label: "Pagamentos", href: "/admin/financeiro?tab=payments" },
    ],
  },
  {
    icon: Wallet,
    label: "Faturamento",
    href: "/admin/faturamento",
    module: "faturamento",
    children: [
      { label: "A receber", href: "/admin/faturamento?tab=receber" },
      { label: "Vencidos", href: "/admin/faturamento?tab=vencidos" },
      { label: "Pagos", href: "/admin/faturamento?tab=pagos" },
    ],
  },
  { icon: ShieldAlert, label: "Sinistros", href: "/sinistros", module: "sinistros" },
  {
    icon: UserPlus,
    label: "Leads Marketing",
    href: "/admin/leads",
    module: "leads",
    children: [
      { label: "Leads", href: "/admin/leads?tab=leads" },
      { label: "Inquilinos", href: "/admin/leads?tab=inquilinos" },
      { label: "Corretores", href: "/admin/leads?tab=corretores" },
      { label: "Imobiliárias", href: "/admin/leads?tab=imobiliarias" },
      { label: "Leads de consulta", href: "/admin/leads?tab=leads_consulta" },
      {
        label: "Facebook e Google Ads",
        href: "/admin/leads?tab=ads",
        keywords: ["anúncios", "campanhas"],
      },
    ],
  },
  {
    icon: Shuffle,
    label: "Distribuição de Leads",
    href: "/admin/distribuicao-leads",
    module: "distribuicao_leads",
  },
  {
    icon: Briefcase,
    label: "Vagas abertas",
    href: "/admin/vagas",
    module: "vagas_abertas",
    children: [
      { label: "Vagas cadastradas", href: "/admin/vagas?tab=vagas" },
      { label: "Currículos recebidos", href: "/admin/vagas?tab=curriculos" },
    ],
  },
  {
    icon: Users2,
    label: "Equipe NOX",
    href: "/admin/equipe-nox",
    module: "equipe_nox",
    children: [
      { label: "Metas", href: "/admin/equipe-nox?tab=metas" },
      { label: "Recompensas", href: "/admin/equipe-nox?tab=recompensas" },
      { label: "Agenda", href: "/admin/equipe-nox?tab=agenda" },
      { label: "Comissões", href: "/admin/equipe-nox?tab=comissoes" },
      { label: "Colaboradores", href: "/admin/equipe-nox?tab=colaboradores" },
      { label: "Equipe Comercial", href: "/admin/equipe-nox?tab=equipe-comercial" },
      { label: "Auditoria", href: "/admin/equipe-nox?tab=auditoria" },
    ],
  },
  { icon: KeyRound, label: "Conta NOX", href: "/admin/conta-nox", module: "conta_nox" },
  {
    icon: Settings,
    label: "Configurações",
    href: "/configuracoes",
    children: [
      { label: "Perfil", href: "/configuracoes?tab=perfil" },
      { label: "Conta", href: "/configuracoes?tab=conta" },
      { label: "Segurança", href: "/configuracoes?tab=seguranca" },
      { label: "Notificações", href: "/configuracoes?tab=notificacoes" },
      { label: "Plano e Nível", href: "/configuracoes?tab=comissoes" },
    ],
  },
];

// Catálogo completo usado só pra filtrar o menu dos cargos internos (juridico/
// financeiro/marketing/suporte) por permissão real - inclui 2 itens que não
// aparecem no menu do Admin (Faturas Inquilinos, Chamados) mas que esses
// cargos já enxergavam nos arrays estáticos antigos.
const ADMIN_CATALOG = [
  ...adminItems,
  { icon: Receipt, label: "Faturas Inquilinos", href: "/faturas-inquilinos", module: "faturas" },
  { icon: Headphones, label: "Chamados", href: "/suporte", module: "tickets" },
];

const corretorItems = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
  { icon: Search, label: "Nova Consulta", href: "/consultas/nova", highlight: true },
  { icon: History, label: "Minhas Consultas", href: "/consultas" },
  { icon: FileText, label: "Contratos Ativos", href: "/apolices" },
  { icon: Receipt, label: "Faturas Inquilinos", href: "/faturas-inquilinos" },
  { icon: Wallet, label: "Carteira de Cobranças", href: "/carteira-cobrancas" },
  { icon: DollarSign, label: "Minhas Comissões", href: "/minhas-comissoes" },

  { icon: AlertCircle, label: "Abrir Sinistro", href: "/sinistros" },

  { icon: Award, label: "Plano de Carreira", href: "/plano-carreira" },
  { icon: User, label: "Meu Perfil", href: "/configuracoes" },
];

const imobiliariaItems = [
  { icon: LayoutDashboard, label: "Painel Imobiliária", href: "/dashboard" },
  { icon: Search, label: "Nova Consulta", href: "/consultas/nova", highlight: true },
  { icon: History, label: "Minhas Consultas", href: "/consultas" },
  { icon: FileText, label: "Contratos Ativos", href: "/apolices" },
  { icon: Receipt, label: "Faturas Inquilinos", href: "/faturas-inquilinos" },
  { icon: Wallet, label: "Carteira de Cobranças", href: "/carteira-cobrancas" },
  { icon: Award, label: "Plano de Parceria", href: "/plano-carreira" },
  { icon: UserCog, label: "Meus Corretores", href: "/corretores-admin" },
  { icon: DollarSign, label: "Comissões", href: "/minhas-comissoes" },
  { icon: AlertCircle, label: "Abrir Sinistro", href: "/sinistros" },

  { icon: User, label: "Perfil Empresa", href: "/configuracoes" },
];

const proprietarioItems = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
  { icon: Search, label: "Nova Consulta", href: "/consultas/nova", highlight: true },
  { icon: History, label: "Minhas Consultas", href: "/consultas" },
  { icon: Home, label: "Meus Imóveis", href: "/imoveis" },
  { icon: FileCheck2, label: "Contratos Ativos", href: "/apolices" },
  { icon: DollarSign, label: "Recebimentos", href: "/carteira-cobrancas" },
  { icon: Receipt, label: "Faturas e Taxas", href: "/faturas-inquilinos" },
  { icon: AlertCircle, label: "Sinistros", href: "/sinistros" },
  { icon: FileText, label: "Documentos", href: "/documentos" },
  { icon: User, label: "Meu Perfil", href: "/configuracoes" },
];

const inquilinoItems = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/inquilino/dashboard" },
  { icon: ShieldCheck, label: "Meu Seguro", href: "/inquilino/painel" },
  { icon: FileText, label: "Documentos", href: "/inquilino/documentos" },
  { icon: Receipt, label: "Faturas", href: "/inquilino/faturas" },
  { icon: UserCircle, label: "Meu Perfil", href: "/configuracoes" },
];

// Equipe NOX - colaboradores internos
// Admin Master usa o mesmo menu do Admin (admin_master === admin)
const adminMasterItems = adminItems;

// Vendedor tem portal próprio (não é subset do admin) - catálogo e módulos
// separados. Dashboard e Meu Perfil sem module = sempre visíveis (todo mundo
// precisa de um ponto de entrada e acesso ao próprio perfil).
const vendedorItems: MenuItem[] = [
  {
    icon: ContactRound,
    label: "Cadastrar Cliente",
    href: "/vendedor/clientes",
    highlight: true,
    sellerTypes: ["sdr", "closer"],
  },
  { icon: LayoutDashboard, label: "Dashboard", href: "/vendedor", sellerTypes: ["sdr", "closer"] },
  { icon: MonitorPlay, label: "Contas demo", href: "/vendedor/contas-demo", sellerTypes: ["closer"] },
  { icon: Users, label: "Leads e Atendimento", href: "/vendedor/leads", module: "leads_proprios", sellerTypes: ["sdr"] },
  { icon: Bell, label: "Minha Agenda", href: "/vendedor/agenda", module: "agenda", highlight: true, sellerTypes: ["sdr", "closer"] },
  { icon: Target, label: "Minhas Metas", href: "/vendedor/metas", module: "metas", sellerTypes: ["sdr", "closer"] },
  {
    icon: DollarSign,
    label: "Minhas Comissões",
    href: "/vendedor/comissoes",
    module: "comissoes_proprias",
    sellerTypes: ["sdr", "closer"],
  },
  {
    icon: Gift,
    label: "Plano de Indicação",
    href: "/vendedor/indicacoes",
    sellerTypes: ["sdr"],
  },
  { icon: Trophy, label: "Ranking", href: "/vendedor/ranking", module: "ranking", sellerTypes: ["sdr", "closer"] },
  { icon: User, label: "Meu Perfil", href: "/configuracoes", sellerTypes: ["sdr", "closer"] },
];

// Cargos internos gateados por role_permissions (ver DashboardLayout abaixo) -
// "Meu Perfil" é sempre adicionado à parte (sem module), continua sempre visível.
const CARGO_GATEADO_MENU_ITEM = { icon: User, label: "Meu Perfil", href: "/configuracoes" };
const INTERNAL_ROLE_DASHBOARD_ITEM = {
  icon: LayoutDashboard,
  label: "Dashboard",
  href: "/dashboard",
};
const INTERNAL_ROLES_WITH_DASHBOARD = new Set<string>(["juridico", "financeiro", "marketing"]);

export function DashboardLayout({
  children,
  lockDesktopViewport = false,
  lockViewport = false,
}: {
  children: React.ReactNode;
  lockDesktopViewport?: boolean;
  lockViewport?: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuSearch, setMenuSearch] = useState("");
  const [headerSearch, setHeaderSearch] = useState("");
  const perfilCacheInicial = getCachedHeaderProfile(user?.email);
  const [nomeUsuario, setNomeUsuario] = useState(perfilCacheInicial?.nome || "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(perfilCacheInicial?.avatarUrl || null);

  // Fecha drawer ao trocar rota
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Esconde a barrinha visual do scroll da página no painel admin, sem travar a
  // rolagem em si (classe global em styles.css, some ao sair do painel).
  useEffect(() => {
    document.documentElement.classList.add("no-scrollbar");
    return () => {
      document.documentElement.classList.remove("no-scrollbar");
    };
  }, []);

  useEffect(() => {
    let ativo = true;

    async function carregarPerfil() {
      if (!user?.email) {
        setNomeUsuario("");
        setAvatarUrl(null);
        return;
      }

      const perfilCache = getCachedHeaderProfile(user.email);
      if (perfilCache) {
        setNomeUsuario(perfilCache.nome || user.email.split("@")[0] || "Usuário");
        setAvatarUrl(perfilCache.avatarUrl || null);
      }

      try {
        const { supabase } = await import("@/integrations/supabase/client");
        const {
          data: { user: authUser },
        } = await supabase.auth.getUser();

        const nomeMetadata = authUser?.user_metadata?.nome || authUser?.user_metadata?.full_name;
        let perfil: { nome: string | null; avatar_url: string | null } | null = null;
        if (authUser?.id) {
          const { data } = await supabase
            .from("profiles")
            .select("nome, avatar_url")
            .eq("id", authUser.id)
            .maybeSingle();
          perfil = data;
        }

        if (!perfil) {
          const { data } = await supabase
            .from("profiles")
            .select("nome, avatar_url")
            .eq("email", user.email)
            .maybeSingle();
          perfil = data;
        }

        if (!ativo) return;
        let nomeFinal = perfil?.nome || nomeMetadata || user.email.split("@")[0] || "Usuário";
        if (user.role === "imobiliaria") {
          const { data: agency } = await supabase
            .from("imobiliarias")
            .select("razao_social, nome_fantasia")
            .ilike("contato_email", user.email)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          nomeFinal = agency?.nome_fantasia || agency?.razao_social || nomeFinal;
        }
        const avatarFinal = perfil?.avatar_url || perfilCache?.avatarUrl || null;
        setNomeUsuario(nomeFinal);
        setAvatarUrl(avatarFinal);
        setCachedHeaderProfile({ email: user.email, nome: nomeFinal, avatarUrl: avatarFinal });
      } catch {
        if (!ativo) return;
        const nomeFallback = perfilCache?.nome || user.email.split("@")[0] || "Usuário";
        setNomeUsuario(nomeFallback);
        setAvatarUrl(perfilCache?.avatarUrl || null);
      }
    }

    carregarPerfil();
    return () => {
      ativo = false;
    };
  }, [user?.email, user?.role]);

  const isCorretor = user?.role === "corretor";
  const isImobiliaria = user?.role === "imobiliaria";
  const isProprietario = user?.role === "proprietario";
  const isInquilino = user?.role === "inquilino";
  const isAnalista = user?.role === "analista";

  const temCardNivel = isCorretor || isImobiliaria || isProprietario;
  const [nivelInfo, setNivelInfo] = useState<NivelInfo | null | undefined>(
    user?.id ? getCachedNivelInfo(user.id) : undefined,
  );

  // DashboardLayout remonta a cada navegação - loadNivelInfo já cacheia em
  // memória, então isso só bate no banco de verdade na primeira vez da sessão.
  useEffect(() => {
    if (!temCardNivel || !user?.id) {
      setNivelInfo(undefined);
      return;
    }
    const cached = getCachedNivelInfo(user.id);
    if (cached !== undefined) setNivelInfo(cached);
    loadNivelInfo(user.id, user.role)
      .then(setNivelInfo)
      .catch(() => setNivelInfo(null));
  }, [temCardNivel, user?.id, user?.role]);

  // Cargo interno efetivo (internalRole tem prioridade - é o que vem de
  // internal_users; role é só o enum de profiles, que pode coincidir por
  // legado). Usado tanto pra resolver o menu quanto pra buscar permissões.
  const cargoInterno = (CARGOS_INTERNOS_GATEADOS as readonly string[]).includes(
    user?.internalRole || "",
  )
    ? user!.internalRole!
    : (CARGOS_INTERNOS_GATEADOS as readonly string[]).includes(user?.role || "")
      ? user!.role!
      : null;

  const [permissoesCargo, setPermissoesCargo] = useState<PermissoesPorModulo | undefined>(
    cargoInterno ? getCachedPermissoesCargo(cargoInterno) : undefined,
  );

  // Mesmo racional do nivel-cache: DashboardLayout remonta a cada navegação,
  // então cacheia em memória - só busca de verdade uma vez por sessão/cargo.
  useEffect(() => {
    if (!cargoInterno) {
      setPermissoesCargo(undefined);
      return;
    }
    const cached = getCachedPermissoesCargo(cargoInterno);
    setPermissoesCargo(cached);
    let ativo = true;
    loadPermissoesCargo(cargoInterno)
      .then((permissoes) => {
        if (ativo) setPermissoesCargo(permissoes);
      })
      .catch(() => {
        if (ativo) setPermissoesCargo({});
      });
    return () => {
      ativo = false;
    };
  }, [cargoInterno]);

  const menuPermissionsLoading = !!cargoInterno && permissoesCargo === undefined;

  let menuItems = adminItems;
  if (isCorretor) menuItems = corretorItems;
  if (isImobiliaria) menuItems = imobiliariaItems;
  if (isProprietario) menuItems = proprietarioItems;
  if (isInquilino) menuItems = inquilinoItems;
  if (user?.role === "admin_master" || user?.internalRole === "admin_master")
    menuItems = adminMasterItems;

  // Saques e dados financeiros ficam restritos a admin, admin_master e financeiro.
  // A rota tambem aplica essa protecao; este filtro evita expor a entrada no menu.
  if (isAnalista) {
    menuItems = menuItems.filter((item) => item.module !== "financeiro");
  }

  // admin/admin_master têm acesso integral; analista não acessa Financeiro. Os 5
  // cargos internos abaixo são filtrados por role_permissions.can_view real -
  // é isso que faz "remover a permissão Financeiro" sumir a aba do menu.
  if (cargoInterno === "vendedor") {
    menuItems = vendedorItems.filter(
      (item) =>
        (!item.sellerTypes || (!!user?.sellerType && item.sellerTypes.includes(user.sellerType))) &&
        (!item.module || podeVerModulo(permissoesCargo, item.module)),
    );
  } else if (cargoInterno) {
    menuItems = [
      ...(INTERNAL_ROLES_WITH_DASHBOARD.has(cargoInterno) ? [INTERNAL_ROLE_DASHBOARD_ITEM] : []),
      ...ADMIN_CATALOG.filter(
        (item) =>
          podeVerModulo(permissoesCargo, item.module) &&
          item.module !== undefined &&
          item.module !== "dashboard_admin" &&
          (cargoInterno !== "juridico" || item.module !== "documentos"),
      ),
      CARGO_GATEADO_MENU_ITEM,
    ];
  }

  // Nunca mostra um menu parcial. Enquanto as permissões são resolvidas, o
  // espaço das abas fica reservado e todas aparecem juntas no resultado final.
  if (menuPermissionsLoading) menuItems = [];

  const nomeTopo = nomeUsuario || user?.email?.split("@")[0] || "Usuário";
  const canSearchAdminMenu =
    user?.role === "admin" ||
    user?.role === "admin_master" ||
    user?.internalRole === "admin_master";
  const normalizedMenuSearch = normalizeMenuSearch(menuSearch);
  const visibleMenuItems: VisibleMenuItem[] =
    canSearchAdminMenu && normalizedMenuSearch
      ? menuItems.flatMap((item) => {
          const { children: _children, ...parentItem } = item;
          const parentHaystack = normalizeMenuSearch(
            [item.label, ...(item.keywords ?? [])].join(" "),
          );
          const matches: VisibleMenuItem[] = parentHaystack.includes(normalizedMenuSearch)
            ? [parentItem]
            : [];

          for (const child of item.children ?? []) {
            const childHaystack = normalizeMenuSearch(
              [item.label, child.label, ...(child.keywords ?? [])].join(" "),
            );
            if (childHaystack.includes(normalizedMenuSearch)) {
              matches.push({
                icon: item.icon,
                label: child.label,
                href: child.href,
                module: item.module,
                parentLabel: item.label,
              });
            }
          }

          return matches;
        })
      : menuItems.map(({ children: _children, ...item }) => item);
  const iniciaisUsuario =
    nomeTopo
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((parte) => parte[0])
      .join("")
      .toUpperCase() || "US";

  const openHeaderSearchResult = (value: string, exact = false) => {
    const query = normalizeMenuSearch(value);
    if (!query) return;
    const match = menuItems.find((item) =>
      exact
        ? normalizeMenuSearch(item.label) === query
        : normalizeMenuSearch([item.label, ...(item.keywords ?? [])].join(" ")).includes(query),
    );
    if (!match) return;
    setHeaderSearch("");
    void navigate({ to: match.href as any });
  };

  const handleHeaderSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    openHeaderSearchResult(headerSearch);
  };

  const handleLogout = async () => {
    const wasDemo = isDemoSession();
    await logout();
    window.location.replace(wasDemo ? "/vendedor/contas-demo" : "/");
  };

  return (
    <div
      className={`${lockViewport ? "h-dvh min-h-0 overflow-hidden" : "min-h-dvh"} bg-neutral-50 flex ${
        !lockViewport && lockDesktopViewport ? "xl:h-screen xl:min-h-0 xl:overflow-hidden" : ""
      }`}
    >
      {/* Overlay mobile */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 z-50 flex w-[min(19rem,calc(100vw-1.25rem))] flex-col bg-neutral-950 shadow-2xl shadow-black/30 transition-transform duration-200 lg:w-64 lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="px-6 py-7 lg:px-7 lg:py-8 border-b border-white/10 flex items-center justify-between">
          <Link
            to="/"
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
            aria-label="Ir para a página inicial"
          >
            <LogoNox variant="escuro" size="md" />
          </Link>
          <button
            className="lg:hidden p-2 text-neutral-400 hover:text-white"
            onClick={() => setMobileOpen(false)}
            aria-label="Fechar menu"
          >
            <X size={20} />
          </button>
        </div>

        {canSearchAdminMenu && (
          <div className="px-4 pt-4">
            <label className="sr-only" htmlFor="admin-menu-search">
              Pesquisar abas e subabas
            </label>
            <div className="relative">
              <Search
                size={17}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
              />
              <input
                id="admin-menu-search"
                type="search"
                value={menuSearch}
                onChange={(event) => setMenuSearch(event.target.value)}
                onKeyDown={(event) => event.key === "Escape" && setMenuSearch("")}
                placeholder="Pesquisar abas e subabas..."
                autoComplete="off"
                className="h-10 w-full rounded-xl border border-white/10 bg-white/5 pl-10 pr-3 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-yellow-400/70 focus:ring-2 focus:ring-yellow-400/20"
              />
            </div>
          </div>
        )}

        <nav
          className="sidebar-scrollbar flex-1 space-y-1.5 overflow-y-auto p-4 py-6"
          aria-busy={menuPermissionsLoading}
        >
          {menuPermissionsLoading && (
            <div className="space-y-2" aria-label="Carregando acessos do menu">
              {Array.from({ length: 7 }, (_, index) => (
                <div
                  key={index}
                  className="h-11 animate-pulse rounded-xl bg-white/[0.07]"
                />
              ))}
            </div>
          )}
          {!menuPermissionsLoading && visibleMenuItems.map((item) => {
            const isActive = location.pathname === item.href.split("?")[0];
            const isHighlight = item.highlight;
            return (
              <Link
                key={`${item.href}-${item.parentLabel ?? "principal"}`}
                to={item.href}
                className={`flex items-center gap-3 pl-3 pr-4 py-3 rounded-xl border-l-4 transition-all ${
                  isActive
                    ? cargoInterno === "juridico" || isImobiliaria || isProprietario || isInquilino
                      ? "bg-yellow-400 border-yellow-400 text-neutral-950 font-bold shadow-sm shadow-yellow-400/20"
                      : "bg-white/10 border-yellow-400 text-white font-semibold"
                    : isHighlight && !isImobiliaria
                      ? "bg-yellow-400 border-transparent text-neutral-900 font-bold hover:bg-yellow-500 shadow-sm shadow-yellow-400/20"
                      : "border-transparent text-neutral-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                <item.icon size={20} strokeWidth={isActive || isHighlight ? 2.2 : 1.5} />
                <span className="min-w-0 text-sm">
                  <span className="block truncate">{item.label}</span>
                  {item.parentLabel && (
                    <span className="block truncate text-[10px] font-medium text-neutral-500">
                      {item.parentLabel} › subaba
                    </span>
                  )}
                </span>
              </Link>
            );
          })}
          {canSearchAdminMenu && normalizedMenuSearch && visibleMenuItems.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-neutral-500">
              Nenhuma aba encontrada.
            </p>
          )}
        </nav>

        <div className="p-6 border-t border-white/10 space-y-4">
          {temCardNivel && (
            <div className="px-3.5 py-3 rounded-xl bg-neutral-900 border border-white/10 mb-2 space-y-2">
              <div className="flex items-center gap-1.5">
                <Crown size={12} className="text-yellow-400" strokeWidth={2} />
                <p className="text-[9px] font-bold text-neutral-400 uppercase tracking-widest">
                  Nível Atual
                </p>
              </div>
              <p className="text-base font-black text-yellow-400 uppercase tracking-tight leading-none">
                {nivelInfo?.nivelAtual?.nome_nivel || "-"}
              </p>
              {nivelInfo?.nivelAtual && (
                <>
                  <p className="text-[9px] text-neutral-500 font-medium">
                    {nivelInfo.nivelAtual.percentual_comissao}% de comissão por contrato
                  </p>
                  <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-yellow-400 rounded-full transition-all duration-700"
                      style={{
                        width: `${nivelInfo.proximoNivel ? Math.min(100, (nivelInfo.contratosAtivos / nivelInfo.proximoNivel.min_contratos) * 100) : 100}%`,
                      }}
                    />
                  </div>
                  {nivelInfo.proximoNivel && (
                    <div className="pt-1 text-[9px] leading-relaxed text-neutral-400">
                      <p>
                        Próximo nível:{" "}
                        <span className="font-bold text-white">
                          {nivelInfo.proximoNivel.nome_nivel}
                        </span>
                      </p>
                      <p>
                        Faltam{" "}
                        {Math.max(
                          0,
                          nivelInfo.proximoNivel.min_contratos - nivelInfo.contratosAtivos,
                        )}{" "}
                        contratos
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-neutral-400 hover:text-red-400 hover:bg-red-500/10 rounded-xl"
            onClick={handleLogout}
          >
            <LogOut size={20} strokeWidth={1.5} />
            <span className="font-medium">Sair do sistema</span>
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main
        className={`flex-1 lg:ml-64 ${lockViewport ? "h-screen min-h-0 overflow-hidden" : "min-h-screen"} flex flex-col min-w-0 ${
          isImobiliaria ? "w-full lg:w-[calc(100%-16rem)]" : "w-full"
        } ${
          !lockViewport && lockDesktopViewport ? "xl:h-screen xl:min-h-0 xl:overflow-hidden" : ""
        }`}
      >
        <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between gap-2 border-b border-neutral-200 bg-white/90 px-3 backdrop-blur-md sm:gap-3 sm:px-6 lg:px-10">
          <div className="flex items-center gap-3 min-w-0">
            <button
              className="-ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menu"
            >
              <Menu size={22} />
            </button>
            <div className="text-sm text-neutral-500 hidden sm:flex items-center gap-2 font-medium min-w-0">
              Bem-vindo, <span className="text-neutral-900 font-bold truncate">{nomeTopo}</span>
              {user?.role === "corretor" && (
                <Medal className="w-4 h-4 text-[#FACC15] ml-1 shrink-0" />
              )}
              {user?.role === "imobiliaria" && (
                <Building2 className="w-4 h-4 text-neutral-400 ml-1 shrink-0" />
              )}
              {user?.role === "proprietario" && (
                <Home className="w-4 h-4 text-yellow-400 ml-1 shrink-0" />
              )}
            </div>
            <div className="sm:hidden text-sm font-bold text-neutral-900 truncate">{nomeTopo}</div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {isImobiliaria && (
              <form onSubmit={handleHeaderSearch} className="relative hidden md:block">
                <label htmlFor="agency-dashboard-search" className="sr-only">
                  Buscar no painel
                </label>
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
                  size={15}
                />
                <input
                  id="agency-dashboard-search"
                  list="agency-dashboard-search-options"
                  value={headerSearch}
                  onChange={(event) => {
                    const value = event.target.value;
                    setHeaderSearch(value);
                    openHeaderSearchResult(value, true);
                  }}
                  placeholder="Buscar..."
                  className="h-9 w-52 rounded-xl border border-neutral-200 bg-white pl-9 pr-9 text-xs text-neutral-800 outline-none transition focus:border-yellow-400 focus:ring-2 focus:ring-yellow-400/20 xl:w-64"
                />
                <button
                  type="submit"
                  aria-label="Abrir resultado da busca"
                  className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-yellow-100 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400"
                >
                  <ArrowRight size={13} />
                </button>
                <datalist id="agency-dashboard-search-options">
                  {menuItems.map((item) => (
                    <option key={item.href} value={item.label} />
                  ))}
                </datalist>
              </form>
            )}
            <SinoNotificacoes />
            <Link
              to="/configuracoes"
              className="w-9 h-9 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center overflow-hidden text-xs font-bold text-white uppercase hover:border-yellow-400 hover:ring-2 hover:ring-yellow-400/30 transition-all shrink-0"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt={nomeTopo} className="h-full w-full object-cover" />
              ) : (
                iniciaisUsuario
              )}
            </Link>
          </div>
        </header>

        <div
          className={`flex-1 overflow-x-hidden p-3 sm:p-6 lg:p-8 xl:p-10 ${
            lockViewport
              ? "min-h-0 overflow-hidden p-3 sm:p-4 lg:p-5"
              : lockDesktopViewport
                ? "xl:min-h-0 xl:overflow-hidden xl:p-6"
                : ""
          }`}
        >
          {children}
        </div>

        <footer
          className={`border-t border-neutral-100 bg-white px-4 py-5 text-center text-xs font-medium text-neutral-400 sm:p-8 ${
            lockViewport ? "hidden" : lockDesktopViewport ? "xl:hidden" : ""
          }`}
        >
          © {new Date().getFullYear()} NOX FIANÇA - Plataforma Institucional de Seguro Fiança
          Locatícia
        </footer>
      </main>
    </div>
  );
}
