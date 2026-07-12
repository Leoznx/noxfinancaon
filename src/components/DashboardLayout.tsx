import {
  ShieldCheck,
  LayoutDashboard,
  Search,
  FileText,
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
  ListChecks,
  Menu,
  X,
  Users2,
  Shuffle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SinoNotificacoes } from "./SinoNotificacoes";
import { useState, useEffect } from "react";

import { LogoNox } from "./LogoNox";
import { Link, useLocation } from "@tanstack/react-router";
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
};

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
  { icon: Search, label: "Consultas", href: "/admin/consultas", module: "consultas" },
  { icon: FileText, label: "Contratos Ativos", href: "/admin/contratos", module: "contratos" },
  { icon: Users, label: "Usuários", href: "/admin/usuarios", module: "usuarios" },
  { icon: DollarSign, label: "Financeiro", href: "/admin/financeiro", module: "financeiro" },
  { icon: Wallet, label: "Faturamento", href: "/admin/faturamento", module: "faturamento" },
  { icon: ShieldAlert, label: "Sinistros", href: "/sinistros", module: "sinistros" },
  { icon: UserPlus, label: "Leads Marketing", href: "/admin/leads", module: "leads" },
  {
    icon: Shuffle,
    label: "Distribuição de Leads",
    href: "/admin/distribuicao-leads",
    module: "distribuicao_leads",
  },
  { icon: Briefcase, label: "Vagas abertas", href: "/admin/vagas", module: "vagas_abertas" },
  { icon: Users2, label: "Equipe NOX", href: "/admin/equipe-nox", module: "equipe_nox" },
  { icon: KeyRound, label: "Conta NOX", href: "/admin/conta-nox", module: "conta_nox" },
  { icon: Settings, label: "Configurações", href: "/configuracoes" },
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
  { icon: Award, label: "Plano de Fidelidade", href: "/plano-carreira" },
  { icon: DollarSign, label: "Plano de Comissão", href: "/minhas-comissoes" },
  { icon: FileText, label: "Contratos Ativos", href: "/apolices" },
  { icon: Receipt, label: "Faturas Inquilinos", href: "/faturas-inquilinos" },
  { icon: AlertCircle, label: "Abrir Sinistro", href: "/sinistros" },

  { icon: User, label: "Meu Perfil", href: "/configuracoes" },
];

const inquilinoItems = [
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
const vendedorItems = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/vendedor" },
  { icon: Users, label: "Meus Leads", href: "/vendedor/leads", module: "leads_proprios" },
  { icon: ListChecks, label: "Pipeline", href: "/vendedor/pipeline", module: "pipeline" },
  { icon: Bell, label: "Minha Agenda", href: "/vendedor/agenda", module: "agenda" },
  { icon: Target, label: "Minhas Metas", href: "/vendedor/metas", module: "metas" },
  {
    icon: DollarSign,
    label: "Minhas Comissões",
    href: "/vendedor/comissoes",
    module: "comissoes_proprias",
  },
  { icon: Trophy, label: "Ranking", href: "/vendedor/ranking", module: "ranking" },
  { icon: User, label: "Meu Perfil", href: "/vendedor/perfil" },
];

// Cargos internos gateados por role_permissions (ver DashboardLayout abaixo) -
// "Meu Perfil" é sempre adicionado à parte (sem module), continua sempre visível.
const CARGO_GATEADO_MENU_ITEM = { icon: User, label: "Meu Perfil", href: "/configuracoes" };

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const perfilCacheInicial = getCachedHeaderProfile(user?.email);
  const [nomeUsuario, setNomeUsuario] = useState(perfilCacheInicial?.nome || "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(perfilCacheInicial?.avatarUrl || null);

  // Fecha drawer ao trocar rota
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

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
        const nomeFinal = perfil?.nome || nomeMetadata || user.email.split("@")[0] || "Usuário";
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
  }, [user?.email]);

  const isCorretor = user?.role === "corretor";
  const isImobiliaria = user?.role === "imobiliaria";
  const isProprietario = user?.role === "proprietario";
  const isInquilino = user?.role === "inquilino";
  const isAnalista = user?.role === "analista" || user?.internalRole === "analista";

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
    if (cached !== undefined) setPermissoesCargo(cached);
    loadPermissoesCargo(cargoInterno)
      .then(setPermissoesCargo)
      .catch(() => setPermissoesCargo({}));
  }, [cargoInterno]);

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
    menuItems = [
      vendedorItems[0], // Dashboard - sempre visível
      ...vendedorItems.slice(1, -1).filter((item) => podeVerModulo(permissoesCargo, item.module)),
      vendedorItems[vendedorItems.length - 1], // Meu Perfil - sempre visível
    ];
  } else if (cargoInterno) {
    menuItems = [
      ...ADMIN_CATALOG.filter(
        (item) => podeVerModulo(permissoesCargo, item.module) && item.module !== undefined,
      ),
      CARGO_GATEADO_MENU_ITEM,
    ];
  }

  const nomeTopo = nomeUsuario || user?.email?.split("@")[0] || "Usuário";
  const iniciaisUsuario =
    nomeTopo
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((parte) => parte[0])
      .join("")
      .toUpperCase() || "US";

  const handleLogout = async () => {
    await logout();
    window.location.replace("/");
  };

  return (
    <div className="min-h-screen bg-neutral-50 flex">
      {/* Overlay mobile */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`w-64 flex flex-col fixed inset-y-0 z-50 bg-neutral-950 shadow-2xl shadow-black/30 transition-transform duration-200 lg:translate-x-0 ${
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

        <nav className="flex-1 overflow-y-auto p-4 py-6 space-y-1.5">
          {menuItems.map((item) => {
            const isActive = location.pathname === item.href;
            const isHighlight = item.highlight;
            return (
              <Link
                key={item.href}
                to={item.href}
                className={`flex items-center gap-3 pl-3 pr-4 py-3 rounded-xl border-l-4 transition-all ${
                  isActive
                    ? "bg-white/10 border-yellow-400 text-white font-semibold"
                    : isHighlight
                      ? "bg-yellow-400 border-transparent text-neutral-900 font-bold hover:bg-yellow-500 shadow-sm shadow-yellow-400/20"
                      : "border-transparent text-neutral-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                <item.icon size={20} strokeWidth={isActive || isHighlight ? 2.2 : 1.5} />
                <span className="text-sm">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-6 border-t border-white/10 space-y-4">
          {temCardNivel && (
            <div className="px-4 py-4 rounded-xl bg-neutral-900 border border-white/10 mb-2 space-y-2.5">
              <div className="flex items-center gap-2">
                <Crown size={14} className="text-yellow-400" strokeWidth={2} />
                <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">
                  Nível Atual
                </p>
              </div>
              <p className="text-lg font-black text-yellow-400 uppercase tracking-tight leading-none">
                {nivelInfo?.nivelAtual?.nome_nivel || "-"}
              </p>
              {nivelInfo?.nivelAtual && (
                <>
                  <p className="text-[10px] text-neutral-500 font-medium">
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
      <main className="flex-1 lg:ml-64 min-h-screen flex flex-col w-full min-w-0">
        <header className="h-16 border-b border-neutral-200 flex items-center justify-between gap-3 px-4 sm:px-6 lg:px-10 bg-white/80 backdrop-blur-md sticky top-0 z-40">
          <div className="flex items-center gap-3 min-w-0">
            <button
              className="lg:hidden p-2 -ml-2 text-neutral-700 hover:text-neutral-900 shrink-0"
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
                <Home className="w-4 h-4 text-neutral-400 ml-1 shrink-0" />
              )}
            </div>
            <div className="sm:hidden text-sm font-bold text-neutral-900 truncate">{nomeTopo}</div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
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

        <div className="p-4 sm:p-6 lg:p-10 flex-1 overflow-x-hidden">{children}</div>

        <footer className="p-6 sm:p-8 text-center text-xs text-neutral-400 border-t border-neutral-100 font-medium bg-white">
          © 2025 NOX FIANÇA - Plataforma Institucional de Seguro Fiança Locatícia
        </footer>
      </main>
    </div>
  );
}
