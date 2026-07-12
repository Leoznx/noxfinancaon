import { Navigate, createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/ProtectedRoute";

export const Route = createFileRoute("/financeiro")({
  component: () => (
    <ProtectedRoute roles={["admin", "admin_master", "financeiro"]} moduleKey="financeiro">
      <Navigate to="/admin/financeiro" replace />
    </ProtectedRoute>
  ),
});
