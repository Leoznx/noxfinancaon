import { createFileRoute, Navigate } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/ProtectedRoute";

// Rota legada: a UI vive em /admin/equipe-nox. Mantemos o redirect para nao
// quebrar links e bookmarks antigos; nenhum componente ou handler acompanha
// esta tela mais - o restante do codigo que estava aqui era dead code que
// puxava server-functions para o bundle sem motivo.

export const Route = createFileRoute("/admin/conta-nox")({
  component: () => (
    <ProtectedRoute roles={["admin", "admin_master", "analista"]}>
      <Navigate to="/admin/equipe-nox" search={{ tab: "colaboradores" } as any} replace />
    </ProtectedRoute>
  ),
});
