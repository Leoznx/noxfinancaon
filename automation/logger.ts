import { redactObject, redactSensitiveText } from "./redaction";

function timestamp(): string {
  return new Date().toISOString();
}

export function log(msg: string): void {
  console.log(`[${timestamp()}] ${msg}`);
}

const MAX_ERROR_DETAIL_LENGTH = 2_000;

/**
 * Erros do Supabase nem sempre são instâncias de Error. Antes eles viravam apenas
 * "[object Object]", justamente quando mais precisávamos do código e da mensagem
 * para diagnosticar uma queda do worker.
 */
export function formatErrorDetail(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err.slice(0, MAX_ERROR_DETAIL_LENGTH);
  if (err instanceof Error) {
    const cause = err.cause ? formatErrorDetail(err.cause) : "";
    return `${err.name === "Error" ? "" : `${err.name}: `}${err.message}${
      cause ? ` | causa: ${cause}` : ""
    }`.slice(0, MAX_ERROR_DETAIL_LENGTH);
  }
  if (typeof err === "object") {
    const record = err as Record<string, unknown>;
    const fields = ["name", "message", "code", "details", "hint", "status", "statusText"];
    const detail = fields
      .filter((field) => record[field] != null && record[field] !== "")
      .map((field) => `${field}=${String(record[field])}`)
      .join(" | ");
    if (detail) return detail.slice(0, MAX_ERROR_DETAIL_LENGTH);

    try {
      const seen = new WeakSet<object>();
      return JSON.stringify(err, (_key, value: unknown) => {
        if (typeof value === "bigint") return value.toString();
        if (value && typeof value === "object") {
          if (seen.has(value)) return "[circular]";
          seen.add(value);
        }
        return value;
      }).slice(0, MAX_ERROR_DETAIL_LENGTH);
    } catch {
      return Object.prototype.toString.call(err);
    }
  }
  return String(err).slice(0, MAX_ERROR_DETAIL_LENGTH);
}

export function logErro(msg: string, err?: unknown): void {
  const detalhe = redactSensitiveText(formatErrorDetail(err), MAX_ERROR_DETAIL_LENGTH);
  console.error(
    `[${timestamp()}] ERRO: ${redactSensitiveText(msg, 1_000)}${detalhe ? " — " + detalhe : ""}`,
  );
}

/** Eventos consumidos pela central/observabilidade, sempre em JSON e ja redigidos. */
export function logStructured(event: string, fields: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({
      timestamp: timestamp(),
      event,
      ...(redactObject(fields) as Record<string, unknown>),
    }),
  );
}

/**
 * Mascara CPF/CNPJ para nunca aparecer completo em logs do worker.
 * CPF  01883020016    -> 018.xxx.xxx-16
 * CNPJ 12345678000190 -> 12.xxx.xxx-xxxx-90
 */
export function maskDocumento(doc?: string | null): string {
  const d = String(doc || "").replace(/\D/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}.***.***-${d.slice(-2)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.***.***/****-${d.slice(-2)}`;
  if (d.length > 4) return `${d.slice(0, 2)}${"*".repeat(Math.max(0, d.length - 4))}${d.slice(-2)}`;
  return d ? "***" : "(vazio)";
}
