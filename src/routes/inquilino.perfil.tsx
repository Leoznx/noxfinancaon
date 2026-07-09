import { createFileRoute, redirect } from "@tanstack/react-router";

// Rota antiga — a página de perfil do inquilino agora é /configuracoes (mesma
// experiência de Perfil/Segurança/Notificações usada pelos outros papéis).
// Mantido só como redirect pra não quebrar links/favoritos antigos.
export const Route = createFileRoute("/inquilino/perfil")({
  beforeLoad: () => {
    throw redirect({ to: "/configuracoes" });
  },
});
