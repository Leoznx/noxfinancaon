import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Settings } from "lucide-react";
import { LogoNox } from "@/components/LogoNox";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/AuthProvider";
import { redirectPathForRole } from "@/lib/authRedirect";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/email-verificado")({
  component: EmailVerificadoPage,
});

type Estado = "verificando" | "verificado" | "invalido";

/**
 * Mesma lógica de leitura de /redefinir-senha.tsx: o link de confirmação pode
 * chegar como PKCE (`?code=...`) ou fluxo implícito (`#access_token=...`,
 * processado automaticamente pelo client ao inicializar), e o GoTrue pode já
 * ter marcado o link como expirado/inválido antes de chegar aqui
 * (`?error=...&error_description=...`, em query OU hash).
 */
function lerParametrosConfirmacao() {
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const errorDescription =
    url.searchParams.get("error_description") || hashParams.get("error_description");
  const code = url.searchParams.get("code");
  const temHashSession = !!hashParams.get("access_token");
  return { errorDescription, code, temHashSession };
}

function EmailVerificadoPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [estado, setEstado] = useState<Estado>("verificando");

  useEffect(() => {
    let ativo = true;

    const validar = async () => {
      const { errorDescription, code, temHashSession } = lerParametrosConfirmacao();

      if (errorDescription) {
        window.history.replaceState({}, "", window.location.pathname);
        if (ativo) setEstado("invalido");
        return;
      }

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        window.history.replaceState({}, "", window.location.pathname);
        if (!ativo) return;
        setEstado(error ? "invalido" : "verificado");
        return;
      }

      if (temHashSession) {
        // Fluxo implícito: o client já processa o hash ao inicializar.
        window.history.replaceState({}, "", window.location.pathname);
        const { data } = await supabase.auth.getSession();
        if (!ativo) return;
        setEstado(data.session ? "verificado" : "invalido");
        return;
      }

      // Sem nenhum parâmetro de confirmação: só é válido se já existir uma sessão
      // ativa (ex.: usuário já verificado clicou no link de novo, ou voltou pra
      // essa rota já logado) — nunca mostra "verificado" sem nenhuma evidência.
      const { data } = await supabase.auth.getSession();
      if (!ativo) return;
      setEstado(data.session ? "verificado" : "invalido");
    };

    validar();
    return () => {
      ativo = false;
    };
  }, []);

  const handleEntrar = () => {
    const to = user ? redirectPathForRole(user.internalRole || user.role) : "/login";
    navigate({ to: to as any });
  };

  if (estado === "verificando") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-neutral-50 p-6 text-center">
        <div className="mb-10">
          <LogoNox variant="claro" size="sm" />
        </div>
        <Settings
          className="w-10 h-10 text-yellow-500 animate-spin mb-6"
          strokeWidth={1.5}
          style={{ animationDuration: "2.5s" }}
        />
        <p className="text-neutral-600 font-semibold">Verificando seu e-mail...</p>
      </div>
    );
  }

  if (estado === "invalido") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-neutral-50 p-6 text-center">
        <div className="mb-10">
          <LogoNox variant="claro" size="sm" />
        </div>
        <div className="w-20 h-20 bg-red-50 border border-red-200 rounded-full flex items-center justify-center mb-8 text-red-600">
          <XCircle size={44} strokeWidth={1.5} />
        </div>
        <h1 className="text-2xl font-bold text-neutral-900 mb-4">Link inválido ou expirado</h1>
        <div className="max-w-md text-neutral-600 space-y-4 mb-10">
          <p>
            Este link de confirmação não é mais válido. Solicite um novo cadastro ou entre em
            contato caso já possua uma conta.
          </p>
        </div>
        <Button
          onClick={() => navigate({ to: "/login" })}
          className="bg-neutral-900 hover:bg-neutral-800 text-white px-8 py-2.5 rounded-lg font-bold text-sm h-auto"
        >
          Voltar para o login
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-neutral-50 p-6 text-center">
      <div className="mb-10">
        <LogoNox variant="claro" size="sm" />
      </div>
      <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center mb-8 text-yellow-600">
        <CheckCircle2 size={48} />
      </div>
      <h1 className="text-3xl font-bold text-neutral-900 mb-4">E-mail verificado com sucesso!</h1>
      <div className="max-w-md text-neutral-600 space-y-4 mb-10">
        <p>Sua conta foi confirmada. Agora você já pode acessar a plataforma NOX Fiança.</p>
      </div>
      <Button
        onClick={handleEntrar}
        className="bg-neutral-900 hover:bg-neutral-800 text-white px-8 py-2.5 rounded-lg font-bold text-sm h-auto"
      >
        Entrar na plataforma
      </Button>
    </div>
  );
}
