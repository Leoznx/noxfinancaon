const MAX_TEXT = 12_000;

const SECRET_KEY_PATTERN =
  /(authorization|apikey|api[-_]?key|service[-_]?role|password|senha|secret|token|cookie|set-cookie)\s*[:=]\s*([^\r\n,;]+)/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const DOCUMENT_PATTERN = /(?<!\d)(?:\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[-\s]?\d{2}|\d{2}[.\s-]?\d{3}[.\s-]?\d{3}[/.\s-]?\d{4}[-\s]?\d{2})(?!\d)/g;
const PHONE_PATTERN = /(?<!\d)(?:\+?55\s*)?\(?\d{2}\)?\s*9?\d{4}[-\s]?\d{4}(?!\d)/g;

export function redactSensitiveText(value: unknown, maxLength = MAX_TEXT): string {
  const raw = value instanceof Error ? `${value.name}: ${value.message}\n${value.stack ?? ""}` : String(value ?? "");
  return raw
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(JWT_PATTERN, "[JWT_REDACTED]")
    .replace(SECRET_KEY_PATTERN, "$1=[REDACTED]")
    .replace(EMAIL_PATTERN, "[EMAIL_REDACTED]")
    .replace(DOCUMENT_PATTERN, "[DOCUMENT_REDACTED]")
    .replace(PHONE_PATTERN, "[PHONE_REDACTED]")
    .slice(0, maxLength);
}

export function sanitizeUrl(value: unknown): string {
  try {
    const url = new URL(String(value));
    url.search = "";
    url.hash = "";
    return url.toString().slice(0, 500);
  } catch {
    return redactSensitiveText(value, 500);
  }
}

export function redactObject(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[DEPTH_LIMIT]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return redactSensitiveText(value, 2_000);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactObject(item, depth + 1));
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 80)) {
      if (/password|senha|secret|token|cookie|authorization|api.?key|service.?role/i.test(key)) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = redactObject(item, depth + 1);
      }
    }
    return result;
  }
  return redactSensitiveText(value, 2_000);
}
