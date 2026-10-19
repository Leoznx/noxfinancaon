import { LoftApiClient } from "./loftApiClient";
import type { ResultadoStatus } from "./types";
import type { ConsultaCreditoRow } from "./types";
import { log, logErro, maskDocumento } from "./logger";

/**
 * Processador direto da API da Loft.
 *
 * Usa o LoftApiClient para chamar a API da Loft diretamente, sem Playwright.
 * É uma alternativa mais rápida e confiável à automação por browser.
 *
 * Retorna o resultado no mesmo formato que o parser do Playwright.
 */

export interface ProcessamentoResultado {
  status: Exclude<ResultadoStatus, "erro">;
  proposalId: string | null;
  clienteNome: string | null;
  clienteDocumento: string | null;
  rawSummary: Record<string, unknown>;
}

export class LoftDirectProcessor {
  private client: LoftApiClient;

  constructor(clientId: string, clientSecret: string) {
    this.client = new LoftApiClient({
      clientId,
      clientSecret,
      scope: "loft-aluguel",
    });
  }

  async processarConsulta(consulta: ConsultaCreditoRow): Promise<ProcessamentoResultado> {
    const cid = consulta.correlation_id ?? consulta.id;
    const doc = maskDocumento(consulta.documento);

    log(`[${cid}] Processando via API direta (documento ${doc})`);

    try {
      const resultado = await this.client.simularCredito({
        tipoPessoa: consulta.tipo_pessoa ?? "PF",
        documento: consulta.documento ?? "",
        nome: consulta.tenant_name ?? "",
        tipoImovel: consulta.tipo_imovel ?? "Residencial",
        cep: consulta.cep ?? "",
        valorAluguel: consulta.valor_aluguel ?? 0,
        valorCondominio: consulta.valor_condominio ?? 0,
        valorTaxas: consulta.valor_taxas ?? 0,
      });

      log(`[${cid}] Resultado via API: ${resultado.status}`);

      return {
        status: resultado.status,
        proposalId: resultado.proposalId,
        clienteNome: resultado.clienteNome,
        clienteDocumento: resultado.clienteDocumento,
        rawSummary: resultado.rawResponse,
      };
    } catch (error) {
      logErro(`[${cid}] Falha ao processar via API`, error);
      throw error;
    }
  }
}

/**
 * Cria um processador direto se as credenciais estiverem disponíveis.
 */
export function createLoftDirectProcessor(): LoftDirectProcessor | null {
  const clientId = process.env.LOFT_OAUTH_CLIENT_ID;
  const clientSecret = process.env.LOFT_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null;
  }

  return new LoftDirectProcessor(clientId, clientSecret);
}
