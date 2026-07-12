import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/afiliados")({
  component: () => <Navigate to="/admin/leads" replace />,
});
