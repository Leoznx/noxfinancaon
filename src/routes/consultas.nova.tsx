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

// Maior que o timeout máximo do worker (7 min). Ao atingir o limite, a consulta
// continua salva e abrimos seu acompanhamento; nunca a reenfileiramos às cegas.
const TEMPO_LIMITE_ACOMPANHAMENTO_MS = 540_000;

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
        setEtapaAutomacao(consulta.automation_step ?? (status === "pendente" ? "pendente" : null));
        setProgresso(progressoConsulta(consulta.status, consulta.automation_step));
        if (status === "pendente") {
          return;
        }
        // Uma indisponibilidade curta é recuperada automaticamente pelo worker.
        // Mantemos Realtime/polling ativos para o usuário seguir até o resultado,
        // enquanto o modal mostra "Restabelecendo conexão segura".
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
          pararEscuta();
          setConsultaId(null);
          navigate({ to: "/consultas/$id/resultado", params: { id } });
        },
      },
    );

    // Rede de segurança visual. A fila continua sendo a fonte da verdade: em vez
    // de um retry que poderia duplicar o envio, abrimos o acompanhamento salvo.
    timeoutRef.current = setTimeout(() => {
      pararEscuta();
      setConsultaId(null);
      navigate({ to: "/consultas/$id/resultado", params: { id } });
    }, TEMPO_LIMITE_ACOMPANHAMENTO_MS);
  };

  const handleSimular = async (dados: DadosSimulacao) => {
    if (!user?.email) {
      toast.error("Sessão expirada. Faça login novamente.");
      return;
    }
    setIsSubmitting(true);
    setErroAutomacao(null);
    setProgresso(5);
    // Abre o feedback bloqueante no mesmo clique. Antes o usuário permanecia
    // olhando o formulário em "Enviando consulta" até todas as gravações
    // preparatórias terminarem.
    setEtapaAutomacao("preparando_envio");
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

  const modalAberto = isSubmitting || consultaId !== null;

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
