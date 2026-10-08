const LOFT_PROPOSAL_PATH_PATTERN = /\/(?:proposta|proposal)(?:\/[^/?#]+)*\/(\d{4,12})(?:\/|$)/i;
const LOFT_PROPOSAL_TEXT_PATTERN = /\bproposta\s*(?:n[º°o.]*)?\s*[:#-]?\s*(\d{4,12})\b/i;

export const LOFT_CANCELLATION_REASONS = [
  "Inquilino desistiu do aluguel",
  "Inquilino vai contratar outra fiança",
  "Inquilino vai usar outro tipo de garantia",
  "Imóvel não está mais disponível",
] as const;

export type LoftCancellationReason = (typeof LOFT_CANCELLATION_REASONS)[number];

export interface LoftCancellationConfig {
  apiBaseUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  authorizationDetails?: string;
  requestTimeoutMs: number;
}

export interface LoftCancellationResult {
  proposalId: string;
  status: string;
}

export class LoftApiError extends Error {
  readonly httpStatus: number | null;

  constructor(message: string, httpStatus: number | null = null, options?: ErrorOptions) {
    super(message, options);
    this.name = "LoftApiError";
    this.httpStatus = httpStatus;
  }
}

export function isLoftCancellationReason(value: unknown): value is LoftCancellationReason {
  return LOFT_CANCELLATION_REASONS.includes(value as LoftCancellationReason);
}

/**
 * Recupera o identificador técnico da proposta sem confundi-lo com CPF/CNPJ.
 * A Loft já usou tanto uma rota com o id quanto query strings e um título visível.
 */
export function extractLoftProposalId(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/^\d{4,12}$/.test(text)) return text;

  try {
    const url = new URL(text);
    const pathMatch = url.pathname.match(LOFT_PROPOSAL_PATH_PATTERN);
    if (pathMatch) return pathMatch[1];

    for (const key of ["proposalId", "proposal_id", "proposta", "id_proposta"]) {
      const candidate = url.searchParams.get(key)?.trim();
      if (/^\d{4,12}$/.test(candidate ?? "")) return candidate!;
    }
  } catch {
    // O mesmo helper também aceita o texto visível da página.
  }

  return text.match(LOFT_PROPOSAL_TEXT_PATTERN)?.[1] ?? null;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function readJsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export class LoftCancellationClient {
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  constructor(
    private readonly config: LoftCancellationConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async requestWithTimeout(input: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      return await this.fetchImpl(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new LoftApiError(
          `Tempo limite de ${Math.round(this.config.requestTimeoutMs / 1000)}s excedido na API da parceira.`,
          null,
          { cause: error },
        );
      }
      throw new LoftApiError("Falha de rede ao acessar a API da parceira.", null, {
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.accessToken && Date.now() < this.accessTokenExpiresAt) {
      return this.accessToken;
    }

    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: "client_credentials",
      scope: this.config.scope,
    });
    if (this.config.authorizationDetails) {
      body.set("authorization_details", this.config.authorizationDetails);
    }

    const response = await this.requestWithTimeout(this.config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) {
      throw new LoftApiError(
        `A parceira recusou a autenticação técnica (HTTP ${response.status}).`,
        response.status,
      );
    }

    const payload = readJsonRecord(await response.json().catch(() => ({})));
    const token = typeof payload.access_token === "string" ? payload.access_token : "";
    const expiresIn = Number(payload.expires_in);
    if (!token) {
      throw new LoftApiError("A autenticação técnica não devolveu um token de acesso.");
    }

    this.accessToken = token;
    const safeLifetimeSeconds = Number.isFinite(expiresIn) ? Math.max(5, expiresIn - 30) : 4 * 60;
    this.accessTokenExpiresAt = Date.now() + safeLifetimeSeconds * 1000;
    return token;
  }

  private async performAuthorizedRequest(input: string, init: RequestInit): Promise<Response> {
    const performRequest = async (forceRefresh: boolean) => {
      const token = await this.getAccessToken(forceRefresh);
      return this.requestWithTimeout(input, {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          ...init.headers,
        },
      });
    };

    let response = await performRequest(false);
    if (response.status === 401) response = await performRequest(true);
    return response;
  }

  private async readConfirmedProposalStatus(
    response: Response,
    proposalId: string,
  ): Promise<LoftCancellationResult> {
    const payload = readJsonRecord(await response.json().catch(() => ({})));
    const data = readJsonRecord(payload.data);
    const status = readJsonRecord(data.status);
    const returnedId = typeof data.id === "string" ? data.id : "";
    const statusName = typeof status.name === "string" ? status.name : "";
    if (!returnedId || returnedId !== proposalId) {
      throw new LoftApiError(
        `A parceira respondeu com um identificador inesperado para a proposta ${proposalId}.`,
      );
    }
    if (!statusName) {
      throw new LoftApiError(`A parceira não devolveu o estado da proposta ${proposalId}.`);
    }

    return { proposalId: returnedId, status: statusName };
  }

  private async getProposalStatus(proposalId: string): Promise<LoftCancellationResult> {
    const response = await this.performAuthorizedRequest(
      `${normalizeBaseUrl(this.config.apiBaseUrl)}/rental-guarantee/v1/proposal/${encodeURIComponent(proposalId)}`,
      { method: "GET" },
    );
    if (!response.ok) {
      throw new LoftApiError(
        `A parceira não devolveu o estado atual da proposta (HTTP ${response.status}).`,
        response.status,
      );
    }

    return this.readConfirmedProposalStatus(response, proposalId);
  }

  async cancelProposal(
    proposalId: string,
    reason: LoftCancellationReason,
    comment?: string,
  ): Promise<LoftCancellationResult> {
    if (!/^\d{4,12}$/.test(proposalId)) {
      throw new LoftApiError("Identificador da proposta inválido.");
    }
    if (!isLoftCancellationReason(reason)) {
      throw new LoftApiError("Motivo de cancelamento não reconhecido pela parceira.");
    }

    // A fila é at-least-once. Conferir o estado antes do POST torna a repetição
    // segura quando a Loft cancelou, mas o worker caiu antes de persistir o sucesso.
    const current = await this.getProposalStatus(proposalId);
    if (/cancelad[oa]/i.test(current.status)) return current;

    const response = await this.performAuthorizedRequest(
      `${normalizeBaseUrl(this.config.apiBaseUrl)}/rental-guarantee/v1/proposal/${encodeURIComponent(proposalId)}/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason,
          ...(comment?.trim() ? { comment: comment.trim() } : {}),
        }),
      },
    );
    if (!response.ok) {
      throw new LoftApiError(
        `A parceira não confirmou o cancelamento (HTTP ${response.status}).`,
        response.status,
      );
    }

    const result = await this.readConfirmedProposalStatus(response, proposalId);
    if (!/cancelad[oa]/i.test(result.status)) {
      throw new LoftApiError(
        `A parceira respondeu com um estado inesperado para a proposta ${proposalId}.`,
      );
    }

    return result;
  }
}
