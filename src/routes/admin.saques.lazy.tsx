import { Navigate, createLazyFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/ProtectedRoute";

export const Route = createLazyFileRoute("/admin/saques")({
  component: () => (
    <ProtectedRoute roles={["admin", "admin_master", "financeiro"]} moduleKey="financeiro">
      <Navigate to="/admin/financeiro" replace />
    </ProtectedRoute>
  ),
});
