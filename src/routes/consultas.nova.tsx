import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { FormularioSimulacao, DadosSimulacao } from "@/components/simulacao/FormularioSimulacao";
import { ModalConsultando } from "@/components/simulacao/ModalConsultando";
import { toast } from "sonner";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import {
  criarConsultaParaAutomacao,
  criarConsultaDemonstrativa,
  reenviarConsulta,
  watchConsultaCredito,
  progressoConsulta,
} from "@/lib/consultasCredito";
import {
  TEMPO_LIMITE_ACOMPANHAMENTO_MS,
  TEMPO_PARA_SEGUNDO_PLANO_MS,
  etapaDeEsperaLonga,
  proximoPassoSimulacao,
} from "@/lib/simulacao-espera";
import { DEMO_SIMULATION_DATA } from "@/lib/demo-accounts";
import { isDemoSession } from "@/lib/demo-session";
import { simularLoftDireto } from "@/lib/simularLoftDireto";

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
  const [esperaLonga, setEsperaLonga] = useState(false);
  const stopWatchRef = useRef<(() => void) | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const esperaLongaRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const demoSession = isDemoSession();

  const pararEscuta = () => {
    stopWatchRef.current?.();
    stopWatchRef.current = null;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (esperaLongaRef.current) {
      clearTimeout(esperaLongaRef.current);
      esperaLongaRef.current = null;
    }
  };

  useEffect(() => pararEscuta, []);

  // A consulta continua salva e o detalhe acompanha o estado real da fila.
  const abrirAcompanhamento = (id: string) => {
    pararEscuta();
    setConsultaId(null);
    navigate({ to: "/consultas/$id/resultado", params: { id } });
  };

  const escutarConsulta = (id: string) => {
    pararEscuta();
    setEsperaLonga(false);
    stopWatchRef.current = watchConsultaCredito(
      id,
      (consulta) => {
        const passo = proximoPassoSimulacao(consulta);
        if (passo.tipo === "aguardar") {
          // Uma indisponibilidade curta é recuperada automaticamente pelo worker.
          // Mantemos Realtime/polling ativos para o corretor seguir até o resultado,
          // enquanto o modal mostra a etapa real gravada pela automação.
          setEtapaAutomacao(consulta.automation_step);
          setProgresso(progressoConsulta(consulta.status, consulta.automation_step));
          return;
        }
        pararEscuta();
        if (passo.tipo === "erro") {
          setErroAutomacao(passo.mensagem);
          return;
        }
        // Só chegamos aqui com decisão real (aprovado, recusado, em análise) ou
        // com um estado final de acompanhamento (verificação necessária, cancelada).
        setConsultaId(null);
        navigate({ to: "/consultas/$id/status", params: { id } });
      },
      { onError: () => abrirAcompanhamento(id) },
    );

    // Quando a fila está parada à espera do serviço externo ou a resposta demora,
    // o modal oferece seguir em segundo plano; nada é reenviado nem descartado.
    esperaLongaRef.current = setTimeout(() => setEsperaLonga(true), TEMPO_PARA_SEGUNDO_PLANO_MS);

    // Rede de segurança visual. A fila continua sendo a fonte da verdade: em vez
    // de um retry que poderia duplicar o envio, abrimos o acompanhamento salvo.
    timeoutRef.current = setTimeout(() => abrirAcompanhamento(id), TEMPO_LIMITE_ACOMPANHAMENTO_MS);
  };

  const handleSimular = async (dados: DadosSimulacao) => {
    if (!user?.email) {
      toast.error("Sessão expirada. Faça login novamente.");
      return;
    }
    setIsSubmitting(true);
    setErroAutomacao(null);
    setProgresso(5);
    setEtapaAutomacao("preparando_envio");
    try {
      // Modo demo usa o fluxo demonstrativo (sem API real).
      if (demoSession) {
        const id = await criarConsultaDemonstrativa({
          dados,
          userEmail: user.email,
          userRole: user.role,
        });
        setConsultaId(id);
        escutarConsulta(id);
        return;
      }

      // Tenta API direta primeiro (rápido, ~5-10s)
      try {
        const direto = await simularLoftDireto(dados, user.email, user.role);
        if (direto.ok && direto.resultado) {
          const resultado = direto.resultado;
          const status = resultado.status;
          setConsultaId(direto.consultaId);
          setErroAutomacao(null);

          // Grava o resultado no banco
          await supabase.from("consultas_credito").update({
            tipo_pessoa: dados.tipoInquilino,
            documento: status ? documento : null,
            tenant_name: dados.inquilinos[0]?.nome ?? dados.razaoSocial,
            tipo_imovel: dados.tipoImovel,
            cep: dados.cep,
            valor_aluguel: dados.valores.aluguel,
            valor_condominio: dados.valores.condominio,
            valor_taxas: dados.valores.taxas,
            status: status,
            resultado: status,
            mensagem: status === "aprovado" ? "Crédito aprovado." : status === "recusado" ? "Crédito recusado." : "Crédito em análise.",
            origem: "nox_financa_direto",
            external_provider: "loft_api",
            external_status: status,
            external_request_id: resultado.proposalId,
            external_response: resultado,
            automation_step: "api_direta",
            automation_started_at: new Date().toISOString(),
            automation_finished_at: new Date().toISOString(),
          } as any).eq("id", direto.consultaId);

          navigate({ to: "/consultas/$id/status", params: { id: direto.consultaId } });
          return;
        }
      } catch (diretoErro) {
        console.warn("API direta falhou, usando fila:", diretoErro);
      }

      // Fallback: fila + worker Playwright (API direta indisponível)
      const id = await criarConsultaParaAutomacao({
        dados,
        userEmail: user.email,
        userRole: user.role,
      });
      setConsultaId(id);
      escutarConsulta(id);
    } catch (e: any) {
      const msg = e?.message || "Não foi possível simular o crédito agora.";
      setErroAutomacao(msg);
      toast.error(msg);
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
  const podeSeguirEmSegundoPlano =
    consultaId !== null && !erroAutomacao && (esperaLonga || etapaDeEsperaLonga(etapaAutomacao));

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
        onContinuarEmSegundoPlano={
          podeSeguirEmSegundoPlano && consultaId ? () => abrirAcompanhamento(consultaId) : undefined
        }
      />
    </DashboardLayout>
  );
}
