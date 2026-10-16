import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  SeletorPlanos,
  type ExtrasSelecionados,
  type PlanoSelecionadoCalculo,
} from "@/components/simulacao/SeletorPlanos";
import { useAuth } from "@/components/AuthProvider";
import { DadosSimulacao } from "@/components/simulacao/FormularioSimulacao";
import { registrarEventoProposta } from "@/lib/consultasCredito";
import { normalizeContractPeriodMonths } from "@/lib/contract-period";
import { buildPlanSelectionUpdate } from "@/lib/plan-selection";
import { updateContractPeriodSafely } from "@/lib/contract-period-update";

export const Route = createFileRoute("/simular/resultado")({
  component: SimularResultadoWrapper,
});

function SimularResultadoWrapper() {
  return (
    <ProtectedRoute>
      <SimularResultado />
    </ProtectedRoute>
  );
}

function SimularResultado() {
  const [dados, setDados] = useState<DadosSimulacao | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    const raw = localStorage.getItem("nox_simulacao_pendente");

    if (!raw) {
      toast.error("Nenhuma simulação encontrada. Preencha os dados.");
      navigate({ to: "/simular" });
      return;
    }

    try {
      const parsed = JSON.parse(raw);

      const idade = Date.now() - new Date(parsed.criadoEm).getTime();
      const seteDias = 7 * 24 * 60 * 60 * 1000;

      if (idade > seteDias) {
        localStorage.removeItem("nox_simulacao_pendente");
        toast.error("Simulação expirada. Preencha novamente.");
        navigate({ to: "/simular" });
        return;
      }

      setDados(parsed);
    } catch (e) {
      localStorage.removeItem("nox_simulacao_pendente");
      navigate({ to: "/simular" });
    }
  }, [navigate]);

  const handleSelecionarPlano = async (
    planoId: string,
    contractPeriodMonths: number,
    extras?: ExtrasSelecionados,
    planoCalculado?: PlanoSelecionadoCalculo,
  ) => {
    if (!dados || !user?.email) return;
    setIsSubmitting(true);
    try {
      const periodoContrato = normalizeContractPeriodMonths(contractPeriodMonths);
      if (!periodoContrato) throw new Error("Selecione um período de contrato válido.");

      const { upsertConsultaCredito } = await import("@/lib/consultas");
      const consultaId = await upsertConsultaCredito({
        dados,
        userEmail: user.email,
        userRole: user.role,
      });
      const { data: consultaAtual, error: consultaAtualError } = await supabase
        .from("consultas_credito")
        .select(
          "plano_id, contract_period_months, valor_premio_mensal, valor_anual, status, dados_complementares_em, documentos",
        )
        .eq("id", consultaId)
        .maybeSingle();
      if (consultaAtualError) throw consultaAtualError;
      if (!planoCalculado) throw new Error("Não foi possível calcular o plano selecionado.");
      const selectionUpdate = buildPlanSelectionUpdate(consultaAtual ?? {}, {
        planId: planoId,
        contractPeriodMonths: periodoContrato,
        monthlyAmount: planoCalculado.mensal,
        annualAmount: planoCalculado.totalAnual,
        extras: extras ?? {},
        calculatedPlan: planoCalculado,
      });
      const updatePayload = selectionUpdate.resumed
        ? selectionUpdate.payload
        : { ...selectionUpdate.payload, origem: "simulacao_publica" };
      if (selectionUpdate.resumed && selectionUpdate.periodChanged) {
        await updateContractPeriodSafely(consultaId, periodoContrato);
      } else {
        const { error } = await supabase
          .from("consultas_credito")
          .update(updatePayload as any)
          .eq("id", consultaId);
        if (error) throw error;
      }

      // Passo a passo do funil — é o que o administrador lê em Consultas > Ver mais.
      if (!selectionUpdate.resumed) {
        await registrarEventoProposta(
          consultaId,
          selectionUpdate.resumed ? "periodo_contrato_atualizado" : "plano_selecionado",
          selectionUpdate.resumed
            ? `Período do contrato atualizado para ${periodoContrato} ${periodoContrato === 1 ? "mês" : "meses"}.`
            : "Plano selecionado na simulação pública.",
          { plano_id: planoId, contract_period_months: periodoContrato },
        );
      }

      localStorage.removeItem("nox_simulacao_pendente");
      toast.success(
        selectionUpdate.resumed
          ? selectionUpdate.periodChanged
            ? "Período atualizado! Continuando de onde você parou."
            : "Dados já salvos. Continuando de onde você parou."
          : "Plano selecionado! Vamos completar os dados da proposta.",
      );
      navigate({
        to:
          selectionUpdate.resumed && consultaAtual?.dados_complementares_em
            ? (`/consultas/${consultaId}/finalizar` as any)
            : (`/consultas/${consultaId}/dados-complementares` as any),
      });
    } catch (error: any) {
      toast.error("Erro ao salvar simulação: " + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!dados) return null;

  return (
    <DashboardLayout>
      <div className="flex-1 flex flex-col px-6 py-6 overflow-hidden">
        <div className="w-full max-w-5xl mx-auto">
          <SeletorPlanos
            dados={{
              aluguel: dados.valores.aluguel,
              condominio: dados.valores.condominio,
              taxas: dados.valores.taxas,
              nomeInquilino:
                dados.tipoInquilino === "PF" ? dados.inquilinos[0].nome : dados.razaoSocial,
              documento: dados.tipoInquilino === "PF" ? dados.inquilinos[0]?.cpf : dados.cnpj,
            }}
            onVoltar={() => navigate({ to: "/simular" })}
            onSelecionarPlano={handleSelecionarPlano}
            isSubmitting={isSubmitting}
          />
        </div>
      </div>
    </DashboardLayout>
  );
}
