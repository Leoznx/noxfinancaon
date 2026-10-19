import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { FormularioSimulacao, DadosSimulacao } from "@/components/simulacao/FormularioSimulacao";
import { ModalConsultando } from "@/components/simulacao/ModalConsultando";
import { toast } from "sonner";
import { useAuth } from "@/components/AuthProvider";
import {
  criarConsultaParaAutomacao,
  criarConsultaDemonstrativa,
} from "@/lib/consultasCredito";
import { simularLoftDireto } from "@/lib/simularLoftDireto";
import { DEMO_SIMULATION_DATA } from "@/lib/demo-accounts";
import { isDemoSession } from "@/lib/demo-session";

export const Route = createFileRoute("/consultas/nova")({
  component: () => (
    <ProtectedRoute>
      <NovaConsulta />
    </ProtectedRoute>
  ),
});

function NovaConsulta() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const demoSession = isDemoSession();

  const handleSimular = async (dados: DadosSimulacao) => {
    if (!user?.email) {
      toast.error("Sessão expirada. Faça login novamente.");
      return;
    }
    setIsSubmitting(true);
    try {
      // Modo demo usa o fluxo demonstrativo (sem API real).
      if (demoSession) {
        const id = await criarConsultaDemonstrativa({
          dados,
          userEmail: user.email,
          userRole: user.role,
        });
        await navigate({ to: "/consultas/$id/status", params: { id } });
        return;
      }

      // Tenta a API direta da Loft (sem Playwright, sem fila).
      const direto = await simularLoftDireto(dados, user.email, user.role);
      if (direto.ok && direto.consultaId) {
        await navigate({ to: "/consultas/$id/status", params: { id: direto.consultaId } });
        return;
      }

      // Fallback: fila + worker Playwright (caso a API direta falhe).
      const id = await criarConsultaParaAutomacao({
        dados,
        userEmail: user.email,
        userRole: user.role,
      });
      await navigate({ to: "/consultas/$id/status", params: { id } });
    } catch (e: any) {
      toast.error("Erro ao criar consulta: " + (e?.message || "desconhecido"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="flex-1 flex flex-col px-6 py-6">
        <div className="w-full max-w-5xl mx-auto">
          <FormularioSimulacao
            modo="interno"
            onSubmit={handleSimular}
            disabled={isSubmitting}
            dadosIniciais={demoSession ? DEMO_SIMULATION_DATA : undefined}
            allowDemoDocuments={demoSession}
          />
          {isSubmitting && (
            <p className="mt-4 text-sm font-bold text-neutral-500 uppercase tracking-widest">
              Enviando consulta…
            </p>
          )}
        </div>
      </div>
      <ModalConsultando
        open={isSubmitting}
        progresso={5}
        etapa="preparando_envio"
      />
    </DashboardLayout>
  );
}
