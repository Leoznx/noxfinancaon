import type { ResultadoStatus } from "./types";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Cliente HTTP direto para a API da Loft (CredPago).
 *
 * NÃO usa OAuth2 (client_id/client_secret). Em vez disso, usa os cookies
 * de sessão já salvos pelo worker (credpago-session.json) para autenticar
 * as chamadas — o mesmo mecanismo que o Playwright usa.
 *
 * Se o arquivo de sessão não existe, tenta extrair cookies de um arquivo
 * Playwright storageState.
 */

const LOFT_API_BASE = "https://app.loft.com.br/fianca-aluguel/imobiliaria/api";
const LOFT_SESSION_FILE = "/app/data/credpago-session.json";

export interface LoftApiClientConfig {
  /** Caminho para o arquivo de sessão (cookies) */
  sessionFile?: string;
  /** Função fetch customizada (para testes) */
  fetchImpl?: typeof fetch;
}

export interface SimulacaoInput {
  tipoPessoa: "PF" | "PJ";
  documento: string;
  nome: string;
  tipoImovel: string;
  cep: string;
  valorAluguel: number;
  valorCondominio: number;
  valorTaxas: number;
}

export interface SimulacaoResultado {
  status: Exclude<ResultadoStatus, "erro">;
  proposalId: string | null;
  clienteNome: string | null;
  clienteDocumento: string | null;
  rawResponse: Record<string, unknown>;
}

interface LoftResponse<T = Record<string, unknown>> {
  statusCode: number;
  data: T;
  message?: string;
}

interface LoftSimulacao {
  id: number;
  status_codigo?: number;
  analise?: { status?: string };
}

interface LoftSubmissao {
  id?: string;
  proposta_id?: string;
  status_codigo?: number;
  analise?: { status?: string };
}

interface StorageState {
  cookies?: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
  }>;
}

export class LoftApiClient {
  private sessionFile: string;
  private fetchImpl: typeof fetch;
  private cookies: Map<string, string> = new Map();

  constructor(config: LoftApiClientConfig = {}) {
    this.sessionFile = config.sessionFile ?? LOFT_SESSION_FILE;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  static normalizarStatus(statusLoft: string): Exclude<ResultadoStatus, "erro"> {
    const s = statusLoft.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (s.includes("aprov")) return "aprovado";
    if (s.includes("recus") || s.includes("reprov") || s.includes("negad")) return "recusado";
    return "em_analise";
  }

  /**
   * Carrega cookies do arquivo de sessão.
   */
  private async carregarCookies(): Promise<void> {
    if (!existsSync(this.sessionFile)) {
      throw new Error(`Arquivo de sessão não encontrado: ${this.sessionFile}`);
    }

    const content = readFileSync(this.sessionFile, "utf-8");
    const state = JSON.parse(content) as StorageState;

    if (!state.cookies || state.cookies.length === 0) {
      throw new Error("Sessão vazia: nenhum cookie encontrado");
    }

    // Filtra apenas cookies do domínio app.loft.com.br
    for (const cookie of state.cookies) {
      const domain = cookie.domain ?? "";
      if (domain.includes("loft.com.br") || domain.includes("app.loft.com.br")) {
        this.cookies.set(cookie.name, cookie.value);
      }
    }

    if (this.cookies.size === 0) {
      throw new Error("Nenhum cookie válido para o domínio loft.com.br");
    }
  }

  private getCookieHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    // Garante que os cookies estão carregados
    if (this.cookies.size === 0) {
      await this.carregarCookies();
    }

    const response = await this.fetchImpl(`${LOFT_API_BASE}${path}`, {
      ...options,
      headers: {
        Cookie: this.getCookieHeader(),
        "Content-Type": "application/json",
        ...(options.headers as Record<string, string>),
      },
    });

    if (!response.ok) {
      throw new Error(`Loft ${response.status}: ${await response.text()}`);
    }

    const json = (await response.json()) as LoftResponse<T>;
    return json.data;
  }

  /**
   * Executa o fluxo completo de simulação de crédito.
   */
  async simularCredito(input: SimulacaoInput): Promise<SimulacaoResultado> {
    // 1. Criar simulação
    const inquilinoPrincipal =
      input.tipoPessoa === "PF"
        ? { cpf: input.documento, nome: input.nome }
        : { cnpj: input.documento };

    const simulacao = await this.request<LoftSimulacao>("/solicitacao/simulacao", {
      method: "POST",
      body: JSON.stringify({
        tipo_imovel: input.tipoImovel,
        cep: input.cep,
        valor_aluguel: input.valorAluguel,
        valor_condominio: input.valorCondominio,
        valor_outras_taxas: input.valorTaxas,
        inquilino_principal: inquilinoPrincipal,
        outros_inquilinos: [],
      }),
    });

    // 2. Escolher produto (FIT_NOVO)
    await this.request(`/solicitacao/simulacao/escolher-produto/${simulacao.id}`, {
      method: "POST",
      body: JSON.stringify({ id_produto: 33, taxa_setup: 0 }),
    });

    // 3. Atualizar proposta
    await this.request(`/solicitacao/simulacao/proposta/${simulacao.id}`, {
      method: "PUT",
      body: JSON.stringify({
        endereco: { cep: input.cep },
        subtipo_imovel: input.tipoImovel,
        tag: "nox_financa",
        ramo_atividade: "Aluguel",
        tipo_cobranca: "Mensal",
        taxa_setup: 0,
        inquilinos: [{ cpf: input.documento, nome: input.nome, tipo: input.tipoPessoa }],
      }),
    });

    // 4. Simular fiança
    await this.request(
      `/solicitacao/simulacao/${simulacao.id}/simular-parametros-fianca`,
      {
        method: "POST",
        body: JSON.stringify({ custo_saida: 2.5, cobertura_total: 12, comissao: 65 }),
      },
    );

    // 5. Submeter proposta
    const submissao = await this.request<LoftSubmissao>(
      `/solicitacao/simulacao/proposta/${simulacao.id}/submeter`,
      { method: "POST" },
    );

    const statusLoft = submissao.analise?.status ?? "Pendente";
    const status = LoftApiClient.normalizarStatus(statusLoft);

    return {
      status,
      proposalId: submissao.proposta_id ?? String(simulacao.id),
      clienteNome: input.nome,
      clienteDocumento: input.documento,
      rawResponse: { simulacao, submissao, statusLoft },
    };
  }
}
