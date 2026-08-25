import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DEMO_PROFILES, isDemoProfileKey } from "@/lib/demo-accounts";
import { activateDemoSession, clearDemoSession } from "@/lib/demo-session";

export const Route = createFileRoute("/demo/$perfil")({
  component: DemoAccountBootstrap,
});

function DemoAccountBootstrap() {
  const { perfil } = Route.useParams();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isDemoProfileKey(perfil)) {
      setError("Conta de demonstração inválida.");
      return;
    }

    let active = true;
    const profile = DEMO_PROFILES[perfil];
    activateDemoSession(perfil);

    void import("@/integrations/supabase/client")
      .then(async ({ supabase }) => {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: profile.email,
          password: profile.password,
        });

        if (!active) return;
        if (signInError || !data.user) {
          clearDemoSession();
          setError("Não foi possível abrir esta conta agora. Tente novamente.");
          return;
        }

        const { data: account } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", data.user.id)
          .maybeSingle();

        if (!active) return;
        if (account?.role !== perfil) {
          await supabase.auth.signOut({ scope: "local" });
          clearDemoSession();
          setError("O perfil da conta de demonstração está incorreto.");
          return;
        }

        window.location.replace(profile.startPath);
      })
      .catch((cause) => {
        console.error("[Demo] Não foi possível iniciar a conta demonstrativa.", cause);
        if (!active) return;
        clearDemoSession();
        setError("Não foi possível abrir esta conta agora. Tente novamente.");
      });

    return () => {
      active = false;
    };
  }, [perfil]);

  return (
    <main className="grid min-h-screen place-items-center bg-neutral-50 p-6">
      {error ? (
        <div className="max-w-md text-center">
          <p className="font-bold text-neutral-900">{error}</p>
          <button
            type="button"
            onClick={() => window.close()}
            className="mt-4 rounded-xl bg-neutral-950 px-5 py-3 text-sm font-bold text-white"
          >
            Fechar
          </button>
        </div>
      ) : (
        <div
          className="h-9 w-9 animate-spin rounded-full border-4 border-yellow-400 border-t-transparent"
          aria-label="Abrindo conta"
        />
      )}
    </main>
  );
}
