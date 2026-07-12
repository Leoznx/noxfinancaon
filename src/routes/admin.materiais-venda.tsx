import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/materiais-venda")({
  component: () => (
    <Navigate to="/admin/equipe-nox" search={{ tab: "colaboradores" } as any} replace />
  ),
});
