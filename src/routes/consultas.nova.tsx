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
  criarConsultaDemonstrativa,
  reenviarConsulta,
  watchConsultaCredito,
  progressoConsulta,
  STATUS_FINAIS,
  type StatusConsulta,
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
  const [consultaId, setConsultaId] = useState<string | null>(null);
  const [erroAutomacao, setErroAutomacao] = useState<string | null>(null);
  const [progresso, setProgresso] = useState(5);
  const [etapaAutomacao, setEtapaAutomacao] = useState<string | null>(null);
  const stopWatchRef = useRef<(() => void) | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const demoSession = isDemoSession();

  const pararEscuta = () => {
    stopWatchRef.current?.();
    stopWatchRef.current = null;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  useEffect(() => pararEscuta, []);

  const escutarConsulta = (id: string) => {
    pararEscuta();
    stopWatchRef.current = watchConsultaCredito(
      id,
      (consulta) => {
        const status = consulta.status as StatusConsulta;
        setEtapaAutomacao(consulta.automation_step);
        setProgresso(progressoConsulta(consulta.status, consulta.automation_step));
        if (!STATUS_FINAIS.includes(status)) return;
        if (status === "erro") {
          setErroAutomacao(
            consulta.error_message ||
              consulta.mensagem ||
              "Não foi possível concluir a consulta no momento.",
          );
          pararEscuta();
          return;
        }
        // aprovado | recusado | em_analise → tela de status da automação
        pararEscuta();
        setConsultaId(null);
        navigate({ to: "/consultas/$id/status", params: { id } });
      },
      {
        onError: () => {
          setErroAutomacao(
            "A conexão para acompanhar a consulta ficou indisponível. Verifique sua internet e tente continuar.",
          );
          pararEscuta();
        },
      },
    );

    // Rede de segurança: se por algum motivo o worker não responder (ex.: automação
    // temporariamente fora do ar), não deixamos o modal "Consultando crédito" girar
    // pra sempre. Depois de um tempo bem maior que o processamento normal (~10s) e que
    // o timeout do worker (90s), mostramos uma mensagem clara com opção de reenviar —
    // reaproveitando a mesma UI de erro (a consulta continua salva e pode ser reenviada).
    timeoutRef.current = setTimeout(() => {
      setErroAutomacao(
        "A consulta está demorando mais que o normal. Pode ser uma instabilidade momentânea — tente reenviar em instantes.",
      );
      pararEscuta();
    }, 150000);
  };

  const handleSimular = async (dados: DadosSimulacao) => {
    if (!user?.email) {
      toast.error("Sessão expirada. Faça login novamente.");
      return;
    }
    setIsSubmitting(true);
    setErroAutomacao(null);
    setProgresso(5);
    setEtapaAutomacao(null);
    try {
      const criarConsulta = demoSession ? criarConsultaDemonstrativa : criarConsultaParaAutomacao;
      const id = await criarConsulta({
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
      setEtapaAutomacao(null);
      escutarConsulta(consultaId);
    } catch (e: any) {
      toast.error("Erro ao reenviar consulta: " + (e?.message || "desconhecido"));
    }
  };

  const handleFecharModal = () => {
    pararEscuta();
    setConsultaId(null);
    setErroAutomacao(null);
    setEtapaAutomacao(null);
  };

  const modalAberto = consultaId !== null;

  return (
    <DashboardLayout>
      <div className="flex-1 flex flex-col px-6 py-6">
        <div className="w-full max-w-5xl mx-auto">
          <FormularioSimulacao
            modo="interno"
            onSubmit={handleSimular}
            disabled={isSubmitting || modalAberto}
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
        open={modalAberto}
        erro={erroAutomacao}
        progresso={progresso}
        etapa={etapaAutomacao}
        onTentarNovamente={handleTentarNovamente}
        onFechar={handleFecharModal}
      />
    </DashboardLayout>
  );
}
