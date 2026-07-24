import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Smartphone } from "lucide-react";
import { z } from "zod";
import { LogoNox } from "@/components/LogoNox";
import { Button } from "@/components/ui/button";

const searchSchema = z.object({
  token_hash: z.string().min(1).optional(),
  type: z.literal("magiclink").optional(),
  returnTo: z.literal("/inquilino/documentos").optional(),
});

export const Route = createFileRoute("/abrir-app/documentos")({
  validateSearch: (search) => searchSchema.parse(search),
  component: AbrirDocumentosNoAplicativoPage,
});

function AbrirDocumentosNoAplicativoPage() {
  const search = Route.useSearch();
  const [tentativaConcluida, setTentativaConcluida] = useState(false);
  const links = useMemo(() => {
    const firstAccess = Boolean(search.token_hash && search.type === "magiclink");
    if (!firstAccess && (search.token_hash || search.type)) return null;

    const app = new URL(
      firstAccess ? "noxfianca://acesso-inquilino" : "noxfianca://inquilino/documentos",
    );
    if (firstAccess && search.token_hash) {
      app.searchParams.set("token_hash", search.token_hash);
      app.searchParams.set("type", "magiclink");
      app.searchParams.set("returnTo", "/inquilino/documentos");
    }

    let site = "/inquilino/documentos";
    if (firstAccess && search.token_hash) {
      const siteParams = new URLSearchParams({
        token_hash: search.token_hash,
        type: "magiclink",
        returnTo: "/inquilino/documentos",
      });
      site = `/acesso-inquilino?${siteParams.toString()}`;
    }

    return {
      app: app.toString(),
      site,
    };
  }, [search.token_hash, search.type]);

  useEffect(() => {
    if (!links) return;

    window.history.replaceState({}, "", window.location.pathname);
    window.location.href = links.app;
    const timer = window.setTimeout(() => setTentativaConcluida(true), 1400);
    return () => window.clearTimeout(timer);
  }, [links]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-6 text-center">
      <div className="w-full max-w-md rounded-3xl border border-neutral-200 bg-white p-8 shadow-sm">
        <div className="mb-8 flex justify-center">
          <LogoNox variant="claro" size="sm" />
        </div>
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-yellow-100 text-yellow-700">
          <Smartphone className="h-7 w-7" />
        </div>
        <h1 className="text-xl font-black text-neutral-900">
          {links ? "Abrindo seus documentos" : "Link de acesso inválido"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-neutral-500">
          {links
            ? "O aplicativo da NOX Fiança abrirá diretamente no seu acesso de inquilino."
            : "Solicite um novo acesso aos documentos pela NOX Fiança."}
        </p>

        {links && (
          <div className="mt-7 grid gap-3">
            <Button
              className="h-11 w-full bg-neutral-900 text-white hover:bg-neutral-800"
              onClick={() => {
                window.location.href = links.app;
              }}
            >
              <Smartphone />
              Abrir aplicativo
            </Button>
            {tentativaConcluida && (
              <Button asChild variant="outline" className="h-11 w-full">
                <a href={links.site}>
                  <ExternalLink />
                  Continuar pelo site
                </a>
              </Button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
