import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";

export const Route = createFileRoute("/relatorios")({
  component: () => (
    <ProtectedRoute roles={["admin", "analista"]}>
      <Relatorios />
    </ProtectedRoute>
  ),
});

function Relatorios() {
  return (
    <DashboardLayout>
      <h1 className="text-3xl font-bold mb-6">Relatórios</h1>
      <div className="p-8 bg-card border border-zinc-800 rounded-2xl text-center">
        <p className="text-muted-foreground">Relatórios gerenciais e operacionais.</p>
      </div>
    </DashboardLayout>
  );
}
