import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/colaboradores")({
  component: () => (
    <Navigate to="/admin/equipe-nox" search={{ tab: "colaboradores" } as any} replace />
  ),
});
