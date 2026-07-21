import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Settings, XCircle } from "lucide-react";
import { LogoNox } from "@/components/LogoNox";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { parseAuthEmailCallback, type AuthEmailCallbackType } from "@/lib/auth-email-links";

export const Route = createFileRoute("/email-verificado")({
  component: EmailVerificadoPage,
});

type Estado = "verificando" | "verificado" | "invalido";

const CONFIRMATION_TYPES = new Set<AuthEmailCallbackType>([
  "signup",
  "invite",
  "magiclink",
  "email_change",
  "email",
]);

function EmailVerificadoPage() {
  const navigate = useNavigate();
  const [estado, setEstado] = useState<Estado>("verificando");

  useEffect(() => {
    let ativo = true;

    const validar = async () => {
      const callback = parseAuthEmailCallback(window.location.href);
      let confirmou = false;

      try {
        if (callback.error || callback.errorDescription) return;

        if (callback.tokenHash) {
          if (!callback.type || !CONFIRMATION_TYPES.has(callback.type)) return;
          const { data, error } = await supabase.auth.verifyOtp({
            token_hash: callback.tokenHash,
            type: callback.type,
          });
          confirmou = !error && Boolean(data.session);
        } else if (callback.code) {
          if (callback.type && !CONFIRMATION_TYPES.has(callback.type)) return;
          const { data, error } = await supabase.auth.exchangeCodeForSession(callback.code);
          confirmou = !error && Boolean(data.session);
        } else if (callback.accessToken && callback.refreshToken) {
          if (!callback.type || !CONFIRMATION_TYPES.has(callback.type)) return;
          const { data, error } = await supabase.auth.setSession({
            access_token: callback.accessToken,
            refresh_token: callback.refreshToken,
          });
          confirmou = !error && Boolean(data.session);
        }

        if (confirmou) {
          // A confirmação não deve pular as regras normais do login, como a
          // aprovação documental. Encerra só a sessão temporária deste link.
          await supabase.auth.signOut({ scope: "local" }).catch(() => {});
        }
      } catch (error) {
        console.error("[email-verificado] falha ao confirmar o link", error);
      } finally {
        window.history.replaceState({}, "", window.location.pathname);
        if (ativo) setEstado(confirmou ? "verificado" : "invalido");
      }
    };

    void validar();
    return () => {
      ativo = false;
    };
  }, []);

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
            Este link de confirmação não é mais válido. Solicite um novo envio ou entre em contato
            caso já possua uma conta.
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
        <p>
          Seu e-mail foi confirmado. Agora entre normalmente; se o seu cadastro precisar de análise,
          o acesso será liberado após a aprovação.
        </p>
      </div>
      <Button
        onClick={() => navigate({ to: "/login" })}
        className="bg-neutral-900 hover:bg-neutral-800 text-white px-8 py-2.5 rounded-lg font-bold text-sm h-auto"
      >
        Ir para o login
      </Button>
    </div>
  );
}
