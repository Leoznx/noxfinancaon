import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { FormularioSimulacao, DadosSimulacao } from "@/components/simulacao/FormularioSimulacao";
import { ModalConsultando } from "@/components/simulacao/ModalConsultando";
import { toast } from "sonner";
import { useAuth } from "@/components/AuthProvider";
import {
  criarConsultaParaAutomacao,
  reenviarConsulta,
  watchConsultaCredito,
  progressoConsulta,
  STATUS_FINAIS,
  type StatusConsulta,
} from "@/lib/consultasCredito";

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
  const [consultaId, setConsultaId] = useState<string | null>(null);
  const [erroAutomacao, setErroAutomacao] = useState<string | null>(null);
  const [progresso, setProgresso] = useState(5);
  const stopWatchRef = useRef<(() => void) | null>(null);

  const pararEscuta = () => {
    stopWatchRef.current?.();
    stopWatchRef.current = null;
  };

  useEffect(() => pararEscuta, []);

  const escutarConsulta = (id: string) => {
    pararEscuta();
    stopWatchRef.current = watchConsultaCredito(id, (consulta) => {
      const status = consulta.status as StatusConsulta;
      setProgresso(progressoConsulta(consulta.status, consulta.automation_step));
      if (!STATUS_FINAIS.includes(status)) return;
      if (status === "erro") {
        setErroAutomacao(
          consulta.error_message || consulta.mensagem || "Não foi possível concluir a consulta no momento.",
        );
        pararEscuta();
        return;
      }
      // aprovado | recusado | em_analise → tela de status da automação
      pararEscuta();
      setConsultaId(null);
      navigate({ to: "/consultas/$id/status", params: { id } });
    });
  };

  const handleSimular = async (dados: DadosSimulacao) => {
    if (!user?.email) {
      toast.error("Sessão expirada. Faça login novamente.");
      return;
    }
    setIsSubmitting(true);
    setErroAutomacao(null);
    setProgresso(5);
    try {
      const id = await criarConsultaParaAutomacao({
        dados,
        userEmail: user.email,
        userRole: user.role,
      });
      setConsultaId(id);
      escutarConsulta(id);
    } catch (e: any) {
      toast.error("Erro ao criar consulta: " + (e?.message || "desconhecido"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTentarNovamente = async () => {
    if (!consultaId) return;
    try {
      await reenviarConsulta(consultaId);
      setErroAutomacao(null);
      setProgresso(5);
      escutarConsulta(consultaId);
    } catch (e: any) {
      toast.error("Erro ao reenviar consulta: " + (e?.message || "desconhecido"));
    }
  };

  const handleFecharModal = () => {
    pararEscuta();
    setConsultaId(null);
    setErroAutomacao(null);
  };

  const modalAberto = consultaId !== null;

  return (
    <DashboardLayout>
      <div className="flex-1 flex flex-col px-6 py-6">
        <div className="w-full max-w-5xl mx-auto">
          <FormularioSimulacao modo="interno" onSubmit={handleSimular} disabled={isSubmitting || modalAberto} />
          {isSubmitting && (
            <p className="mt-4 text-sm font-bold text-neutral-500 uppercase tracking-widest">
              Enviando consulta…
            </p>
          )}
        </div>
      </div>
      <ModalConsultando
        open={modalAberto}
        erro={erroAutomacao}
        progresso={progresso}
        onTentarNovamente={handleTentarNovamente}
        onFechar={handleFecharModal}
      />
    </DashboardLayout>
  );
}
