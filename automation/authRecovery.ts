import { isCredPagoAccountBlockedError } from "./credpagoAvailability";
import { LoftLoginChallengeError } from "./credpagoSelectors";
import { formatErrorDetail } from "./logger";

/**
 * Política de recuperação da autenticação do worker.
 *
 * Antes, toda falha de autenticação era tratada igual: nova validação a cada 30 s
 * e navegador recriado depois de duas falhas. Com a sessão expirada e um desafio
 * que só uma pessoa resolve, isso virava um ciclo sem fim — recriar o Chromium
 * várias vezes por hora (CPU, timeouts no Supabase, incidentes em cascata) e
 * repetir logins que não podem funcionar (risco de bloqueio da conta).
 */

export class CredPagoAuthenticationError extends Error {
  /** Somente uma pessoa resolve (credencial ausente/recusada, CAPTCHA, código por SMS/e-mail). */
  readonly humanRequired: boolean;

  constructor(message: string, options?: ErrorOptions & { humanRequired?: boolean }) {
    super(message, options);
    this.name = "CredPagoAuthenticationError";
    this.humanRequired = options?.humanRequired ?? false;
  }
}

export class CredPagoServiceUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CredPagoServiceUnavailableError";
  }
}

export type AuthFailureStatus = "blocked" | "required" | "unavailable";

export interface AuthFailure {
  status: AuthFailureStatus;
  kind: string;
  /** Só uma pessoa resolve; a renovação automática não deve insistir. */
  humanRequired: boolean;
}

const BROWSER_GONE_PATTERN =
  /target (?:page|context|browser).*closed|browser.*(?:closed|disconnected)|context.*closed|page crashed|protocol error/i;

export function classifyAuthFailure(error: unknown): AuthFailure {
  if (isCredPagoAccountBlockedError(error)) {
    return { status: "blocked", kind: "provider_access_restricted", humanRequired: true };
  }
  if (error instanceof CredPagoAuthenticationError) {
    const cause = error.cause;
    const challenge = cause instanceof LoftLoginChallengeError ? cause.kind : null;
    return {
      status: "required",
      kind: challenge ?? (error.humanRequired ? "credentials_missing" : "session_expired"),
      humanRequired: error.humanRequired,
    };
  }
  if (BROWSER_GONE_PATTERN.test(formatErrorDetail(error))) {
    return { status: "unavailable", kind: "browser_unavailable", humanRequired: false };
  }
  return { status: "unavailable", kind: "portal_unavailable", humanRequired: false };
}

export interface AuthBackoffConfig {
  baseMs: number;
  maxMs: number;
  humanMs: number;
  blockedMs: number;
}

/** Espera até a próxima validação: exponencial com teto; longa quando só uma pessoa resolve. */
export function authBackoffMs(
  failure: AuthFailure,
  consecutiveFailures: number,
  config: AuthBackoffConfig,
  random: () => number = Math.random,
): number {
  if (failure.status === "blocked") return config.blockedMs;
  if (failure.humanRequired) return config.humanMs;
  const factor = 2 ** Math.min(Math.max(consecutiveFailures - 1, 0), 6);
  const capped = Math.min(config.maxMs, config.baseMs * factor);
  return Math.round(capped + random() * Math.min(5_000, config.baseMs / 2));
}

export interface BrowserRestartDecisionInput {
  failure: AuthFailure;
  consecutiveFailures: number;
  failuresBeforeRestart: number;
  msSinceLastRestart: number;
  minIntervalMs: number;
}

/**
 * Recriar o Chromium só ajuda quando o navegador/portal está travado. Não adianta
 * para CAPTCHA, código, credencial recusada ou bloqueio comercial — e nunca com
 * mais frequência que `minIntervalMs`.
 */
export function shouldRestartBrowserAfterAuthFailure(input: BrowserRestartDecisionInput): boolean {
  const { failure } = input;
  if (failure.status === "blocked" || failure.humanRequired) return false;
  if (input.msSinceLastRestart < input.minIntervalMs) return false;
  if (failure.status === "unavailable") {
    return input.consecutiveFailures >= input.failuresBeforeRestart;
  }
  // Sessão expirada sem exigência humana: uma sessão limpa ocasionalmente resolve
  // cookies envenenados, mas só depois de várias tentativas normais.
  return input.consecutiveFailures >= Math.max(3, input.failuresBeforeRestart);
}
