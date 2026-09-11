import crypto from "node:crypto";

const CORRELATION_PATTERN = /^NOX-(SIM|SYS)-\d{8}-[A-F0-9]{8}$/;

function datePart(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .replace(/-/g, "");
}

export function createCorrelationId(kind: "SIM" | "SYS" = "SIM", date = new Date()): string {
  return `NOX-${kind}-${datePart(date)}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

export function isValidCorrelationId(value: unknown): value is string {
  return typeof value === "string" && CORRELATION_PATTERN.test(value);
}

export function ensureCorrelationId(value: unknown, kind: "SIM" | "SYS" = "SIM"): string {
  return isValidCorrelationId(value) ? value : createCorrelationId(kind);
}
