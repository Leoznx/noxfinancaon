import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Construction } from "lucide-react";

export function AdminPlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <ProtectedRoute roles={["admin", "analista"]}>
      <DashboardLayout>
        <div className="space-y-8">
          <div>
            <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">{title}</h1>
            <p className="text-neutral-500 mt-2 font-medium">{description}</p>
          </div>
          <div className="bg-white border border-neutral-200 rounded-xl p-16 flex flex-col items-center justify-center text-center shadow-sm">
            <div className="w-14 h-14 rounded-full bg-yellow-50 border border-yellow-200 flex items-center justify-center mb-4">
              <Construction className="w-7 h-7 text-yellow-600" />
            </div>
            <h2 className="text-lg font-bold text-neutral-900">Módulo em construção</h2>
            <p className="text-sm text-neutral-500 mt-2 max-w-md">
              Esta aba foi reservada na nova estrutura do Painel Admin. A interface completa, com dados reais do banco, busca, filtros e ações, será entregue nas próximas fases.
            </p>
          </div>
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}
