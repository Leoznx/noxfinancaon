import assert from "node:assert/strict";
import test from "node:test";
import {
  CredPagoAuthenticationError,
  CredPagoServiceUnavailableError,
  authBackoffMs,
  classifyAuthFailure,
  shouldRestartBrowserAfterAuthFailure,
  type AuthBackoffConfig,
  type AuthFailure,
} from "./authRecovery";
import { LoftLoginChallengeError } from "./credpagoSelectors";
import { CredPagoAccountBlockedError } from "./credpagoAvailability";

const config: AuthBackoffConfig = {
  baseMs: 30_000,
  maxMs: 600_000,
  humanMs: 1_200_000,
  blockedMs: 1_800_000,
};
const noJitter = () => 0;

test("classifica a restrição comercial da Loft como bloqueio que exige a parceira", () => {
  assert.deepEqual(classifyAuthFailure(new CredPagoAccountBlockedError()), {
    status: "blocked",
    kind: "provider_access_restricted",
    humanRequired: true,
  });
});

test("classifica CAPTCHA, código e credencial recusada como desafio humano", () => {
  for (const kind of ["captcha", "otp", "invalid_credentials"] as const) {
    const challenge = new LoftLoginChallengeError(kind, "desafio");
    const error = new CredPagoAuthenticationError("falhou", { cause: challenge, humanRequired: true });
    assert.deepEqual(classifyAuthFailure(error), { status: "required", kind, humanRequired: true });
  }
});

test("credencial ausente na VPS também exige uma pessoa", () => {
  const error = new CredPagoAuthenticationError("Sessão expirada e credenciais ausentes", {
    humanRequired: true,
  });
  assert.deepEqual(classifyAuthFailure(error), {
    status: "required",
    kind: "credentials_missing",
    humanRequired: true,
  });
});

test("uma sessão expirada que a renovação automática pode tentar resolver não exige uma pessoa", () => {
  assert.deepEqual(classifyAuthFailure(new CredPagoAuthenticationError("sessão expirada")), {
    status: "required",
    kind: "session_expired",
    humanRequired: false,
  });
});

test("navegador fechado e portal lento são indisponibilidade, nunca credencial inválida", () => {
  assert.deepEqual(
    classifyAuthFailure(new Error("locator.press: Target page, context or browser has been closed")),
    { status: "unavailable", kind: "browser_unavailable", humanRequired: false },
  );
  assert.deepEqual(
    classifyAuthFailure(new CredPagoServiceUnavailableError("O portal não respondeu a tempo")),
    { status: "unavailable", kind: "portal_unavailable", humanRequired: false },
  );
  assert.deepEqual(classifyAuthFailure(new Error("page.goto: Timeout 30000ms exceeded")), {
    status: "unavailable",
    kind: "portal_unavailable",
    humanRequired: false,
  });
});

test("o backoff cresce de forma exponencial até o teto", () => {
  const failure: AuthFailure = { status: "unavailable", kind: "portal_unavailable", humanRequired: false };
  const waits = [1, 2, 3, 4, 5, 6, 7, 20].map((n) => authBackoffMs(failure, n, config, noJitter));
  assert.deepEqual(waits, [30_000, 60_000, 120_000, 240_000, 480_000, 600_000, 600_000, 600_000]);
});

test("o jitter nunca passa de cinco segundos nem reduz a espera", () => {
  const failure: AuthFailure = { status: "unavailable", kind: "portal_unavailable", humanRequired: false };
  const max = authBackoffMs(failure, 1, config, () => 0.999999);
  assert.ok(max >= 30_000 && max <= 35_000);
});

test("desafio humano e bloqueio comercial usam esperas longas, sem insistir no login", () => {
  assert.equal(
    authBackoffMs({ status: "required", kind: "captcha", humanRequired: true }, 1, config, noJitter),
    1_200_000,
  );
  assert.equal(
    authBackoffMs({ status: "required", kind: "captcha", humanRequired: true }, 50, config, noJitter),
    1_200_000,
  );
  assert.equal(
    authBackoffMs(
      { status: "blocked", kind: "provider_access_restricted", humanRequired: true },
      3,
      config,
      noJitter,
    ),
    1_800_000,
  );
});

const restartBase = {
  failuresBeforeRestart: 2,
  msSinceLastRestart: 60 * 60_000,
  minIntervalMs: 5 * 60_000,
};

test("nunca recria o navegador por CAPTCHA, código, credencial recusada ou bloqueio comercial", () => {
  for (const failure of [
    { status: "required", kind: "captcha", humanRequired: true },
    { status: "required", kind: "credentials_missing", humanRequired: true },
    { status: "blocked", kind: "provider_access_restricted", humanRequired: true },
  ] as AuthFailure[]) {
    assert.equal(
      shouldRestartBrowserAfterAuthFailure({ ...restartBase, failure, consecutiveFailures: 99 }),
      false,
    );
  }
});

test("recria o navegador após falhas repetidas de indisponibilidade, respeitando o intervalo mínimo", () => {
  const failure: AuthFailure = { status: "unavailable", kind: "browser_unavailable", humanRequired: false };
  assert.equal(
    shouldRestartBrowserAfterAuthFailure({ ...restartBase, failure, consecutiveFailures: 1 }),
    false,
  );
  assert.equal(
    shouldRestartBrowserAfterAuthFailure({ ...restartBase, failure, consecutiveFailures: 2 }),
    true,
  );
  assert.equal(
    shouldRestartBrowserAfterAuthFailure({
      ...restartBase,
      failure,
      consecutiveFailures: 5,
      msSinceLastRestart: 30_000,
    }),
    false,
  );
});

test("uma sessão expirada só ganha um navegador limpo depois de várias tentativas normais", () => {
  const failure: AuthFailure = { status: "required", kind: "session_expired", humanRequired: false };
  assert.equal(
    shouldRestartBrowserAfterAuthFailure({ ...restartBase, failure, consecutiveFailures: 2 }),
    false,
  );
  assert.equal(
    shouldRestartBrowserAfterAuthFailure({ ...restartBase, failure, consecutiveFailures: 3 }),
    true,
  );
});
