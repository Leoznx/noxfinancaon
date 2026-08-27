import React from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { LogoNox } from '../LogoNox';
import {
  UserRound, Building2, Home, KeyRound, Menu, X,
  User, Wallet, Lock, Bell, Award, LayoutDashboard, LogOut,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { redirectPathForRole } from '@/lib/authRedirect';
import { supabase } from '@/integrations/supabase/client';
import { getCachedHeaderProfile, setCachedHeaderProfile } from '@/lib/profile-cache';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

function PerfilTab({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="flex h-8 items-center whitespace-nowrap px-2.5 text-[15px] font-semibold text-neutral-700 transition-colors hover:text-neutral-950 2xl:px-3 2xl:text-base"
    >
      {label}
    </Link>
  );
}

// Mesmos ícones/rótulos/chaves de aba usados em src/routes/configuracoes.lazy.tsx —
// mantém o dropdown do header e a navegação interna de Configurações consistentes.
const PERFIL_MENU_ITEMS = [
  { tab: 'perfil', label: 'Perfil', icon: User },
  { tab: 'conta', label: 'Conta', icon: Building2 },
  { tab: 'financeiro', label: 'Financeiro', icon: Wallet },
  { tab: 'seguranca', label: 'Segurança', icon: Lock },
  { tab: 'notificacoes', label: 'Notificações', icon: Bell },
  { tab: 'comissoes', label: 'Plano e Nível', icon: Award },
] as const;

// Inquilino não tem comissão nem PIX — essas 2 abas não se aplicam. "Conta"
// fica visível porque é onde mora a verificação de documento.
const TABS_OCULTAS_PARA_INQUILINO = new Set(['financeiro', 'comissoes']);
// Admin não recebe comissão/Pix — mesma regra de src/routes/configuracoes.lazy.tsx.
const TABS_OCULTAS_PARA_ADMIN = new Set(["financeiro"]);

function menuItemsParaRole(
  role: string | null | undefined,
  internalRole: string | null | undefined,
) {
  const isAdminGeral = role === "admin" || internalRole === "admin_master";
  if (isAdminGeral) {
    return PERFIL_MENU_ITEMS.filter((item) => !TABS_OCULTAS_PARA_ADMIN.has(item.tab));
  }
  if (role !== 'inquilino') return PERFIL_MENU_ITEMS;
  return PERFIL_MENU_ITEMS.filter((item) => !TABS_OCULTAS_PARA_INQUILINO.has(item.tab));
}

/** Busca nome/avatar do profile pra exibir no header — AuthProvider só guarda email/role/internalRole. */
function useHeaderProfile(email: string | null | undefined) {
  const [profile, setProfile] = useState<{ nome: string | null; avatar_url: string | null } | null>(() => {
    const cached = getCachedHeaderProfile(email);
    return cached ? { nome: cached.nome, avatar_url: cached.avatarUrl } : null;
  });

  useEffect(() => {
    let active = true;
    if (!email) {
      setProfile(null);
      return;
    }

    const cached = getCachedHeaderProfile(email);
    if (cached) {
      setProfile({ nome: cached.nome, avatar_url: cached.avatarUrl });
    }

    supabase
      .from('profiles')
      .select('nome, avatar_url')
      .eq('email', email)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        const nextProfile = (data as any) ?? null;
        const profileFinal = nextProfile
          ? { nome: nextProfile.nome || cached?.nome || null, avatar_url: nextProfile.avatar_url || cached?.avatarUrl || null }
          : cached
            ? { nome: cached.nome, avatar_url: cached.avatarUrl }
            : null;
        setProfile(profileFinal);
        if (nextProfile) {
          setCachedHeaderProfile({
            email,
            nome: profileFinal?.nome || null,
            avatarUrl: profileFinal?.avatar_url || null,
          });
        }
      });
    return () => {
      active = false;
    };
  }, [email]);

  return profile;
}

function HeaderUserMenu({ align }: { align: 'desktop' | 'mobile' }) {
  const { user, logout } = useAuth();
  const profile = useHeaderProfile(user?.email);

  if (!user) {
    if (align === 'desktop') {
      return (
        <>
          <Link to="/login">
            <Button variant="ghost" className="h-11 rounded-xl px-3 text-sm font-semibold text-neutral-700">Entrar</Button>
          </Link>
          <Link to="/cadastro">
            <Button className="h-11 rounded-[14px] bg-neutral-950 px-4 text-sm font-bold text-white shadow-none transition-colors hover:bg-neutral-800">
              Cadastre-se
            </Button>
          </Link>
        </>
      );
    }
    return (
      <>
        <Link to="/login">
          <Button variant="outline" className="w-full h-12 font-bold text-neutral-900 border-neutral-200">Entrar</Button>
        </Link>
        <Link to="/cadastro">
          <Button className="w-full h-12 bg-neutral-900 text-white font-bold">Cadastre-se</Button>
        </Link>
      </>
    );
  }

  const dashboardTo = redirectPathForRole(user.internalRole || user.role);
  const inicial = (profile?.nome || user.email || '?').substring(0, 1).toUpperCase();

  if (align === 'mobile') {
    return (
      <>
        <Link to={dashboardTo as any}>
          <Button className="w-full h-12 bg-neutral-900 text-white font-bold gap-2">
            <LayoutDashboard className="w-4 h-4" /> Dashboard
          </Button>
        </Link>
        <div className="rounded-xl border border-neutral-200 overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 bg-neutral-50">
            <Avatar className="w-9 h-9">
              <AvatarImage src={profile?.avatar_url ?? undefined} alt={profile?.nome ?? user.email} />
              <AvatarFallback className="bg-yellow-400 text-neutral-900 font-bold">{inicial}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="text-sm font-bold text-neutral-900 truncate">{profile?.nome || user.email}</p>
              <p className="text-xs text-neutral-500 truncate">{user.email}</p>
            </div>
          </div>
          <nav className="flex flex-col divide-y divide-neutral-100">
            {menuItemsParaRole(user.role, user.internalRole).map(({ tab, label, icon: Icon }) => (
              <Link
                key={tab}
                to="/configuracoes"
                search={{ tab } as any}
                className="flex items-center gap-2.5 px-4 py-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                <Icon className="w-4 h-4 text-neutral-900" strokeWidth={2.2} /> {label}
              </Link>
            ))}
            <button
              type="button"
              onClick={() => logout()}
              className="flex items-center gap-2.5 px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 text-left"
            >
              <LogOut className="w-4 h-4" strokeWidth={2.2} /> Sair
            </button>
          </nav>
        </div>
      </>
    );
  }

  return (
    <>
      <Link to={dashboardTo as any}>
        <Button className="h-11 gap-2 rounded-[14px] bg-neutral-950 px-5 text-sm font-bold text-white shadow-none transition-colors hover:bg-neutral-800">
          <LayoutDashboard className="w-4 h-4" /> Dashboard
        </Button>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger className="outline-none rounded-full ring-offset-2 focus-visible:ring-2 focus-visible:ring-yellow-400">
          <Avatar className="h-11 w-11 border border-neutral-200 transition-colors hover:border-yellow-400">
            <AvatarImage src={profile?.avatar_url ?? undefined} alt={profile?.nome ?? user.email} />
            <AvatarFallback className="bg-yellow-400 text-neutral-900 font-bold">{inicial}</AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="font-normal">
            <p className="text-sm font-bold text-neutral-900 truncate">{profile?.nome || 'Minha conta'}</p>
            <p className="text-xs text-neutral-500 truncate">{user.email}</p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {menuItemsParaRole(user.role, user.internalRole).map(({ tab, label, icon: Icon }) => (
            <DropdownMenuItem key={tab} asChild>
              <Link to="/configuracoes" search={{ tab } as any} className="flex items-center gap-2 cursor-pointer">
                <Icon className="w-4 h-4 text-neutral-900" strokeWidth={2.2} /> {label}
              </Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => logout()} className="flex items-center gap-2 cursor-pointer text-red-600 focus:text-red-600">
            <LogOut className="w-4 h-4" strokeWidth={2.2} /> Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

export const InstitutionalHeader = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Sem isso, a página por trás continua rolável com o menu mobile aberto —
  // arrastar pra rolar o menu acabava rolando a home por baixo dele.
  useEffect(() => {
    if (!isMobileMenuOpen) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobileMenuOpen]);

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4">
      <div className="mx-auto flex h-[72px] w-full max-w-[1500px] items-center justify-between gap-4 rounded-[20px] border border-black/[0.06] bg-white px-4 shadow-[0_8px_30px_rgba(0,0,0,0.04)] sm:h-20 sm:px-6 xl:gap-5 xl:px-7">
        {/* Esquerda: Logo */}
        <Link to="/" className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity shrink-0">
          <LogoNox variant="claro" size="md" />
        </Link>

        {/* Centro: Menu principal + abas de perfil (Desktop) */}
        <nav className="hidden min-w-0 flex-1 items-center justify-center divide-x divide-neutral-200/80 xl:flex">
          <PerfilTab to="/seguro-fianca" label="Seguro Fiança" />
          <PerfilTab to="/planos" label="Planos" />
          <PerfilTab to="/contato" label="Contato" />
          <PerfilTab to="/corretor" label="Corretor" />
          <PerfilTab to="/imobiliaria" label="Imobiliária" />
          <PerfilTab to="/proprietario" label="Proprietário" />
          <PerfilTab to="/inquilino" label="Inquilino" />
        </nav>

        {/* Direita: Botões (Desktop) */}
        <div className="hidden shrink-0 items-center gap-3 border-l border-neutral-200/80 pl-4 xl:flex 2xl:gap-4 2xl:pl-5">
          <HeaderUserMenu align="desktop" />
        </div>

        {/* Menu Mobile Button */}
        <button
          type="button"
          aria-label={isMobileMenuOpen ? 'Fechar menu' : 'Abrir menu'}
          aria-expanded={isMobileMenuOpen}
          className="rounded-xl border border-neutral-200 p-2.5 text-neutral-700 transition-colors hover:bg-neutral-50 hover:text-neutral-950 xl:hidden"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        >
          {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile Menu Drawer */}
      {isMobileMenuOpen && (
          <div className="mx-auto mt-2 max-h-[calc(100dvh-6.75rem)] w-full max-w-[1500px] overflow-y-auto overscroll-contain rounded-[20px] border border-black/[0.06] bg-white shadow-[0_12px_32px_rgba(0,0,0,0.06)] xl:hidden">
            <div className="space-y-6 px-6 py-6">
              <nav className="flex flex-col gap-4">
                <Link to="/seguro-fianca" onClick={() => setIsMobileMenuOpen(false)} className="text-base font-medium text-neutral-600">Seguro Fiança</Link>
                <Link to="/planos" onClick={() => setIsMobileMenuOpen(false)} className="text-base font-medium text-neutral-600">Planos</Link>
                <Link to="/contato" onClick={() => setIsMobileMenuOpen(false)} className="text-base font-medium text-neutral-600">Contato</Link>
              </nav>

              <div className="pt-4 border-t border-neutral-100">
                <p className="text-xs font-bold uppercase tracking-widest text-neutral-400 mb-4">Acesse por perfil</p>
                <nav className="flex flex-col gap-3">
                  <Link to="/corretor" onClick={() => setIsMobileMenuOpen(false)} className="flex items-center gap-2 text-base font-medium text-neutral-700">
                    <UserRound className="w-5 h-5 text-neutral-900" strokeWidth={2.75} /> Corretor
                  </Link>
                  <Link to="/imobiliaria" onClick={() => setIsMobileMenuOpen(false)} className="flex items-center gap-2 text-base font-medium text-neutral-700">
                    <Building2 className="w-5 h-5 text-neutral-900" strokeWidth={2.75} /> Imobiliária
                  </Link>
                  <Link to="/proprietario" onClick={() => setIsMobileMenuOpen(false)} className="flex items-center gap-2 text-base font-medium text-neutral-700">
                    <Home className="w-5 h-5 text-neutral-900" strokeWidth={2.75} /> Proprietário
                  </Link>
                  <Link to="/inquilino" onClick={() => setIsMobileMenuOpen(false)} className="flex items-center gap-2 text-base font-medium text-neutral-700">
                    <KeyRound className="w-5 h-5 text-neutral-900" strokeWidth={2.75} /> Inquilino
                  </Link>
                </nav>
              </div>

              <div className="pt-4 flex flex-col gap-3" onClick={() => setIsMobileMenuOpen(false)}>
                <HeaderUserMenu align="mobile" />
              </div>
            </div>
          </div>
        )}
    </header>
  );
};
