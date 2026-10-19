import { supabase } from "@/lib/supabase";
import { upsertConsultaCredito } from "@/lib/consultas";
import type { DadosSimulacao } from "@/components/simulacao/FormularioSimulacao";

/**
 * Chama a API da Loft via Edge Function e grava o resultado.
 *
 * Fluxo:
 * 1. Cria/reaproveita a consulta no banco (status: processando)
 * 2. Chama a Edge Function simular-loft via supabase.functions.invoke
 * 3. Grava o resultado no banco
 * 4. Em caso de falha de rede/CORS/função indisponível, devolve ok=false
 *    SEM lançar erro, para que o chamador possa cair no fallback de fila
 *    + worker Playwright. A consulta criada aqui é reaproveitada via
 *    deduplicação por (profile + documento) feita por upsertConsultaCredito.
 */

export interface SimularLoftDiretoResult {
  ok: boolean;
  consultaId: string | null;
  status: "aprovado" | "recusado" | "em_analise" | null;
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

  // 1. Criar (ou reaproveitar) a consulta no banco.
  //    Se nem isso for possível, propaga o erro — o chamador exibe toast.
  let consultaId: string;
  try {
    consultaId = await upsertConsultaCredito({
      dados,
      userEmail,
      userRole,
      deferQueue: false,
    });
  } catch (error) {
    return {
      ok: false,
      consultaId: null,
      status: null,
      proposalId: null,
      clienteNome: null,
      clienteDocumento: null,
      error: error instanceof Error ? error.message : "Falha ao criar consulta",
    };
  }

  try {
    // 2. Chamar a Edge Function via client oficial — resolve URL/CORS/auth sem
    //    depender de VITE_SUPABASE_URL exposto em runtime nem de fetch cru.
    const { data, error } = await supabase.functions.invoke<{
      ok: boolean;
      resultado?: {
        status: "aprovado" | "recusado" | "em_analise";
        proposalId: string;
        clienteNome?: string;
        clienteDocumento?: string;
        statusLoft?: string;
      };
      error?: string;
    }>("simular-loft", {
      body: {
        tipoPessoa,
        documento,
        nome,
        tipoImovel: dados.tipoImovel,
        cep: dados.cep,
        valorAluguel: dados.valores.aluguel,
        valorCondominio: dados.valores.condominio,
        valorTaxas: dados.valores.taxas,
      },
    });

    if (error || !data?.ok || !data.resultado) {
      // Falha remota (função não publicada, credenciais Loft ausentes, 5xx):
      // devolve ok=false para o chamador decidir o fallback. A consulta
      // continua no banco com o estado criado por upsertConsultaCredito,
      // de onde o worker Playwright pode reaproveitá-la.
      return {
        ok: false,
        consultaId,
        status: null,
        proposalId: null,
        clienteNome: nome,
        clienteDocumento: documento,
        error: error?.message || data?.error || "API da Loft indisponível",
      };
    }

    const status = data.resultado.status;
    const mensagem =
      status === "aprovado"
        ? "Crédito aprovado."
        : status === "recusado"
          ? "Crédito recusado."
          : "Crédito em análise.";

    // 3. Gravar o resultado no banco. Mantemos apenas colunas cuja presenca ja
    //    foi migrada; metadados extras do provedor (external_*) ficam no payload
    //    do raw_response para nao depender de colunas opcionais.
    const { error: updateErr } = await supabase
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
        automation_step: "api_direta",
        automation_started_at: new Date().toISOString(),
        automation_finished_at: new Date().toISOString(),
        raw_response: {
          provider: "loft_api",
          external_status: status,
          external_request_id: data.resultado.proposalId,
          external_response: data.resultado,
        },
      } as never)
      .eq("id", consultaId);
    if (updateErr) {
      console.warn("Nao foi possivel gravar o resultado completo:", updateErr);
    }

    return {
      ok: true,
      consultaId,
      status,
      proposalId: data.resultado.proposalId,
      clienteNome: nome,
      clienteDocumento: documento,
    };
  } catch (error) {
    // Erro inesperado (ex.: TypeError "Failed to fetch" com o cliente antigo).
    // Nunca propaga: devolve ok=false para o chamador acionar o fallback.
    console.error("Erro na simulação direta:", error);
    return {
      ok: false,
      consultaId,
      status: null,
      proposalId: null,
      clienteNome: nome,
      clienteDocumento: documento,
      error: error instanceof Error ? error.message : "Falha na comunicação com a API",
    };
  }
}
