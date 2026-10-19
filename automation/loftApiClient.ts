import type { ResultadoStatus } from "./types";

/**
 * Cliente HTTP direto para a API da Loft (CredPago).
 *
 * Substitui a automação por Playwright: chama a API interna diretamente
 * com autenticação OAuth2 (client credentials), sem abrir o portal.
 *
 * Fluxo completo:
 * 1. Obter token OAuth2
 * 2. Criar simulação
 * 3. Escolher produto
 * 4. Atualizar proposta
 * 5. Simular fiança
 * 6. Submeter proposta
 * 7. Extrair resultado
 */

const LOFT_API_BASE = "https://app.loft.com.br/fianca-aluguel/imobiliaria/api";
const LOFT_OAUTH_TOKEN_URL = "https://auth.loft.com.br/v2/oauth/token";

export interface LoftApiClientConfig {
  clientId: string;
  clientSecret: string;
  scope?: string;
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

interface OAuth2TokenResponse {
  access_token: string;
  expires_in: number;
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

export class LoftApiClient {
  private clientId: string;
  private clientSecret: string;
  private scope: string;
  private fetchImpl: typeof fetch;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(config: LoftApiClientConfig) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.scope = config.scope ?? "loft-aluguel";
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  static normalizarStatus(statusLoft: string): Exclude<ResultadoStatus, "erro"> {
    const s = statusLoft.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (s.includes("aprov")) return "aprovado";
    if (s.includes("recus") || s.includes("reprov") || s.includes("negad")) return "recusado";
    return "em_analise";
  }

  private async obterToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: this.scope,
    });

    const response = await this.fetchImpl(LOFT_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error(`OAuth2 ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as OAuth2TokenResponse;
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in - 300) * 1000;
    return this.accessToken;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = await this.obterToken();
    const response = await this.fetchImpl(`${LOFT_API_BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
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
