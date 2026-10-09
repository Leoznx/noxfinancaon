const NAME_LABEL =
  "(?:nome(?:\\s+do\\s+(?:cliente|inquilino|locat[aá]rio|proponente))?|cliente|inquilino|locat[aá]rio|proponente)";
const DOCUMENT_MARKER = "(?:CPF|CNPJ)\\s*:?|\\[DOCUMENT_REDACTED\\]";
const LEGAL_BEARER_WRAPPER =
  /^(?:(?:o(?:\s*\(\s*a\s*\))?|a)\s*,\s*)?(.+?)\s*,\s*portador(?:a)?\s+d[oa]\b.*$/iu;

const NON_NAME_WORDS = new Set([
  "aluguel",
  "analise",
  "aprovado",
  "aprovada",
  "cliente",
  "cnpj",
  "cpf",
  "credito",
  "dados",
  "inquilino",
  "inquilina",
  "locatario",
  "locataria",
  "nome",
  "pendente",
  "portador",
  "portadora",
  "proponente",
  "recusado",
  "recusada",
  "resultado",
  "simulacao",
  "valor",
]);

function normalizeWord(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

export function normalizeCreditCustomerName(
  value: unknown,
  requireFullName = false,
): string | null {
  if (typeof value !== "string") return null;

  let normalized = value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:;|,.-]+|[\s:;|,.-]+$/g, "")
    .trim();
  const legalWrapper = normalized.match(LEGAL_BEARER_WRAPPER);
  if (legalWrapper) {
    normalized = legalWrapper[1]
      .replace(/^[\s:;|,.-]+|[\s:;|,.-]+$/g, "")
      .trim();
  }
  if (normalized.length < 2 || normalized.length > 120 || /\d/.test(normalized)) return null;

  const words = normalized.match(/\p{L}+(?:['’-]\p{L}+)*/gu) ?? [];
  if (words.length === 0 || (requireFullName && words.length < 2)) return null;
  if (words.some((word) => NON_NAME_WORDS.has(normalizeWord(word)))) return null;

  return normalized;
}

function rawResponseObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function rawResponseText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return rawResponseText(JSON.parse(trimmed)) ?? trimmed;
    } catch {
      return trimmed;
    }
  }

  const object = rawResponseObject(value);
  if (!object) return null;
  for (const key of ["textoCapturado", "texto_capturado", "bodyText", "text"]) {
    if (typeof object[key] === "string" && object[key].trim()) return object[key].trim();
  }
  return null;
}

/**
 * Recupera o nome que já veio na resposta do parceiro de crédito, mas que versões
 * antigas do worker não conseguiram copiar para `tenant_name`.
 */
export function extractCreditCustomerName(rawResponse: unknown): string | null {
  const object = rawResponseObject(rawResponse);
  if (object) {
    for (const key of ["clienteNome", "customerName", "nomeCliente"]) {
      const directName = normalizeCreditCustomerName(object[key]);
      if (directName) return directName;
    }
  }

  const text = rawResponseText(rawResponse);
  if (!text) return null;

  const lines = text
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const labelWithValue = new RegExp(`^${NAME_LABEL}\\s*[:\\-]\\s*(.+)$`, "iu");
  const labelOnly = new RegExp(`^${NAME_LABEL}\\s*:?$`, "iu");
  const documentMarker = new RegExp(DOCUMENT_MARKER, "iu");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const labeled = line.match(labelWithValue)?.[1]?.split(documentMarker)[0];
    const labeledName = normalizeCreditCustomerName(labeled);
    if (labeledName) return labeledName;

    if (labelOnly.test(line)) {
      const nextLineName = normalizeCreditCustomerName(lines[index + 1]);
      if (nextLineName) return nextLineName;
    }

    if (documentMarker.test(line)) {
      const beforeDocument = line
        .split(documentMarker)[0]
        .replace(new RegExp(`${NAME_LABEL}\\s*[:\\-]?`, "giu"), " ");
      const sameLineName = normalizeCreditCustomerName(beforeDocument, true);
      if (sameLineName) return sameLineName;

      const previousLineName = normalizeCreditCustomerName(lines[index - 1], true);
      if (previousLineName) return previousLineName;
    }
  }

  const compact = lines.join(" ");
  const compactMatch = compact.match(
    new RegExp(`${NAME_LABEL}\\s*[:\\-]\\s*(.{2,120}?)(?=\\s+(?:${DOCUMENT_MARKER})|$)`, "iu"),
  );
  return normalizeCreditCustomerName(compactMatch?.[1]);
}

export function resolveCreditCustomerName({
  tenantName,
  rawResponse,
  fallbacks = [],
}: {
  tenantName: unknown;
  rawResponse?: unknown;
  fallbacks?: unknown[];
}): string | null {
  return (
    normalizeCreditCustomerName(tenantName) ??
    extractCreditCustomerName(rawResponse) ??
    fallbacks.map((value) => normalizeCreditCustomerName(value)).find(Boolean) ??
    null
  );
}
