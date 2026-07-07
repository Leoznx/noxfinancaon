import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ResultadoAutomacao } from "@/components/simulacao/ResultadoAutomacao";
import type { ExtrasSelecionados, PlanoSelecionadoCalculo } from "@/components/simulacao/SeletorPlanos";
import {
  getConsultaCredito,
  reenviarConsulta,
  watchConsultaCredito,
  type ConsultaCredito,
} from "@/lib/consultasCredito";

/**
 * Tela de resultado da automação local CredPago (worker Playwright).
 * Rota separada de /consultas/$id/resultado, que trata o fluxo de seleção de
 * plano/apólice — este endpoint é só o status bruto retornado pela automação
 * (mas também mostra a seleção de planos logo abaixo quando aprovado).
 */
export const Route = createFileRoute("/consultas/$id/status")({
  component: () => (
    <ProtectedRoute>
      <StatusConsulta />
    </ProtectedRoute>
  ),
});

function StatusConsulta() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [consulta, setConsulta] = useState<ConsultaCredito | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [isSubmittingPlano, setIsSubmittingPlano] = useState(false);

  useEffect(() => {
    let ativo = true;
    getConsultaCredito(id)
      .then((c) => {
        if (!ativo) return;
        setConsulta(c);
        setCarregando(false);
      })
      .catch(() => ativo && setCarregando(false));

    const stop = watchConsultaCredito(id, (c) => {
      if (ativo) setConsulta(c);
    });
    return () => {
      ativo = false;
      stop();
    };
  }, [id]);

  if (carregando) {
    return (
      <DashboardLayout>
        <div className="flex-1 flex items-center justify-center py-24">
          <Settings className="w-10 h-10 text-neutral-300 animate-spin" style={{ animationDuration: "2.5s" }} />
        </div>
      </DashboardLayout>
    );
  }

  if (!consulta) {
    return (
      <DashboardLayout>
        <div className="flex-1 px-6 py-12 max-w-3xl mx-auto w-full text-center">
          <h1 className="text-2xl font-bold text-neutral-900 mb-2">Consulta não encontrada</h1>
          <p className="text-neutral-600 mb-8">Verifique se o link está correto ou consulte o histórico.</p>
          <Button asChild className="bg-neutral-900 hover:bg-neutral-800 text-white font-bold rounded-xl h-12 px-6">
            <Link to="/consultas">Ver minhas consultas</Link>
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const handleTentarNovamente = async () => {
    try {
      await reenviarConsulta(id);
    } catch (e: any) {
      toast.error("Erro ao reenviar consulta: " + (e?.message || "desconhecido"));
    }
  };

  const handleSelecionarPlano = async (
    planoId: string,
    extras?: ExtrasSelecionados,
    planoCalculado?: PlanoSelecionadoCalculo,
  ) => {
    setIsSubmittingPlano(true);
    try {
      const { data: plano } = await supabase.from("planos").select("*").eq("id", planoId).single();
      if (!plano) throw new Error("Plano não encontrado");

      const aluguel = Number(consulta.valor_aluguel) || 0;
      const condominio = Number(consulta.valor_condominio) || 0;
      const taxas = Number(consulta.valor_taxas) || 0;
      const cobreTaxas = planoCalculado?.cobre_taxas_condominio ?? (plano as any).cobre_taxas_condominio;
      const taxaPremio = Number(planoCalculado?.taxa_premio ?? (plano as any).taxa_premio);
      const base = planoCalculado?.baseCalculo ?? (cobreTaxas ? aluguel + condominio + taxas : aluguel);
      const premioMensal = planoCalculado?.mensal ?? (base * (taxaPremio / 100));
      const anual = planoCalculado?.totalAnual ?? (premioMensal * 12);

      const updatePayload: any = {
        plano_id: planoId,
        valor_premio_mensal: premioMensal,
        valor_anual: anual,
        status: "pendente_documentacao",
      };
      const previousDocumentos = (consulta as any)?.documentos && typeof (consulta as any).documentos === "object"
        ? (consulta as any).documentos
        : {};
      updatePayload.documentos = {
        ...previousDocumentos,
        extras: extras ?? {},
        plano_calculado: planoCalculado ?? null,
      };

      const { error } = await supabase.from("consultas_credito").update(updatePayload).eq("id", id);
      if (error) throw error;
      toast.success("Plano selecionado! Vamos completar os dados da proposta.");
      navigate({ to: `/consultas/${id}/dados-complementares` as any });
    } catch (e: any) {
      toast.error("Erro ao salvar plano: " + (e?.message || "desconhecido"));
    } finally {
      setIsSubmittingPlano(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="flex-1 px-6 py-8">
        <div className="w-full max-w-6xl mx-auto">
          <ResultadoAutomacao
            consulta={consulta}
            onTentarNovamente={handleTentarNovamente}
            onSelecionarPlano={handleSelecionarPlano}
            isSubmittingPlano={isSubmittingPlano}
          />
        </div>
      </div>
    </DashboardLayout>
  );
}
