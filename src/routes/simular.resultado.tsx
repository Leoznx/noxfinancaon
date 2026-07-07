import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SeletorPlanos } from "@/components/simulacao/SeletorPlanos";
import { useAuth } from "@/components/AuthProvider";
import { DadosSimulacao } from "@/components/simulacao/FormularioSimulacao";

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
    const raw = localStorage.getItem('nox_simulacao_pendente');
    
    if (!raw) {
      toast.error('Nenhuma simulação encontrada. Preencha os dados.');
      navigate({ to: '/simular' });
      return;
    }
    
    try {
      const parsed = JSON.parse(raw);
      
      const idade = Date.now() - new Date(parsed.criadoEm).getTime();
      const seteDias = 7 * 24 * 60 * 60 * 1000;
      
      if (idade > seteDias) {
        localStorage.removeItem('nox_simulacao_pendente');
        toast.error('Simulação expirada. Preencha novamente.');
        navigate({ to: '/simular' });
        return;
      }
      
      setDados(parsed);
    } catch (e) {
      localStorage.removeItem('nox_simulacao_pendente');
      navigate({ to: '/simular' });
    }
  }, []);

  const handleSelecionarPlano = async (planoId: string, extras?: import("@/components/simulacao/SeletorPlanos").ExtrasSelecionados) => {
    if (!dados || !user?.email) return;
    setIsSubmitting(true);
    try {
      const { upsertConsultaCredito } = await import("@/lib/consultas");
      const consultaId = await upsertConsultaCredito({
        dados,
        userEmail: user.email,
        userRole: user.role,
      });
      const updatePayload: any = {
        plano_id: planoId,
        origem: "simulacao_publica",
        status: "pendente_documentacao",
        documentos: {
          extras: extras ?? {},
        },
      };
      const { error } = await supabase
        .from("consultas_credito")
        .update(updatePayload)
        .eq("id", consultaId);
      if (error) throw error;

      localStorage.removeItem("nox_simulacao_pendente");
      toast.success("Plano selecionado! Vamos completar os dados da proposta.");
      navigate({ to: `/consultas/${consultaId}/dados-complementares` as any });
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
              nomeInquilino: dados.tipoInquilino === 'PF' ? dados.inquilinos[0].nome : dados.razaoSocial,
              documento: dados.tipoInquilino === 'PF' ? dados.inquilinos[0]?.cpf : dados.cnpj,
            }}
            onVoltar={() => navigate({ to: '/simular' })}
            onSelecionarPlano={handleSelecionarPlano}
            isSubmitting={isSubmitting}
          />
        </div>
      </div>
    </DashboardLayout>
  );
}
