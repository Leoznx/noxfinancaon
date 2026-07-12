import { createFileRoute, useNavigate, Link, useSearch } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Lock, Mail, Info, Settings, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { LogoNox } from "@/components/LogoNox";
import { z } from "zod";
import { redirectPathForRole } from "@/lib/authRedirect";
import { setCachedHeaderProfile } from "@/lib/profile-cache";
import { getRememberMe, setRememberMe } from "@/lib/authStorage";

const loginSearchSchema = z.object({
  returnTo: z.string().optional(),
});

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
          .select("status, role, nome, avatar_url")
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

  const INTERNAL_ROLE_SET = new Set([
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
    login(user.email, profile.role, user.id);

    if (returnTo === "/simular/resultado") {
      navigate({ to: "/simular/resultado" });
      return;
    }

    // Prioriza internalRole quando existir (cargo interno sobre profile.role='admin')
    let effectiveRole: string = profile.role;
    let internalRole: string | null =
      internalRoleHint && INTERNAL_ROLE_SET.has(internalRoleHint) ? internalRoleHint : null;
    if (!internalRole) {
      try {
        const { data: ir } = await supabase
          .from("internal_users" as any)
          .select("role,status")
          .eq("auth_user_id", user.id)
          .eq("status", "ativo")
          .maybeSingle();
        const r = (ir as any)?.role;
        if (r && INTERNAL_ROLE_SET.has(r)) internalRole = r;
      } catch (e) {
        console.warn("[login] internal role lookup failed", e);
      }
    }
    if (internalRole) effectiveRole = internalRole;

    navigate({
      to: (returnTo && returnTo !== "/login"
        ? returnTo
        : redirectPathForRole(effectiveRole)) as any,
    });
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
        .select("status, role, nome, avatar_url")
        .eq("id", authData.user.id)
        .single();

      if (profileError) throw profileError;

      await handleLoginSuccess(authData.user, profileData);
    } catch (error: any) {
      toast.error(error.message || "Erro ao realizar login");
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
    <div className="min-h-screen flex flex-col items-center justify-center bg-neutral-50 p-6">
      <div
        className="mb-10 flex items-center gap-3 cursor-pointer"
        onClick={() => navigate({ to: "/" })}
      >
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
                Acesso do{" "}
                {searchParams.perfil === "imobiliaria"
                  ? "Imobiliária"
                  : searchParams.perfil === "corretor"
                    ? "Corretor"
                    : "Proprietário"}
              </span>
            </div>
          )}
          <CardTitle className="text-2xl font-bold text-neutral-900 tracking-tight">
            Portal Institucional
          </CardTitle>
          <CardDescription className="text-neutral-500 font-medium mt-2">
            Acesse as ferramentas de gestão de seguro fiança.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-8 pb-10">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-neutral-700">
                  Identificação (E-mail)
                </label>
                <div className="relative">
                  <Mail
                    className="absolute left-3 top-3.5 text-neutral-400"
                    size={18}
                    strokeWidth={1.5}
                  />
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
                  <Link
                    to="/recuperar-acesso"
                    search={{ email: email || undefined }}
                    className="text-xs font-bold text-yellow-600 hover:text-yellow-700"
                  >
                    Recuperar acesso
                  </Link>
                </div>
                <div className="relative">
                  <Lock
                    className="absolute left-3 top-3.5 text-neutral-400"
                    size={18}
                    strokeWidth={1.5}
                  />
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="h-12 pl-10 pr-10 rounded-lg border-neutral-300 focus:ring-neutral-900"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    className="absolute right-3 top-3.5 text-neutral-400 hover:text-neutral-700"
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <EyeOff size={18} strokeWidth={1.5} />
                    ) : (
                      <Eye size={18} strokeWidth={1.5} />
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="lembrar-me"
                checked={lembrar}
                onCheckedChange={(checked) => setLembrar(checked === true)}
              />
              <label
                htmlFor="lembrar-me"
                className="text-sm font-medium text-neutral-600 cursor-pointer select-none"
              >
                Manter-se conectado
              </label>
            </div>

            <Button
              disabled={isLoading}
              className="w-full h-14 bg-neutral-900 text-white hover:bg-neutral-800 rounded-lg font-bold text-lg mt-4 shadow-lg shadow-neutral-100 transition-all"
            >
              {isLoading ? "Processando..." : "Entrar no sistema"}
            </Button>

            <div className="text-center pt-4">
              <p className="text-sm text-neutral-500 font-medium">
                Ainda não tem conta?{" "}
                <Link
                  to="/cadastro"
                  search={{
                    returnTo: returnTo || "/dashboard",
                    perfil: searchParams.perfil,
                  }}
                  className="text-yellow-600 font-bold hover:underline"
                >
                  Criar acesso
                </Link>
              </p>
            </div>
          </form>
        </CardContent>
      </Card>

      <p className="mt-10 text-[10px] text-neutral-400 font-medium uppercase tracking-[0.2em]">
        © 2025 NOX FIANÇA - Todos os direitos reservados.
      </p>
    </div>
  );
}
