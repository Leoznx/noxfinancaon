import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";

export const Route = createFileRoute("/financeiro")({
  component: () => (
    <ProtectedRoute roles={["admin", "analista", "financeiro"]}>
      <Financeiro />
    </ProtectedRoute>
  ),
});

function Financeiro() {
  return (
    <DashboardLayout>
      <h1 className="text-3xl font-bold mb-6">Financeiro</h1>
      <div className="p-8 bg-card border border-zinc-800 rounded-2xl text-center">
        <p className="text-muted-foreground">Controle de faturas e comissões.</p>
      </div>
    </DashboardLayout>
  );
}
