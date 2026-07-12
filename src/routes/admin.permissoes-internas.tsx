import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/permissoes-internas")({
  component: () => (
    <Navigate to="/admin/equipe-nox" search={{ tab: "permissoes" } as any} replace />
  ),
});
