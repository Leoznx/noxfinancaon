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
      const criarConsulta = demoSession ? criarConsultaDemonstrativa : criarConsultaParaAutomacao;
      const id = await criarConsulta({
        dados,
        userEmail: user.email,
        userRole: user.role,
      });
      // A API já confirmou que a solicitação foi registrada de forma durável.
      // Não prendemos o corretor ao tempo do worker: o detalhe acompanha a fila
      // por Realtime e apresenta a etapa operacional real até chegar uma decisão.
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
