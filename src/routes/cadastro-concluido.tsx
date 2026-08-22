import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { LogoNox } from "@/components/LogoNox";
import { useAuth } from "@/components/AuthProvider";
import { redirectPathForRole } from "@/lib/authRedirect";
import { marcarCadastroConcluido, precisaMostrarCadastroConcluido } from "@/lib/primeiroAcesso";
import { trackCadastroConcluido } from "@/lib/tracking";

/**
 * URL de conversão do cadastro.
 *
 * Existe para que o Pixel da Meta e o Google Ads tenham um endereço próprio
 * para registrar "cadastro concluído". Ela aparece uma única vez, logo depois
 * do primeiro login de uma conta nova, e sai do caminho sozinha: assim que a
 * marcação é gravada no perfil, o usuário é levado ao painel e nunca mais volta
 * para cá — nem recarregando, nem navegando.
 */
export const Route = createFileRoute("/cadastro-concluido")({
  // URL de conversão, não uma página de conteúdo: fora do índice de busca.
  head: () => ({
    meta: [
      { title: "Cadastro concluído — NOX Fiança" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    destino: typeof search.destino === "string" ? search.destino : undefined,
  }),
  component: CadastroConcluidoPage,
});

/**
 * Telas de entrada/autenticação nunca servem como destino: mandar o usuário de
 * volta para `/login` logo depois de entrar o deixaria em looping.
 */
const DESTINOS_INVALIDOS = [
  "/cadastro-concluido",
  "/login",
  "/cadastro",
  "/email-verificado",
  "/acesso-inquilino",
  "/completar-acesso-inquilino",
  "/redefinir-senha",
  "/recuperar-acesso",
];

/** Só aceita caminho interno — impede que `?destino=` vire redirecionamento para fora do site. */
function destinoSeguro(destino: string | undefined, fallback: string): string {
  if (!destino) return fallback;
  if (!destino.startsWith("/") || destino.startsWith("//")) return fallback;
  if (DESTINOS_INVALIDOS.some((rota) => destino === rota || destino.startsWith(`${rota}/`) || destino.startsWith(`${rota}?`)))
    return fallback;
  return destino;
}

function CadastroConcluidoPage() {
  const navigate = useNavigate();
  const { destino } = Route.useSearch();
  const { user, isLoading } = useAuth();
  const [conversaoRegistrada, setConversaoRegistrada] = useState(false);
  const jaProcessouRef = useRef(false);

  useEffect(() => {
    if (isLoading || jaProcessouRef.current) return;

    // Sem sessão não há cadastro para comemorar — nem conversão para contar.
    if (!user) {
      jaProcessouRef.current = true;
      navigate({ to: "/login", replace: true });
      return;
    }

    jaProcessouRef.current = true;
    const proximaTela = destinoSeguro(destino, redirectPathForRole(user.internalRole || user.role));

    (async () => {
      // Recarregar a página ou digitar a URL na mão não pode contar a conversão
      // de novo: quem já foi marcado sai daqui na hora, sem disparar pixel.
      const primeiroAcesso = await precisaMostrarCadastroConcluido(user.id);
      if (!primeiroAcesso) {
        navigate({ to: proximaTela as any, replace: true });
        return;
      }

      trackCadastroConcluido();
      setConversaoRegistrada(true);
      await marcarCadastroConcluido(user.id);

      // Pequena pausa para o pixel enviar a requisição antes da troca de rota.
      window.setTimeout(() => navigate({ to: proximaTela as any, replace: true }), 1200);
    })();
  }, [destino, isLoading, navigate, user]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 p-6 text-center">
      <div className="mb-10">
        <LogoNox variant="claro" size="sm" />
      </div>
      <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-full bg-yellow-100 text-yellow-600">
        <CheckCircle2 size={48} />
      </div>
      <h1 className="mb-4 text-3xl font-bold text-neutral-900">Cadastro concluído!</h1>
      <p className="max-w-md text-neutral-600">
        Sua conta está pronta. Estamos abrindo o seu painel...
      </p>
      <span className="sr-only" aria-live="polite">
        {conversaoRegistrada ? "Cadastro concluído. Redirecionando." : "Finalizando cadastro."}
      </span>
    </main>
  );
}
