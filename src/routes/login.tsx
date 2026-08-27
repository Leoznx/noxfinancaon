import { createFileRoute, useNavigate, Link, useSearch } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowRight, Eye, EyeOff, Headphones, Info, Lock, Settings, UserRound } from "lucide-react";
import { useAuth, type InternalRole } from "@/components/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { LogoNox } from "@/components/LogoNox";
import { z } from "zod";
import { redirectPathForRole } from "@/lib/authRedirect";
import { ROTA_CADASTRO_CONCLUIDO, jaMarcadoLocalmente } from "@/lib/primeiroAcesso";
import { setCachedHeaderProfile } from "@/lib/profile-cache";
import { getRememberMe, setRememberMe } from "@/lib/authStorage";
import { useServerFn } from "@tanstack/react-start";
import { resendVerificationEmail } from "@/lib/auth-signup.functions";
import { isEmailNotConfirmedError } from "@/lib/auth-errors";

const loginSearchSchema = z.object({
  returnTo: z.string().optional(),
  perfil: z.enum(["corretor", "imobiliaria", "proprietario", "inquilino"]).optional(),
});

const cadastroRouteByPerfil = {
  corretor: "/cadastro-corretor",
  imobiliaria: "/cadastro-imobiliaria",
  proprietario: "/cadastro-proprietario",
  inquilino: "/cadastro-inquilino",
} as const;

export const Route = createFileRoute("/login")({
  component: LoginComponent,
  validateSearch: (search) => loginSearchSchema.parse(search),
});

function LoginComponent() {
  const [isLoading, setIsLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [lembrar, setLembrar] = useState(true);
  const navigate = useNavigate();
  const { login } = useAuth();
  const resendVerificationFn = useServerFn(resendVerificationEmail);
  const searchParams = useSearch({ from: "/login" });
  const returnTo = searchParams.returnTo;
  const vindoDaSimulacao = returnTo?.includes("resultado");

  useEffect(() => {
    setLembrar(getRememberMe());
  }, []);

  useEffect(() => {
    const checkPendingSim = () => {
      const pendingSim = localStorage.getItem("nox_simulacao_pendente");
      if (pendingSim && !vindoDaSimulacao) {
        toast.info("Você tem uma simulação pendente. Finalize o login para visualizá-la.");
      }
    };
    checkPendingSim();
  }, [vindoDaSimulacao]);

  // Se já existe uma sessão válida (ex.: "Manter-se conectado" trouxe o usuário de volta
  // logado), pula direto pro dashboard em vez de mostrar o formulário de login de novo —
  // sem piscar a tela: só libera o formulário depois de confirmar que NÃO há sessão.
  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!ativo) return;
        if (!session?.user) {
          setCheckingSession(false);
          return;
        }
        const { data: profileData } = await supabase
          .from("profiles")
          .select("status, role, nome, avatar_url, cadastro_concluido_em")
          .eq("id", session.user.id)
          .maybeSingle();
        if (!ativo) return;
        if (profileData) {
          await handleLoginSuccess(session.user, profileData);
          return;
        }
      } catch (e) {
        console.warn("[login] verificação de sessão existente falhou", e);
      }
      if (ativo) setCheckingSession(false);
    })();
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const INTERNAL_ROLE_SET = new Set<InternalRole>([
    "admin_master",
    "juridico",
    "financeiro",
    "marketing",
    "suporte",
    "vendedor",
  ]);

  const handleLoginSuccess = async (user: any, profile: any, internalRoleHint?: string | null) => {
    setCachedHeaderProfile({
      email: user.email,
      nome: profile?.nome || user.user_metadata?.nome || user.user_metadata?.full_name || null,
      avatarUrl: profile?.avatar_url || null,
    });
    // Prioriza internalRole quando existir (cargo interno sobre profile.role='admin')
    let effectiveRole: string = profile.role;
    let internalRole: InternalRole | null =
      internalRoleHint && INTERNAL_ROLE_SET.has(internalRoleHint as InternalRole)
        ? (internalRoleHint as InternalRole)
        : null;
    if (!internalRole) {
      try {
        const { data: ir } = await supabase
          .from("internal_users" as any)
          .select("role,status")
          .eq("auth_user_id", user.id)
          .maybeSingle();
        const r = (ir as any)?.role;
        if ((ir as any)?.status === "ativo" && r && INTERNAL_ROLE_SET.has(r as InternalRole)) {
          internalRole = r as InternalRole;
        } else if (!ir && INTERNAL_ROLE_SET.has(profile.role as InternalRole)) {
          // Compatibilidade com contas internas antigas, anteriores à tabela
          // internal_users, cujo cargo ainda vive somente em profiles.role.
          internalRole = profile.role as InternalRole;
        }
      } catch (e) {
        console.warn("[login] internal role lookup failed", e);
        if (INTERNAL_ROLE_SET.has(profile.role as InternalRole)) {
          internalRole = profile.role as InternalRole;
        }
      }
    }
    if (internalRole) effectiveRole = internalRole;
    login(user.email, profile.role, user.id, internalRole);

    if (returnTo === "/simular/resultado") {
      irPara("/simular/resultado", user.id, profile);
      return;
    }

    irPara(
      returnTo && returnTo !== "/login" ? returnTo : redirectPathForRole(effectiveRole),
      user.id,
      profile,
    );
  };

  /**
   * Conta nova entra pela URL de conversão (`/cadastro-concluido`) antes do
   * destino final — é lá que o Pixel da Meta e o Google Ads registram o
   * cadastro. Quem já passou por ela (ou já era cliente) vai direto ao destino:
   * `cadastro_concluido_em` só é nulo no primeiro acesso.
   */
  const irPara = (destino: string, userId: string, profile: any) => {
    const primeiroAcesso = profile?.cadastro_concluido_em == null && !jaMarcadoLocalmente(userId);

    if (primeiroAcesso) {
      navigate({
        to: ROTA_CADASTRO_CONCLUIDO,
        search: { destino },
        replace: true,
      });
      return;
    }

    navigate({ to: destino as any });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Precisa ser setado ANTES do signInWithPassword: o storage dinâmico do client
      // Supabase (src/lib/authStorage.ts) consulta essa preferência no exato momento em
      // que a sessão é gravada, então setar depois não teria efeito na sessão recém-criada.
      setRememberMe(lembrar);
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) throw authError;

      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("status, role, nome, avatar_url, cadastro_concluido_em")
        .eq("id", authData.user.id)
        .single();

      if (profileError) throw profileError;

      await handleLoginSuccess(authData.user, profileData);
    } catch (error: any) {
      if (isEmailNotConfirmedError(error)) {
        try {
          await resendVerificationFn({ data: { email: email.trim().toLowerCase() } });
          toast.success(
            "Seu e-mail ainda não foi confirmado. Reenviamos um novo link de verificação. Confira sua caixa de entrada e o spam.",
            { duration: 8000 },
          );
        } catch {
          toast.info(
            "Seu e-mail ainda não foi confirmado. Não foi possível reenviar o link agora; tente novamente em alguns instantes.",
            { duration: 8000 },
          );
        }
      } else {
        toast.error(error.message || "Erro ao realizar login");
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-neutral-50 p-6">
        <LogoNox variant="claro" size="xl" />
        <Settings
          className="w-8 h-8 text-yellow-500 animate-spin mt-10"
          strokeWidth={1.5}
          style={{ animationDuration: "2.5s" }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#f7f6f3] lg:h-[100dvh] lg:overflow-hidden">
      <div className="flex min-h-[100dvh] flex-col overflow-hidden border border-neutral-200 bg-white lg:h-[100dvh] lg:rounded-[18px]">
        <main className="grid min-h-0 flex-1 lg:grid-cols-2">
          <Link
            to="/"
            aria-label="Voltar para a página inicial"
            className="relative block aspect-square overflow-hidden bg-[#fff9ec] lg:aspect-auto"
          >
            <img
              src="/brand/nox-login-hero.png"
              alt="NOX Fiança: gestão segura, ágil e com suporte dedicado"
              className="h-full w-full object-contain"
            />
          </Link>

          <section className="relative flex min-h-0 items-center justify-center bg-[radial-gradient(circle_at_85%_15%,rgba(250,204,21,0.06),transparent_26%),#fff] px-5 pb-12 pt-24 sm:px-8 lg:overflow-y-auto lg:px-12 lg:py-20 xl:px-16">
            <Link
              to="/contato"
              search={searchParams.perfil ? { perfil: searchParams.perfil } : {}}
              className="absolute right-5 top-5 inline-flex h-12 items-center gap-3 rounded-xl border border-neutral-200 bg-white px-5 text-sm font-medium text-neutral-800 shadow-sm transition-colors hover:border-yellow-400 hover:bg-yellow-50 sm:right-8 sm:top-8 lg:right-[72px] lg:top-10"
            >
              <Headphones size={19} strokeWidth={1.7} />
              Precisa de ajuda?
            </Link>

            <div className="my-auto w-full max-w-[640px] rounded-[28px] border border-neutral-200 bg-white px-6 py-9 shadow-[0_20px_60px_rgba(15,15,15,0.06)] sm:px-10 lg:translate-y-8 lg:px-12 xl:px-16 xl:py-14">
              <header className="text-center">
                <h1 className="text-[28px] font-extrabold tracking-[-0.04em] text-neutral-950 sm:text-[30px]">
                  Bem-vindo de volta!
                </h1>
                <p className="mt-2 text-sm font-medium text-neutral-500 sm:text-[15px]">
                  Faça login para continuar acessando sua conta.
                </p>
              </header>

              <form onSubmit={handleSubmit} className="mt-9 space-y-5">
                {vindoDaSimulacao && (
                  <div className="flex items-start gap-2 rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-left">
                    <Info
                      className="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-700"
                      strokeWidth={1.5}
                    />
                    <p className="text-sm text-neutral-700">
                      <strong>Quase lá!</strong> Entre na sua conta para ver o resultado da
                      simulação.
                    </p>
                  </div>
                )}

                {searchParams.perfil && (
                  <div className="mx-auto w-fit rounded-full border border-yellow-200 bg-yellow-50 px-4 py-1.5">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-yellow-800">
                      Acesso do{" "}
                      {searchParams.perfil === "imobiliaria"
                        ? "Imobiliária"
                        : searchParams.perfil === "corretor"
                          ? "Corretor"
                          : searchParams.perfil === "inquilino"
                            ? "Inquilino"
                            : "Proprietário"}
                    </span>
                  </div>
                )}

                <div className="space-y-2">
                  <label htmlFor="login-email" className="text-sm font-medium text-neutral-800">
                    E-mail ou usuário
                  </label>
                  <div className="relative">
                    <UserRound
                      className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500"
                      size={20}
                      strokeWidth={1.5}
                    />
                    <Input
                      id="login-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Digite seu e-mail ou usuário"
                      autoComplete="email"
                      className="h-14 rounded-xl border-neutral-300 bg-white pl-12 text-[15px] shadow-none placeholder:text-neutral-400 focus-visible:border-yellow-500 focus-visible:ring-yellow-400/30"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="login-password" className="text-sm font-medium text-neutral-800">
                    Senha
                  </label>
                  <div className="relative">
                    <Lock
                      className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500"
                      size={20}
                      strokeWidth={1.5}
                    />
                    <Input
                      id="login-password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Digite sua senha"
                      autoComplete="current-password"
                      className="h-14 rounded-xl border-neutral-300 bg-white pl-12 pr-12 text-[15px] shadow-none placeholder:text-neutral-400 focus-visible:border-yellow-500 focus-visible:ring-yellow-400/30"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-neutral-500 transition-colors hover:text-neutral-900"
                      aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    >
                      {showPassword ? (
                        <EyeOff size={20} strokeWidth={1.5} />
                      ) : (
                        <Eye size={20} strokeWidth={1.5} />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2.5">
                    <Checkbox
                      id="lembrar-me"
                      checked={lembrar}
                      onCheckedChange={(checked) => setLembrar(checked === true)}
                      className="h-6 w-6 rounded-md border-neutral-300 data-[state=checked]:border-yellow-400 data-[state=checked]:bg-yellow-400 data-[state=checked]:text-neutral-950"
                    />
                    <label
                      htmlFor="lembrar-me"
                      className="cursor-pointer select-none text-sm font-medium text-neutral-600"
                    >
                      Lembrar de mim
                    </label>
                  </div>
                  <Link
                    to="/recuperar-acesso"
                    search={{ email: email || undefined }}
                    className="text-right text-xs font-bold text-[#d9a900] transition-colors hover:text-yellow-700 sm:text-sm"
                  >
                    Esqueci minha senha
                  </Link>
                </div>

                <Button
                  disabled={isLoading}
                  className="relative h-14 w-full rounded-xl bg-gradient-to-r from-[#ffc400] to-[#ffd20a] text-base font-extrabold text-neutral-950 shadow-[0_8px_20px_rgba(245,190,0,0.18)] transition-all hover:from-[#f4bb00] hover:to-[#f7c900]"
                >
                  {isLoading ? "Processando..." : "Entrar"}
                  {!isLoading && (
                    <ArrowRight className="absolute right-5" size={21} strokeWidth={2.2} />
                  )}
                </Button>

                <div className="flex items-center gap-5 py-1" aria-hidden="true">
                  <span className="h-px flex-1 bg-neutral-200" />
                  <span className="text-xs font-medium text-neutral-500">ou</span>
                  <span className="h-px flex-1 bg-neutral-200" />
                </div>

                <Link
                  to={
                    searchParams.perfil ? cadastroRouteByPerfil[searchParams.perfil] : "/cadastro"
                  }
                  search={returnTo && returnTo !== "/dashboard" ? { returnTo } : {}}
                  className="flex min-h-16 items-center gap-4 rounded-xl border border-neutral-200 bg-white px-5 text-sm font-semibold text-neutral-900 transition-colors hover:border-yellow-300 hover:bg-yellow-50"
                >
                  <UserRound size={22} strokeWidth={1.6} />
                  <span className="flex-1">
                    Primeiro acesso? <strong className="text-[#d9a900]">Solicitar conta</strong>
                  </span>
                  <ArrowRight size={19} strokeWidth={2} />
                </Link>
              </form>
            </div>
          </section>
        </main>

        <footer className="flex min-h-16 items-center justify-center border-t border-neutral-200 bg-white px-5 py-4 text-center text-xs font-medium text-neutral-500 sm:text-sm lg:min-h-[72px]">
          © {new Date().getFullYear()} NOX FIANÇA&nbsp; · &nbsp;Plataforma Institucional de Seguro
          Fiança Locatícia
        </footer>
      </div>
    </div>
  );
}
