import { supabase } from "@/integrations/supabase/client";
import { upsertConsultaCredito } from "@/lib/consultas";
import type { DadosSimulacao } from "@/components/simulacao/FormularioSimulacao";

/**
 * Chama a API da Loft diretamente via Edge Function e grava o resultado.
 *
 * Fluxo:
 * 1. Cria a consulta no banco (status: processando)
 * 2. Chama a Edge Function simular-loft
 * 3. Grava o resultado no banco
 * 4. Retorna o resultado para o frontend
 */

export interface SimularLoftDiretoResult {
  ok: boolean;
  consultaId: string;
  status: "aprovado" | "recusado" | "em_analise";
  proposalId: string | null;
  clienteNome: string | null;
  clienteDocumento: string | null;
  error?: string;
}

function extrairDocumento(dados: DadosSimulacao): { tipoPessoa: "PF" | "PJ"; documento: string } {
  if (dados.tipoInquilino === "PF") {
    const cpf = dados.inquilinos[0]?.cpf?.replace(/\D/g, "") ?? "";
    return { tipoPessoa: "PF", documento: cpf };
  }
  const cnpj = dados.cnpj.replace(/\D/g, "");
  return { tipoPessoa: "PJ", documento: cnpj };
}

function extrairNome(dados: DadosSimulacao): string {
  if (dados.tipoInquilino === "PF") {
    return dados.inquilinos[0]?.nome ?? "";
  }
  return dados.razaoSocial;
}

export async function simularLoftDireto(
  dados: DadosSimulacao,
  userEmail: string,
  userRole?: string | null,
): Promise<SimularLoftDiretoResult> {
  const { tipoPessoa, documento } = extrairDocumento(dados);
  const nome = extrairNome(dados);

  // 1. Criar a consulta no banco (sem enfileirar - status direto)
  const consultaId = await upsertConsultaCredito({
    dados,
    userEmail,
    userRole,
    deferQueue: true,
  });

  try {
    // 2. Chamar a Edge Function
    const { data: authData } = await supabase.auth.getSession();
    const token = authData?.session?.access_token;

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const response = await fetch(
      `${supabaseUrl}/functions/v1/simular-loft`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          tipoPessoa,
          documento,
          nome,
          tipoImovel: dados.tipoImovel,
          cep: dados.cep,
          valorAluguel: dados.valores.aluguel,
          valorCondominio: dados.valores.condominio,
          valorTaxas: dados.valores.taxas,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Edge Function respondeu ${response.status}: ${errorText}`);
    }

    const resultado = await response.json();

    if (!resultado.ok) {
      throw new Error(resultado.error ?? "Falha na simulação");
    }

    // 3. Gravar o resultado no banco
    const status = resultado.resultado.status;
    const mensagem =
      status === "aprovado"
        ? "Crédito aprovado."
        : status === "recusado"
          ? "Crédito recusado."
          : "Crédito em análise.";

    await supabase
      .from("consultas_credito")
      .update({
        tipo_pessoa: tipoPessoa,
        documento: documento,
        tenant_name: nome,
        tipo_imovel: dados.tipoImovel,
        cep: dados.cep,
        valor_aluguel: dados.valores.aluguel,
        valor_condominio: dados.valores.condominio,
        valor_taxas: dados.valores.taxas,
        status: status,
        resultado: status,
        mensagem: mensagem,
        origem: "nox_financa_direto",
        external_provider: "loft_api",
        external_status: status,
        external_request_id: resultado.resultado.proposalId,
        external_response: resultado.resultado,
        automation_step: "api_direta",
        automation_started_at: new Date().toISOString(),
        automation_finished_at: new Date().toISOString(),
      })
      .eq("id", consultaId);

    return {
      ok: true,
      consultaId,
      status: status,
      proposalId: resultado.resultado.proposalId,
      clienteNome: nome,
      clienteDocumento: documento,
    };
  } catch (error) {
    console.error("Erro na simulação direta:", error);

    // Marcar erro no banco
    await supabase
      .from("consultas_credito")
      .update({
        status: "erro",
        error_message: error instanceof Error ? error.message : "Erro desconhecido",
        automation_finished_at: new Date().toISOString(),
      })
      .eq("id", consultaId);

    throw error;
  }
}
