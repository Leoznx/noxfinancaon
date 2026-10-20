import { LoftApiClient } from "./loftApiClient";
import type { ResultadoStatus } from "./types";
import type { ConsultaCreditoRow } from "./types";
import { log, logErro, maskDocumento } from "./logger";
import { resolve } from "node:path";

/**
 * Processador direto da API da Loft.
 *
 * Usa cookies de sessão (arquivo credpago-session.json) — sem OAuth2,
 * sem client_id/client_secret. É uma alternativa mais rápida e confiável
 * à automação por browser.
 */

export interface ProcessamentoResultado {
  status: Exclude<ResultadoStatus, "erro">;
  proposalId: string | null;
  clienteNome: string | null;
  clienteDocumento: string | null;
  rawSummary: Record<string, unknown>;
}

function resolveSessionFile(): string {
  // No container, o worker salva a sessão em /app/data/credpago-session.json
  const candidates = [
    "/app/data/credpago-session.json",
    resolve(process.cwd(), "data", "credpago-session.json"),
    resolve(process.cwd(), "automation", "data", "credpago-session.json"),
  ];
  return candidates[0];
}

export class LoftDirectProcessor {
  private client: LoftApiClient;

  constructor(sessionFile?: string) {
    this.client = new LoftApiClient({
      sessionFile: sessionFile ?? resolveSessionFile(),
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
      logErro(`[${cid}] Falha ao processando via API`, error);
      throw error;
    }
  }
}
