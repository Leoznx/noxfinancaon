import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { apolice_id } = await req.json();

    // 1. Buscar dados da apólice
    const { data: apolice, error: apoliceError } = await supabaseClient
      .from("apolices")
      .select(`
        *,
        plano:planos(*),
        corretor:corretores(profile_id),
        imobiliaria:imobiliarias(profile_id),
        imovel:imoveis(proprietario_id, valor_aluguel)
      `)
      .eq("id", apolice_id)
      .single();

    if (apoliceError || !apolice) {
      console.error("Erro ao buscar apólice:", apoliceError);
      throw new Error("Apólice não encontrada");
    }

    if (!apolice.plano?.tem_comissao) {
      return new Response(JSON.stringify({ skip: "Plano sem comissão" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aluguel = Number(apolice.imovel?.valor_aluguel || 0);
    const comissoes = [];

    // Helper to fetch level and calculate value
    const processarComissao = async (profileId: string, tipo: string) => {
      // Conta contratos ativos do beneficiário
      const { count } = await supabaseClient
        .from("apolices")
        .select("id", { count: "exact", head: true })
        .eq("status", "ativa")
        .or(tipo === 'corretor' ? `corretor_profile_id.eq.${profileId}` : 
             tipo === 'imobiliaria' ? `imobiliaria_profile_id.eq.${profileId}` :
             `proprietario_profile_id.eq.${profileId}`);

      const { data: nivel } = await supabaseClient
        .from("niveis_perfil")
        .select("*")
        .eq("tipo_perfil", tipo)
        .eq("ativo", true)
        .lte("min_contratos", count || 0)
        .or(`max_contratos.gte.${count || 0},max_contratos.is.null`)
        .order("ordem", { ascending: false })
        .limit(1)
        .single();

      if (nivel) {
        let valor = aluguel * (Number(nivel.percentual_comissao) / 100);
        if (tipo === 'proprietario') {
          valor += Number(nivel.bonus_renovacao || 0);
        }

        return {
          beneficiario_id: profileId,
          beneficiario_tipo: tipo,
          contrato_id: apolice_id,
          valor,
          percentual_aplicado: nivel.percentual_comissao,
          nivel_aplicado: nivel.nome_nivel,
          tipo_comissao: "contrato_novo",
          status: "pendente",
        };
      }
      return null;
    };

    // ========== CORRETOR ==========
    if (apolice.corretor?.profile_id) {
      const c = await processarComissao(apolice.corretor.profile_id, "corretor");
      if (c) comissoes.push(c);
    }

    // ========== IMOBILIÁRIA ==========
    if (apolice.imobiliaria?.profile_id) {
      const c = await processarComissao(apolice.imobiliaria.profile_id, "imobiliaria");
      if (c) comissoes.push(c);
    }

    // ========== PROPRIETÁRIO (cashback) ==========
    if (apolice.imovel?.proprietario_id) {
      const c = await processarComissao(apolice.imovel.proprietario_id, "proprietario");
      if (c) comissoes.push(c);
    }

    if (comissoes.length > 0) {
      const { error: insertError } = await supabaseClient.from("comissoes").insert(comissoes);
      if (insertError) throw insertError;

      // Dispara notificações
      for (const c of comissoes) {
        await supabaseClient.from("notificacoes").insert({
          profile_id: c.beneficiario_id,
          titulo: "Nova comissão registrada",
          mensagem: `R$ ${c.valor.toFixed(2)} foi creditado em seu saldo (status pendente).`,
          tipo: "financeiro",
        });
      }
    }

    return new Response(JSON.stringify({ ok: true, comissoes }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Erro na function calcular-comissoes-contrato:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
