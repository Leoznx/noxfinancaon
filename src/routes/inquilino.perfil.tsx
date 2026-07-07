import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/components/AuthProvider";
import { User } from "lucide-react";

export const Route = createFileRoute("/inquilino/perfil")({
  component: () => (
    <ProtectedRoute roles={["inquilino"]}>
      <PerfilInquilino />
    </ProtectedRoute>
  ),
});

function PerfilInquilino() {
  const { user } = useAuth();
  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-2xl">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-neutral-900">Meu Perfil</h1>
          <p className="text-sm text-neutral-500 mt-1">Dados da sua conta.</p>
        </div>
        <div className="bg-white border border-neutral-200 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-yellow-100 flex items-center justify-center"><User className="text-yellow-700" /></div>
            <div>
              <p className="font-bold">{user?.email}</p>
              <p className="text-xs text-neutral-500 uppercase tracking-widest">Inquilino</p>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
