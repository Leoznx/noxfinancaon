import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/equipe-comercial")({
  component: () => (
    <Navigate to="/admin/equipe-nox" search={{ tab: "equipe-comercial" } as any} replace />
  ),
});
