import { ShieldCheck, LayoutDashboard, Search, FileText, Users, Building2, UserCog, Home, DollarSign, AlertCircle, BarChart3, Settings, LogOut, Award, History, User, UserCheck, Medal, UserPlus, Bell, Receipt, Briefcase, Wallet, ShieldAlert, KeyRound, Gift, UserCircle, Handshake, Crown, Scale, Megaphone, Headphones, Trophy, Target, BookOpen, ListChecks, Menu, X } from "lucide-react";
import { SinoNotificacoes } from "./SinoNotificacoes";
import { useState, useEffect } from "react";

import { LogoNox } from "./LogoNox";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Button } from "./ui/button";
import { useAuth } from "./AuthProvider";

const adminItems = [
  { icon: LayoutDashboard, label: "Dashboard Admin", href: "/dashboard" },
  { icon: UserCheck, label: "Aprovações", href: "/admin/aprovacoes" },
  { icon: Search, label: "Consultas", href: "/admin/consultas" },
  { icon: FileText, label: "Contratos Ativos", href: "/admin/contratos" },
  { icon: UserCog, label: "Corretores", href: "/corretores-admin" },
  { icon: Users, label: "Usuários", href: "/admin/usuarios" },
  { icon: DollarSign, label: "Financeiro", href: "/admin/financeiro" },
  { icon: Wallet, label: "Faturamento", href: "/admin/faturamento" },
  { icon: ShieldAlert, label: "Sinistros", href: "/sinistros" },
  { icon: UserPlus, label: "Leads", href: "/admin/leads" },
  { icon: Gift, label: "Indicações", href: "/admin/indicacoes" },
  { icon: Briefcase, label: "Vagas abertas", href: "/admin/vagas" },
  { icon: Handshake, label: "Afiliados", href: "/admin/afiliados" },

  { icon: ShieldCheck, label: "Equipe e Permissões", href: "/admin/equipe-permissoes" },
  { icon: Settings, label: "Configurações", href: "/configuracoes" },
];


const corretorItems = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
  { icon: Search, label: "Nova Consulta", href: "/consultas/nova", highlight: true },
  { icon: History, label: "Minhas Consultas", href: "/consultas" },
  { icon: FileText, label: "Contratos Ativos", href: "/apolices" },
  { icon: Receipt, label: "Faturas Inquilinos", href: "/faturas-inquilinos" },
  { icon: DollarSign, label: "Minhas Comissões", href: "/minhas-comissoes" },
  
  { icon: Gift, label: "Indicação", href: "/indicacao" },
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
  { icon: Award, label: "Plano de Parceria", href: "/plano-carreira" },
  { icon: UserCog, label: "Meus Corretores", href: "/corretores-admin" },
  { icon: DollarSign, label: "Comissões", href: "/minhas-comissoes" },
  { icon: Gift, label: "Indicação", href: "/indicacao" },
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
  { icon: Gift, label: "Indicação", href: "/indicacao" },
  { icon: AlertCircle, label: "Abrir Sinistro", href: "/sinistros" },

  { icon: User, label: "Meu Perfil", href: "/configuracoes" },
];

const inquilinoItems = [
  { icon: FileText, label: "Documentos", href: "/inquilino/documentos" },
  { icon: Receipt, label: "Faturas", href: "/inquilino/faturas" },
  { icon: UserCircle, label: "Meu Perfil", href: "/inquilino/perfil" },
];

// Equipe NOX — colaboradores internos
// Admin Master usa o mesmo menu do Admin (admin_master === admin)
const adminMasterItems = adminItems;

const juridicoItems = [
  { icon: UserCheck, label: "Aprovações", href: "/admin/aprovacoes" },
  { icon: FileText, label: "Contratos Ativos", href: "/admin/contratos" },
  { icon: Scale, label: "Documentos", href: "/admin/usuarios" },
  { icon: User, label: "Meu Perfil", href: "/configuracoes" },
];

const financeiroItems = [
  { icon: DollarSign, label: "Financeiro", href: "/admin/financeiro" },
  { icon: Wallet, label: "Faturamento", href: "/admin/faturamento" },
  { icon: Receipt, label: "Faturas", href: "/faturas-inquilinos" },
  { icon: DollarSign, label: "Comissões", href: "/admin/saques" },
  { icon: User, label: "Meu Perfil", href: "/configuracoes" },
];

const marketingItems = [
  { icon: UserPlus, label: "Leads", href: "/admin/leads" },
  
  { icon: Handshake, label: "Afiliados", href: "/admin/afiliados" },
  { icon: User, label: "Meu Perfil", href: "/configuracoes" },
];

const suporteItems = [
  { icon: Headphones, label: "Chamados", href: "/suporte" },
  { icon: Users, label: "Usuários", href: "/admin/usuarios" },
  { icon: User, label: "Meu Perfil", href: "/configuracoes" },
];

const vendedorItems = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/vendedor" },
  { icon: Users, label: "Meus Leads", href: "/vendedor/leads" },
  { icon: ListChecks, label: "Pipeline", href: "/vendedor/pipeline" },
  { icon: Bell, label: "Minha Agenda", href: "/vendedor/agenda" },
  { icon: Target, label: "Minhas Metas", href: "/vendedor/metas" },
  { icon: DollarSign, label: "Minhas Comissões", href: "/vendedor/comissoes" },
  { icon: Trophy, label: "Ranking", href: "/vendedor/ranking" },
  { icon: User, label: "Meu Perfil", href: "/vendedor/perfil" },
];

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Fecha drawer ao trocar rota
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  const isCorretor = user?.role === "corretor";
  const isImobiliaria = user?.role === "imobiliaria";
  const isProprietario = user?.role === "proprietario";
  const isInquilino = user?.role === "inquilino";
  const isAdmin = user?.role === "admin" || user?.role === "analista";

  let menuItems = adminItems;
  if (isCorretor) menuItems = corretorItems;
  if (isImobiliaria) menuItems = imobiliariaItems;
  if (isProprietario) menuItems = proprietarioItems;
  if (isInquilino) menuItems = inquilinoItems;
  if (user?.role === "admin_master" || user?.internalRole === "admin_master") menuItems = adminMasterItems;
  if (user?.role === "juridico" || user?.internalRole === "juridico") menuItems = juridicoItems;
  if (user?.role === "financeiro" || user?.internalRole === "financeiro") menuItems = financeiroItems;
  if (user?.role === "marketing" || user?.internalRole === "marketing") menuItems = marketingItems;
  // Suporte não tem mais painel próprio — fica apenas dentro do Admin
  if (user?.role === "vendedor" || user?.internalRole === "vendedor") menuItems = vendedorItems;

  const handleLogout = () => {
    try { localStorage.removeItem("nox_user"); } catch {}
    import("@/integrations/supabase/client").then(({ supabase }) => {
      supabase.auth.signOut().catch(() => {});
    });
    window.location.href = "/";
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
        className={`w-64 border-r border-neutral-200 flex flex-col fixed inset-y-0 z-50 bg-white shadow-sm transition-transform duration-200 lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="px-6 py-7 lg:px-7 lg:py-8 border-b border-neutral-100 flex items-center justify-between">
          <div className="flex items-center gap-3" aria-label="NOX Fiança">
            <LogoNox variant="claro" size="md" />
          </div>
          <button
            className="lg:hidden p-2 text-neutral-500 hover:text-neutral-900"
            onClick={() => setMobileOpen(false)}
            aria-label="Fechar menu"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-4 py-6 space-y-1">
          {menuItems.map((item: any) => {
            const isActive = location.pathname === item.href;
            const isHighlight = item.highlight;
            return (
              <Link
                key={item.href}
                to={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                  isActive
                    ? "bg-neutral-900 text-white shadow-lg shadow-neutral-200 font-semibold"
                    : isHighlight
                      ? "bg-yellow-400 text-neutral-900 font-bold hover:bg-yellow-500 shadow-sm border border-yellow-500"
                      : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900"
                }`}
              >
                <item.icon size={20} strokeWidth={isActive || isHighlight ? 2.2 : 1.5} />
                <span className="text-sm">{item.label}</span>
              </Link>
            );
          })}

        </nav>

        <div className="p-6 border-t border-neutral-100 space-y-4">
           {(isCorretor || isImobiliaria || isProprietario) && (
            <div className="px-4 py-3 rounded-xl bg-[#FACC15] border border-neutral-900 mb-2">
              <p className="text-[10px] font-bold text-neutral-900 uppercase tracking-widest">Nível Atual</p>
              <p className="text-sm font-bold text-neutral-900">BRONZE</p>
            </div>
          )}
          <Button 
            variant="ghost" 
            className="w-full justify-start gap-3 text-neutral-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
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
              Bem-vindo, <span className="text-neutral-900 font-bold capitalize truncate">{user?.role || "Usuário"}</span>
              {user?.role === 'corretor' && <Medal className="w-4 h-4 text-[#FACC15] ml-1 shrink-0" />}
              {user?.role === 'imobiliaria' && <Building2 className="w-4 h-4 text-neutral-400 ml-1 shrink-0" />}
              {user?.role === 'proprietario' && <Home className="w-4 h-4 text-neutral-400 ml-1 shrink-0" />}
              <span className="w-1 h-1 rounded-full bg-neutral-300 mx-2 shrink-0"></span>
              <span className="text-xs truncate">{user?.email}</span>
            </div>
            <div className="sm:hidden text-sm font-bold text-neutral-900 capitalize truncate">
              {user?.role || "Usuário"}
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-6 shrink-0">
            <div className="flex items-center gap-4 sm:border-r sm:border-neutral-100 sm:pr-6">
              <SinoNotificacoes />
              <div className="hidden md:flex flex-col items-end">
                <span className="text-xs font-bold text-neutral-900 leading-none">Status Institucional</span>
                <span className="text-[10px] text-neutral-400 uppercase tracking-widest mt-1">Conectado</span>
              </div>
            </div>
            <Link to="/configuracoes" className="w-9 h-9 rounded-lg bg-neutral-100 border border-neutral-200 flex items-center justify-center text-xs font-bold text-neutral-900 uppercase hover:bg-yellow-400 transition-colors shrink-0">
              {user?.email?.substring(0, 2)}
            </Link>
          </div>

        </header>
        
        <div className="p-4 sm:p-6 lg:p-10 flex-1 overflow-x-hidden">
          {children}
        </div>
        
        <footer className="p-6 sm:p-8 text-center text-xs text-neutral-400 border-t border-neutral-100 font-medium bg-white">
          © 2025 NOX FIANÇA - Plataforma Institucional de Seguro Fiança Locatícia
        </footer>
      </main>
    </div>
  );
}
