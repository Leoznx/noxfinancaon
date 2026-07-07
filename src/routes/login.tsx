import { createFileRoute, useNavigate, Link, useSearch } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, User, Lock, Mail, Building2, UserCog, UserCircle2, UserRound, Home, Info, Scale, DollarSign, Megaphone, Headphones, Briefcase, Crown } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { LogoNox } from "@/components/LogoNox";
import { z } from "zod";


const loginSearchSchema = z.object({
  returnTo: z.string().optional(),
});

const DEMO_PASSWORD = "Teste@123";
const DEMO_PROFILES = [
  { email: "admin@nox.com", label: "Admin", icon: ShieldCheck, role: "admin", redirectTo: "/dashboard" },
  { email: "corretor@nox.com", label: "Corretor", icon: UserRound, role: "corretor", redirectTo: "/dashboard" },
  { email: "imobiliaria@nox.com", label: "Imob.", icon: Building2, role: "imobiliaria", redirectTo: "/imobiliaria" },
  { email: "proprietario@nox.com", label: "Prop.", icon: Home, role: "proprietario", redirectTo: "/proprietario" },
  { email: "inquilino.teste@nox.com", label: "Inquilino", icon: UserCircle2, role: "inquilino", redirectTo: "/inquilino/documentos" },
] as const;

const INTERNAL_PROFILES = [
  { email: "juridico@nox.com", label: "Jurídico", icon: Scale, role: "juridico", redirectTo: "/admin/aprovacoes" },
  { email: "financeiro@nox.com", label: "Financeiro", icon: DollarSign, role: "financeiro", redirectTo: "/admin/financeiro" },
  { email: "marketing@nox.com", label: "Marketing", icon: Megaphone, role: "marketing", redirectTo: "/admin/leads" },
  { email: "vendedor@nox.com", label: "Vendedor", icon: Briefcase, role: "vendedor", redirectTo: "/vendedor" },
] as const;

export const Route = createFileRoute("/login")({
  component: LoginComponent,
  validateSearch: (search) => loginSearchSchema.parse(search),
});

function LoginComponent() {
  const [isLoading, setIsLoading] = useState(false);
  const [canRepairDemoUsers, setCanRepairDemoUsers] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const { login } = useAuth();
  const searchParams = useSearch({ from: '/login' });
  const returnTo = searchParams.returnTo;
  const vindoDaSimulacao = returnTo?.includes('resultado');

  useEffect(() => {
    const checkPendingSim = () => {
      const pendingSim = localStorage.getItem('nox_simulacao_pendente');
      if (pendingSim && !vindoDaSimulacao) {
        toast.info("Você tem uma simulação pendente. Finalize o login para visualizá-la.");
      }
    };
    checkPendingSim();
  }, [vindoDaSimulacao]);

  useEffect(() => {
    const hostname = window.location.hostname.toLowerCase();
    setCanRepairDemoUsers(
      import.meta.env.DEV ||
      hostname.includes("localhost") ||
      hostname.includes("id-preview--") ||
      hostname.includes("-dev.lovable.app")
    );
  }, []);

  const INTERNAL_ROLE_SET = new Set(['admin_master','juridico','financeiro','marketing','suporte','vendedor']);

  const handleLoginSuccess = async (user: any, profile: any, internalRoleHint?: string | null) => {
    login(user.email, profile.role);

    if (returnTo === '/simular/resultado') {
      navigate({ to: "/simular/resultado" });
      return;
    }

    const redirectByRole = (role: string) => {
      switch (role) {
        case 'admin':         return '/dashboard';
        case 'admin_master':  return '/dashboard';
        case 'imobiliaria':   return '/dashboard';
        case 'corretor':      return '/dashboard';
        case 'proprietario':  return '/dashboard';
        case 'inquilino':     return '/inquilino/documentos';
        case 'juridico':      return '/admin/aprovacoes';
        case 'financeiro':    return '/admin/financeiro';
        case 'marketing':     return '/admin/leads';
        case 'suporte':       return '/suporte';
        case 'vendedor':      return '/vendedor';
        default:              return '/dashboard';
      }
    };

    // Prioriza internalRole quando existir (cargo interno sobre profile.role='admin')
    let effectiveRole: string = profile.role;
    let internalRole: string | null = internalRoleHint && INTERNAL_ROLE_SET.has(internalRoleHint) ? internalRoleHint : null;
    if (!internalRole) {
      try {
        const { data: ir } = await supabase
          .from('internal_users' as any)
          .select('role,status')
          .eq('auth_user_id', user.id)
          .eq('status', 'ativo')
          .maybeSingle();
        const r = (ir as any)?.role;
        if (r && INTERNAL_ROLE_SET.has(r)) internalRole = r;
      } catch (e) {
        console.warn('[login] internal role lookup failed', e);
      }
    }
    if (internalRole) effectiveRole = internalRole;

    navigate({ to: (returnTo && returnTo !== "/login" ? returnTo : redirectByRole(effectiveRole)) as any });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) throw authError;

      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('status, role')
        .eq('id', authData.user.id)
        .single();

      if (profileError) throw profileError;

      await handleLoginSuccess(authData.user, profileData);
    } catch (error: any) {
      toast.error(error.message || "Erro ao realizar login");
    } finally {
      setIsLoading(false);
    }
  };

  const repairDemoUsers = async (expectedEmail?: string) => {
    console.info('[demo-login] chamando ensure-demo-users');
    const { data, error } = await supabase.functions.invoke('ensure-demo-users', { body: { source: 'login' } });
    if (error) {
      console.error('[demo-login] erro da Edge Function ensure-demo-users', { error, data });
      throw new Error('Não foi possível acessar o usuário demo. Clique em “Reparar usuários demo” ou verifique a configuração do Supabase.');
    }
    // A function processa todos os perfis demo em lote e pode reportar ok:false porque um
    // perfil não relacionado falhou (ex.: enum de role incompleto). Isso não deve bloquear
    // o login de um perfil específico que já foi reparado com sucesso nesse mesmo lote.
    if (!data?.ok && expectedEmail) {
      const entry = data?.users?.find((u: any) => u.email === expectedEmail.toLowerCase().trim());
      if (!entry || entry.status === 'error') {
        console.error('[demo-login] reparo falhou para o perfil solicitado', { expectedEmail, entry, data });
        throw new Error('Não foi possível acessar o usuário demo. Clique em “Reparar usuários demo” ou verifique a configuração do Supabase.');
      }
      console.warn('[demo-login] outros perfis demo falharam no lote, mas o solicitado foi reparado', { expectedEmail, data });
    } else if (!data?.ok) {
      console.error('[demo-login] erro da Edge Function ensure-demo-users', { data });
      throw new Error('Não foi possível acessar o usuário demo. Clique em “Reparar usuários demo” ou verifique a configuração do Supabase.');
    }
    console.info('[demo-login] usuários demo verificados', data);
    return data;
  };

  const handleRepairDemoUsers = async () => {
    setIsLoading(true);
    try {
      await repairDemoUsers();
      toast.success('Usuários demo verificados com sucesso. Tente acessar novamente.');
    } catch (error: any) {
      console.error('[demo-login] reparo manual falhou', error);
      toast.error(error?.message || 'Não foi possível reparar os usuários demo.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDemoLogin = async (perfil: (typeof DEMO_PROFILES)[number]) => {
    setIsLoading(true);
    try {
      const userEmail = perfil.email;
      const role = perfil.role;
      console.info('[demo-login] perfil clicado', { role, email: userEmail, etapa: 'login_inicial' });

      // Limpa qualquer simulação pendente para não interferir no demo
      try { localStorage.removeItem('nox_simulacao_pendente'); } catch {}

      // 1) Tenta login direto (caso comum: usuário demo já existe)
      let { data, error } = await supabase.auth.signInWithPassword({
        email: userEmail,
        password: DEMO_PASSWORD,
      });

      // 2) Se falhou, garante o usuário no backend e tenta de novo
      if (error || !data?.user) {
        console.warn('[demo-login] login inicial falhou, reparando no backend', { email: userEmail, role, etapa: 'ensure-demo-users', error: error?.message });
        await repairDemoUsers(userEmail);

        console.info('[demo-login] tentando login novamente', { role, email: userEmail, etapa: 'login_retry' });
        const retry = await supabase.auth.signInWithPassword({ email: userEmail, password: DEMO_PASSWORD });
        if (retry.error || !retry.data?.user) {
          console.error('[demo-login] login pós-reparo falhou', { role, email: userEmail, error: retry.error });
          throw new Error('Não foi possível acessar o usuário demo. Clique em “Reparar usuários demo” ou verifique a configuração do Supabase.');
        }
        data = retry.data;
      }

      const { data: profileData } = await supabase
        .from('profiles')
        .select('status, role')
        .eq('id', data.user.id)
        .maybeSingle();

      await handleLoginSuccess(data.user, profileData ?? { role, status: 'ativo' }, role);
      toast.success(`Entrando como ${perfilLabel(userEmail)} (Modo Teste)`);
    } catch (error: any) {
      console.error('[demo-login] erro', error);
      toast.error(error?.message || 'Não foi possível acessar o usuário demo. Clique em “Reparar usuários demo” ou verifique a configuração do Supabase.');
    } finally {
      setIsLoading(false);
    }
  };

  const perfilLabel = (email: string) => {
    if (email.includes('admin')) return 'Administrador';
    if (email.includes('corretor')) return 'Corretor';
    if (email.includes('imobiliaria')) return 'Imobiliária';
    if (email.startsWith('inquilino')) return 'Inquilino';
    return 'Proprietário';
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-neutral-50 p-6">
      <div className="mb-10 flex items-center gap-3 cursor-pointer" onClick={() => navigate({ to: "/" })}>
        <LogoNox variant="claro" size="xl" />
      </div>

      <Card className="w-full max-w-md bg-white shadow-2xl border border-neutral-100 rounded-xl overflow-hidden">
        <CardHeader className="text-center pt-10 px-8">
          {vindoDaSimulacao && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4 flex items-start gap-2 text-left">
              <Info className="w-4 h-4 text-yellow-700 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
              <p className="text-sm text-neutral-700">
                <strong>Quase lá!</strong> Entre na sua conta para ver o resultado da simulação.
              </p>
            </div>
          )}
          {searchParams.perfil && (
            <div className="inline-flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-full px-4 py-1.5 mb-6 self-center mx-auto">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-yellow-800">
                Acesso do {searchParams.perfil === 'imobiliaria' ? 'Imobiliária' : searchParams.perfil === 'corretor' ? 'Corretor' : 'Proprietário'}
              </span>
            </div>
          )}
          <CardTitle className="text-2xl font-bold text-neutral-900 tracking-tight">Portal Institucional</CardTitle>
          <CardDescription className="text-neutral-500 font-medium mt-2">Acesse as ferramentas de gestão de seguro fiança.</CardDescription>
        </CardHeader>
        <CardContent className="p-8 pb-10">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-neutral-700">Identificação (E-mail)</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3.5 text-neutral-400" size={18} strokeWidth={1.5} />
                  <Input 
                    type="email" 
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="corporativo@empresa.com.br" 
                    className="h-12 pl-10 rounded-lg border-neutral-300 focus:ring-neutral-900"
                    required
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-semibold text-neutral-700">Senha de acesso</label>
                  <Link to="/privacidade" className="text-xs font-bold text-yellow-600 hover:text-yellow-700">Recuperar acesso</Link>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-3.5 text-neutral-400" size={18} strokeWidth={1.5} />
                  <Input 
                    type="password" 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••" 
                    className="h-12 pl-10 rounded-lg border-neutral-300 focus:ring-neutral-900"
                    required
                  />
                </div>
              </div>
            </div>

            <Button disabled={isLoading} className="w-full h-14 bg-neutral-900 text-white hover:bg-neutral-800 rounded-lg font-bold text-lg mt-4 shadow-lg shadow-neutral-100 transition-all">
              {isLoading ? "Processando..." : "Entrar no sistema"}
            </Button>

            <div className="text-center pt-4">
              <p className="text-sm text-neutral-500 font-medium">
                Ainda não tem conta? <Link 
                  to="/cadastro" 
                  search={{ 
                    returnTo: returnTo || '/dashboard',
                    perfil: searchParams.perfil 
                  }}
                  className="text-yellow-600 font-bold hover:underline"
                >
                  Criar acesso
                </Link>
              </p>
            </div>
          </form>

          <div className="relative my-8">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-neutral-100"></span>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-neutral-400 font-bold tracking-widest">ou acesse rapidamente</span>
            </div>
          </div>

          <div className="pt-2">
            <p className="text-xs text-center text-neutral-500 uppercase tracking-wider mb-3 font-medium">
              Escolha um perfil para entrar automaticamente
            </p>
            <div className="grid grid-cols-5 gap-2">
              {DEMO_PROFILES.map((perfil) => (
                <button 
                  key={perfil.role}
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleDemoLogin(perfil);
                  }}
                  disabled={isLoading}
                  className="flex flex-col items-center gap-1 p-3 border border-neutral-200 rounded-lg hover:border-yellow-400 hover:bg-yellow-50 active:bg-yellow-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <perfil.icon className="w-5 h-5 text-yellow-600" strokeWidth={1.5} />
                  <span className="text-[10px] font-medium text-neutral-700">{perfil.label}</span>
                </button>
              ))}
            </div>

            <p className="text-xs text-center text-neutral-500 uppercase tracking-wider mt-6 mb-3 font-medium">
              Equipe NOX (colaboradores internos)
            </p>
            <div className="grid grid-cols-3 gap-2">
              {INTERNAL_PROFILES.map((perfil) => (
                <button
                  key={perfil.role}
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleDemoLogin(perfil as any);
                  }}
                  disabled={isLoading}
                  className="flex flex-col items-center gap-1 p-3 border border-neutral-200 rounded-lg hover:border-yellow-400 hover:bg-yellow-50 active:bg-yellow-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <perfil.icon className="w-5 h-5 text-yellow-600" strokeWidth={1.5} />
                  <span className="text-[10px] font-medium text-neutral-700">{perfil.label}</span>
                </button>
              ))}
            </div>
            {canRepairDemoUsers && (
              <button
                type="button"
                onClick={handleRepairDemoUsers}
                disabled={isLoading}
                className="mt-4 w-full text-xs font-bold text-neutral-500 hover:text-neutral-900 underline underline-offset-4 disabled:opacity-50"
              >
                Reparar usuários demo
              </button>
            )}
          </div>
        </CardContent>
      </Card>
      
      <p className="mt-10 text-[10px] text-neutral-400 font-medium uppercase tracking-[0.2em]">
        © 2025 NOX FIANÇA - Todos os direitos reservados.
      </p>
    </div>
  );
}
