import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, XCircle } from "lucide-react";
import { LogoNox } from "@/components/LogoNox";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  parseAuthEmailCallback,
  resolveTenantAccessReturnTo,
} from "@/lib/auth-email-links";

export const Route = createFileRoute("/acesso-inquilino")({
  component: AcessoInquilinoPage,
});

type Estado = "validando" | "sucesso" | "invalido";

function AcessoInquilinoPage() {
  const [estado, setEstado] = useState<Estado>("validando");

  useEffect(() => {
    let ativo = true;

    async function entrar() {
      const callback = parseAuthEmailCallback(window.location.href);
      const returnTo = resolveTenantAccessReturnTo(
        new URL(window.location.href).searchParams.get("returnTo"),
      );
      try {
        if (callback.error || callback.errorDescription) throw new Error("link_invalido");

        let confirmou = false;
        if (callback.tokenHash && callback.type === "magiclink") {
          const { data, error } = await supabase.auth.verifyOtp({
            token_hash: callback.tokenHash,
            type: "magiclink",
          });
          confirmou = !error && Boolean(data.session);
        } else if (callback.code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(callback.code);
          confirmou = !error && Boolean(data.session);
        } else if (callback.accessToken && callback.refreshToken) {
          const { data, error } = await supabase.auth.setSession({
            access_token: callback.accessToken,
            refresh_token: callback.refreshToken,
          });
          confirmou = !error && Boolean(data.session);
        }

        if (!confirmou) throw new Error("link_invalido");
        window.history.replaceState({}, "", window.location.pathname);
        if (ativo) setEstado("sucesso");
        window.setTimeout(() => window.location.replace(returnTo), 700);
      } catch (error) {
        console.error("[acesso-inquilino] falha ao validar acesso", error);
        window.history.replaceState({}, "", window.location.pathname);
        if (ativo) setEstado("invalido");
      }
    }

    void entrar();
    return () => {
      ativo = false;
    };
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-6 text-center">
      <div className="w-full max-w-md rounded-3xl border border-neutral-200 bg-white p-8 shadow-sm">
        <div className="mb-8 flex justify-center">
          <LogoNox variant="claro" size="sm" />
        </div>
        {estado === "validando" && (
          <>
            <LoaderCircle className="mx-auto mb-5 h-11 w-11 animate-spin text-yellow-500" />
            <h1 className="text-xl font-black text-neutral-900">Abrindo seu painel</h1>
            <p className="mt-2 text-sm text-neutral-500">Estamos validando seu acesso seguro.</p>
          </>
        )}
        {estado === "sucesso" && (
          <>
            <CheckCircle2 className="mx-auto mb-5 h-12 w-12 text-emerald-600" />
            <h1 className="text-xl font-black text-neutral-900">Acesso confirmado</h1>
            <p className="mt-2 text-sm text-neutral-500">Redirecionando para seu contrato ativo.</p>
          </>
        )}
        {estado === "invalido" && (
          <>
            <XCircle className="mx-auto mb-5 h-12 w-12 text-red-600" />
            <h1 className="text-xl font-black text-neutral-900">Link inválido ou já utilizado</h1>
            <p className="mt-2 text-sm text-neutral-500">
              Entre com o mesmo e-mail do contrato para acessar seu painel.
            </p>
            <Button className="mt-6 w-full" onClick={() => window.location.replace("/login")}>
              Ir para o login
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
