import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";

export const Route = createFileRoute("/imoveis")({
  component: () => (
    <ProtectedRoute>
      <Imoveis />
    </ProtectedRoute>
  ),
});

function Imoveis() {
  return (
    <DashboardLayout>
      <h1 className="text-3xl font-bold mb-6">Gestão de Imóveis</h1>
      <div className="p-8 bg-card border border-zinc-800 rounded-2xl text-center">
        <p className="text-muted-foreground">Listagem de imóveis cadastrados.</p>
      </div>
    </DashboardLayout>
  );
}
