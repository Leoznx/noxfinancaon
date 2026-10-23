export interface DirectDIdentityResponse {
  metaDados?: {
    consultaNome?: string | null;
    consultaUid?: string | null;
    mensagem?: string | null;
    resultadoId?: number | null;
    resultado?: string | null;
    apiVersao?: string | null;
    assincrono?: boolean | null;
    data?: string | null;
    tempoExecucaoMs?: number | null;
  } | null;
  retorno?: {
    cpf?: string | null;
    cnpj?: string | null;
    nome?: string | null;
    razaoSocial?: string | null;
    nomeFantasia?: string | null;
    dataNascimento?: string | null;
  } | null;
}

export interface NormalizedDirectDIdentity {
  customerName: string;
  birthDate: string | null;
  providerExternalId: string | null;
}

function normalizeProviderMessage(value: unknown): string {
  return typeof value === "string"
    ? value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
    : "";
}

/** HTTP 200 também pode representar documento ausente na base cadastral. */
export function isDirectDIdentityNotFound(response: DirectDIdentityResponse): boolean {
  const resultId = Number(response.metaDados?.resultadoId);
  const providerMessage = normalizeProviderMessage(
    `${response.metaDados?.resultado ?? ""} ${response.metaDados?.mensagem ?? ""}`,
  );
  const explicitlyNotFound =
    providerMessage.includes("documento entidade nao encontrada") ||
    providerMessage.includes("documento nao encontrado") ||
    providerMessage.includes("entidade nao encontrada");

  return explicitlyNotFound || (resultId === 6 && providerMessage.includes("nao encontrad"));
}

const INVALID_NAME_WORDS =
  /\b(cpf|cnpj|cliente|inquilin[oa]|locat[aá]ri[oa]|proponente|nome|resultado|an[aá]lise|cr[eé]dito|aprovad[oa]|recusad[oa]|valor|aluguel|simula[cç][aã]o|pendente|dados)\b/i;

export function normalizeDirectDIdentityName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length < 2 || normalized.length > 120) return null;
  if (/\d/.test(normalized) || !/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(normalized)) return null;
  if (INVALID_NAME_WORDS.test(normalized)) return null;
  return normalized;
}

export function normalizeDirectDBirthDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const brazilian = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const parts = brazilian
    ? { year: Number(brazilian[3]), month: Number(brazilian[2]), day: Number(brazilian[1]) }
    : iso
      ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
      : null;
  if (!parts) return null;

  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    date.getUTCFullYear() !== parts.year ||
    date.getUTCMonth() !== parts.month - 1 ||
    date.getUTCDate() !== parts.day
  ) {
    return null;
  }
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (date.getTime() > todayUtc || parts.year < 1900) return null;
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function normalizeDirectDIdentity(
  response: DirectDIdentityResponse,
  documentLength: number,
): NormalizedDirectDIdentity | null {
  const customerName =
    documentLength === 14
      ? (normalizeDirectDIdentityName(response.retorno?.razaoSocial) ??
        normalizeDirectDIdentityName(response.retorno?.nomeFantasia) ??
        normalizeDirectDIdentityName(response.retorno?.nome))
      : normalizeDirectDIdentityName(response.retorno?.nome);
  if (!customerName) return null;

  return {
    customerName,
    birthDate:
      documentLength === 11 ? normalizeDirectDBirthDate(response.retorno?.dataNascimento) : null,
    providerExternalId: response.metaDados?.consultaUid?.trim() || null,
  };
}

/**
 * A resposta cadastral contém telefones, e-mails, endereços e filiação. O fluxo
 * de crédito precisa somente da identidade; nenhum outro dado é persistido.
 */
export function sanitizeDirectDIdentityResponse(
  response: DirectDIdentityResponse,
  documentLength: number,
): Record<string, unknown> {
  const identity = normalizeDirectDIdentity(response, documentLength);
  return {
    metaDados: {
      consultaNome: response.metaDados?.consultaNome ?? null,
      consultaUid: response.metaDados?.consultaUid ?? null,
      mensagem: response.metaDados?.mensagem ?? null,
      resultadoId: response.metaDados?.resultadoId ?? null,
      resultado: response.metaDados?.resultado ?? null,
      apiVersao: response.metaDados?.apiVersao ?? null,
      assincrono: response.metaDados?.assincrono ?? null,
      data: response.metaDados?.data ?? null,
      tempoExecucaoMs: response.metaDados?.tempoExecucaoMs ?? null,
    },
    retorno: {
      nome: identity?.customerName ?? null,
      dataNascimento: identity?.birthDate ?? null,
    },
  };
}
