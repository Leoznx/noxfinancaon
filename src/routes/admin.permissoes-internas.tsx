import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/permissoes-internas")({
  component: () => <Navigate to="/admin/equipe-permissoes" search={{ tab: "permissoes" } as any} replace />,
});
