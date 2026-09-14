import type { Page } from "playwright";

export const CREDPAGO_ACCOUNT_BLOCKED_CODE = "CREDPAGO_ACCOUNT_BLOCKED";

function normalizePortalText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Identifica o bloqueio comercial exibido pela Loft sem depender do layout,
 * seletor CSS ou pontuacao do texto da pagina.
 */
export function isCreditSimulationAccountBlockedText(value: string): boolean {
  const text = normalizePortalText(value);
  return (
    text.includes("liberacao necessaria para criar contratos") ||
    /plataforma de fianca.{0,120}bloquead[ao].{0,120}criacao de contratos/.test(text) ||
    /solicite a liberacao.{0,120}time comercial da loft/.test(text)
  );
}

export class CredPagoAccountBlockedError extends Error {
  readonly code = CREDPAGO_ACCOUNT_BLOCKED_CODE;

  constructor() {
    super(
      `${CREDPAGO_ACCOUNT_BLOCKED_CODE}: A conta da integracao esta bloqueada pelo parceiro para criar contratos. ` +
        "Solicite a liberacao ao time comercial da Loft; nenhuma simulacao sera enviada enquanto o bloqueio estiver ativo.",
    );
    this.name = "CredPagoAccountBlockedError";
  }
}

export function isCredPagoAccountBlockedError(error: unknown): boolean {
  if (error instanceof CredPagoAccountBlockedError) return true;
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? "");
  return (
    detail.includes(CREDPAGO_ACCOUNT_BLOCKED_CODE) ||
    isCreditSimulationAccountBlockedText(detail)
  );
}

/** Le somente o aviso institucional da pagina; nenhum dado de cliente e capturado. */
export async function assertCreditSimulationAvailable(page: Page): Promise<void> {
  const bodyText = await page
    .locator("body")
    .innerText()
    .then((value) => value.replace(/\s+/g, " ").trim())
    .catch(() => "");
  if (isCreditSimulationAccountBlockedText(bodyText)) {
    throw new CredPagoAccountBlockedError();
  }
}
