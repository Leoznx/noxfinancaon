import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ResultadoAutomacao } from "@/components/simulacao/ResultadoAutomacao";
import type { ExtrasSelecionados, PlanoSelecionadoCalculo } from "@/components/simulacao/SeletorPlanos";
import { supabase } from "@/integrations/supabase/client";
import { isNomeValido, reenviarConsulta } from "@/lib/consultasCredito";
import { toast } from "sonner";

export const Route = createFileRoute("/consultas/$id/resultado")({
  component: () => (
    <ProtectedRoute>
      <ConsultaResultado />
    </ProtectedRoute>
  ),
});

/**
 * "Detalhes" a partir de Minhas Consultas. Usa o mesmo ResultadoAutomacao de
 * /consultas/$id/status — aprovado libera os planos, recusado/em análise não
 * mostram planos (em análise mostra o formulário complementar/mensagem de
 * obrigado) — para o comportamento ser idêntico não importa por qual rota o
 * corretor chegou na consulta.
 */
function ConsultaResultado() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [consulta, setConsulta] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const carregarConsulta = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("consultas_credito")
        .select(`*, inquilinos (*), imoveis (*)`)
        .eq("id", id)
        .single();
      if (error) throw error;
      setConsulta(data);
    } catch (e: any) {
      toast.error("Erro ao carregar consulta: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    carregarConsulta();
  }, [carregarConsulta]);

  // Atualiza ao vivo se o status mudar em outro lugar (ex.: Jurídico aprova/recusa
  // na aba Aprovações enquanto o corretor está com esta tela aberta).
  useEffect(() => {
    const channel = supabase
      .channel(`consulta-resultado-${id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "consultas_credito", filter: `id=eq.${id}` },
        () => carregarConsulta(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, carregarConsulta]);

  const handleSelecionarPlano = async (
    planoId: string,
    extras?: ExtrasSelecionados,
    planoCalculado?: PlanoSelecionadoCalculo,
  ) => {
    setSubmitting(true);
    try {
      const { data: plano } = await supabase
        .from("planos")
        .select("*")
        .eq("id", planoId)
        .single();
      if (!plano) throw new Error("Plano não encontrado");

      const aluguel = Number(consulta.imoveis?.valor_aluguel ?? consulta.valor_aluguel) || 0;
      const condominio = Number(consulta.imoveis?.valor_condominio ?? consulta.valor_condominio) || 0;
      const taxas = Number(consulta.imoveis?.valor_taxas ?? consulta.valor_taxas) || 0;
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
      if (extras) {
        Object.assign(updatePayload, extras);
        updatePayload.proposal_summary = extras;
      }
      if (planoCalculado) {
        updatePayload.proposal_summary = {
          ...(extras ?? {}),
          plano_calculado: planoCalculado,
        };
      }

      const { error } = await supabase
        .from("consultas_credito")
        .update(updatePayload)
        .eq("id", id);
      if (error) throw error;
      toast.success("Plano selecionado! Vamos completar os dados da proposta.");
      navigate({ to: `/consultas/${id}/dados-complementares` as any });
    } catch (e: any) {
      toast.error("Erro ao salvar plano: " + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAtualizarValores = async (v: { aluguel: number; condominio: number; taxas: number }) => {
    const imovelId = consulta?.imoveis?.id ?? consulta?.imovel_id;
    if (!imovelId) throw new Error("Imóvel não encontrado para esta consulta.");
    const { error: errImovel } = await supabase
      .from("imoveis")
      .update({
        valor_aluguel: v.aluguel,
        valor_condominio: v.condominio,
        valor_taxas: v.taxas,
      } as any)
      .eq("id", imovelId);
    if (errImovel) throw errImovel;

    await supabase
      .from("consultas_credito")
      .update({ rent_value: v.aluguel, updated_at: new Date().toISOString() } as any)
      .eq("id", id);

    setConsulta((prev: any) => ({
      ...prev,
      imoveis: { ...(prev?.imoveis ?? {}), valor_aluguel: v.aluguel, valor_condominio: v.condominio, valor_taxas: v.taxas },
    }));
  };

  const handleTentarNovamente = async () => {
    try {
      await reenviarConsulta(id);
      await carregarConsulta();
    } catch (e: any) {
      toast.error("Erro ao reenviar consulta: " + (e?.message || "desconhecido"));
    }
  };

  if (loading || !consulta) {
    return (
      <DashboardLayout>
        <div className="p-10 text-sm text-neutral-500">Carregando simulação...</div>
      </DashboardLayout>
    );
  }

  const inquilino = consulta.inquilinos ?? {};
  const imovel = consulta.imoveis ?? {};
  // tenant_name/documento (colunas da automação) são a fonte mais confiável; o join com
  // inquilinos/imoveis só entra como fallback para consultas que nunca passaram pela
  // automação (nunca tiveram esses campos preenchidos).
  const nomeResolvido = [consulta.tenant_name, inquilino.nome, inquilino.razao_social].find(isNomeValido) || null;
  const documentoResolvido = consulta.documento || consulta.tenant_document || inquilino.cpf || inquilino.cnpj || null;

  const consultaParaResultado = {
    ...consulta,
    tenant_name: nomeResolvido,
    documento: documentoResolvido,
    valor_aluguel: consulta.valor_aluguel ?? imovel.valor_aluguel ?? null,
    valor_condominio: consulta.valor_condominio ?? imovel.valor_condominio ?? null,
    valor_taxas: consulta.valor_taxas ?? imovel.valor_taxas ?? null,
    tipo_imovel: consulta.tipo_imovel ?? imovel.tipo ?? null,
    cep: consulta.cep ?? imovel.cep ?? null,
  };

  return (
    <DashboardLayout>
      <div className="flex-1 flex flex-col px-6 py-6">
        <div className="w-full max-w-6xl mx-auto space-y-6">
          <ResultadoAutomacao
            consulta={consultaParaResultado}
            onTentarNovamente={handleTentarNovamente}
            onSelecionarPlano={handleSelecionarPlano}
            onAtualizarValores={handleAtualizarValores}
            isSubmittingPlano={submitting}
            planoIdInicial={consulta.plano_id ?? null}
            extrasIniciais={{
              external_painting_enabled: !!consulta.external_painting_enabled,
              external_painting_total: Number(consulta.external_painting_total) || 0,
              external_painting_installment: Number(consulta.external_painting_installment) || 0,
              activation_fee_enabled: !!consulta.activation_fee_enabled,
              activation_fee_amount: Number(consulta.activation_fee_amount) || 0,
              activation_fee_commission: Number(consulta.activation_fee_commission) || 0,
            }}
          />
        </div>
      </div>
    </DashboardLayout>
  );
}
