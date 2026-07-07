function timestamp(): string {
  return new Date().toISOString();
}

export function log(msg: string): void {
  console.log(`[${timestamp()}] ${msg}`);
}

export function logErro(msg: string, err?: unknown): void {
  const detalhe = err instanceof Error ? err.message : err ? String(err) : "";
  console.error(`[${timestamp()}] ERRO: ${msg}${detalhe ? " — " + detalhe : ""}`);
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
