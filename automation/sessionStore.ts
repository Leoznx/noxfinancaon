import fs from "node:fs/promises";

/**
 * Persistência segura do `storageState` (cookies + localStorage) da sessão Loft.
 *
 * Em produção esse arquivo é o único elo entre uma pessoa que fez login (e
 * resolveu CAPTCHA/OTP) e o worker headless da VPS. Por isso ele nunca pode ser
 * gravado pela metade, sobrescrito por uma sessão já expirada ou ficar ilegível
 * para o Playwright: qualquer um desses acidentes deixava o worker incapaz de
 * reabrir o navegador ("browser.newContext: Error setting storage state").
 */

/** Subconjunto do `storageState` do Playwright que o worker precisa validar. */
export interface StorageStateLike {
  cookies: Array<Record<string, unknown>>;
  origins: Array<Record<string, unknown>>;
}

export interface SessionFileFingerprint {
  mtimeMs: number;
  size: number;
}

export type SessionReadFailure = "missing" | "empty" | "invalid_json" | "invalid_shape" | "unreadable";

export type SessionReadResult =
  | { ok: true; state: StorageStateLike; fingerprint: SessionFileFingerprint }
  | { ok: false; reason: SessionReadFailure; detail?: string };

export interface SessionLoadResult {
  state: StorageStateLike | null;
  source: "primary" | "backup" | "none";
  fingerprint: SessionFileFingerprint | null;
  /** Motivo pelo qual o arquivo principal não pôde ser usado, quando aplicável. */
  primaryFailure: SessionReadFailure | null;
}

export interface SessionStoreHooks {
  warn?: (message: string) => void;
}

const PROVIDER_COOKIE_DOMAIN = /(?:^|\.)(?:loft\.com\.br|credpago\.com)$/i;
const MAX_QUARANTINED_FILES = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUsableCookie(cookie: unknown): cookie is Record<string, unknown> {
  return (
    isRecord(cookie) &&
    typeof cookie.name === "string" &&
    cookie.name.length > 0 &&
    typeof cookie.value === "string" &&
    typeof cookie.domain === "string" &&
    cookie.domain.length > 0 &&
    typeof cookie.path === "string"
  );
}

function isUsableOrigin(origin: unknown): origin is Record<string, unknown> {
  return (
    isRecord(origin) &&
    typeof origin.origin === "string" &&
    Array.isArray(origin.localStorage) &&
    origin.localStorage.every(
      (item) => isRecord(item) && typeof item.name === "string" && typeof item.value === "string",
    )
  );
}

/**
 * Aceita somente um `storageState` estruturalmente seguro e descarta entradas
 * malformadas em vez de deixar o Chromium rejeitar o contexto inteiro.
 */
export function validateStorageState(value: unknown): StorageStateLike | null {
  if (!isRecord(value) || !Array.isArray(value.cookies)) return null;
  const rawOrigins = value.origins === undefined ? [] : value.origins;
  if (!Array.isArray(rawOrigins)) return null;
  return {
    cookies: value.cookies.filter(isUsableCookie),
    origins: rawOrigins.filter(isUsableOrigin),
  };
}

/** Um estado sem nenhum cookie do provedor representa uma sessão perdida, não uma sessão válida. */
export function sessionHasProviderCookies(state: StorageStateLike): boolean {
  return state.cookies.some((cookie) =>
    PROVIDER_COOKIE_DOMAIN.test(String(cookie.domain ?? "").replace(/^\./, "")),
  );
}

export async function fingerprintSessionFile(
  filePath: string,
): Promise<SessionFileFingerprint | null> {
  try {
    const stat = await fs.stat(filePath);
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return null;
  }
}

export function sameFingerprint(
  left: SessionFileFingerprint | null,
  right: SessionFileFingerprint | null,
): boolean {
  if (!left || !right) return left === right;
  return left.mtimeMs === right.mtimeMs && left.size === right.size;
}

export async function readStorageStateFile(filePath: string): Promise<SessionReadResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await fingerprintSessionFile(filePath);
    if (!before) return { ok: false, reason: "missing" };

    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return { ok: false, reason: "missing" };
      return { ok: false, reason: "unreadable", detail: code ?? "erro de leitura" };
    }

    // Um arquivo substituído durante a leitura (scp/rename) precisa ser relido.
    const after = await fingerprintSessionFile(filePath);
    if (attempt === 0 && !sameFingerprint(before, after)) continue;

    if (!raw.trim()) return { ok: false, reason: "empty" };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return {
        ok: false,
        reason: "invalid_json",
        detail: error instanceof Error ? error.message : undefined,
      };
    }
    const state = validateStorageState(parsed);
    if (!state) return { ok: false, reason: "invalid_shape" };
    return { ok: true, state, fingerprint: after ?? before };
  }
  return { ok: false, reason: "unreadable", detail: "arquivo alterado durante a leitura" };
}

async function pruneQuarantine(filePath: string): Promise<void> {
  const directory = filePath.replace(/[\\/][^\\/]*$/, "") || ".";
  const prefix = `${filePath.split(/[\\/]/).pop()}.invalid-`;
  try {
    const entries = (await fs.readdir(directory)).filter((name) => name.startsWith(prefix)).sort();
    for (const name of entries.slice(0, Math.max(0, entries.length - MAX_QUARANTINED_FILES))) {
      await fs.unlink(`${directory}/${name}`).catch(() => {});
    }
  } catch {
    // A retenção da quarentena é apenas higiene; nunca pode bloquear o worker.
  }
}

/**
 * Carrega a sessão preferindo o arquivo principal, depois o último backup válido.
 * Um arquivo corrompido é movido para a quarentena (preservado para diagnóstico)
 * e o worker simplesmente inicia sem sessão, renovando o login normalmente.
 */
export async function loadStorageStateWithFallback(
  filePath: string,
  hooks: SessionStoreHooks = {},
): Promise<SessionLoadResult> {
  const primary = await readStorageStateFile(filePath);
  if (primary.ok) {
    return {
      state: primary.state,
      source: "primary",
      fingerprint: primary.fingerprint,
      primaryFailure: null,
    };
  }

  if (primary.reason !== "missing") {
    hooks.warn?.(
      `Arquivo de sessão inutilizável (${primary.reason}${primary.detail ? `: ${primary.detail}` : ""}); preservado em quarentena.`,
    );
    if (primary.reason !== "unreadable") {
      await fs.rename(filePath, `${filePath}.invalid-${Date.now()}`).catch(() => {});
      await pruneQuarantine(filePath);
    }
  }

  const backup = await readStorageStateFile(`${filePath}.bak`);
  if (backup.ok) {
    hooks.warn?.("Sessão restaurada a partir do último backup válido.");
    try {
      await fs.copyFile(`${filePath}.bak`, filePath);
    } catch {
      // Sem permissão de escrita, o backup ainda é usado em memória.
    }
    return {
      state: backup.state,
      source: "backup",
      fingerprint: await fingerprintSessionFile(filePath),
      primaryFailure: primary.reason,
    };
  }

  return {
    state: null,
    source: "none",
    fingerprint: await fingerprintSessionFile(filePath),
    primaryFailure: primary.reason,
  };
}

/**
 * Grava o estado em arquivo temporário, valida o conteúdo e só então troca o
 * arquivo principal por `rename` (atômico no mesmo volume). O último arquivo
 * válido é mantido como `.bak`.
 */
export async function writeStorageStateAtomically(
  filePath: string,
  state: StorageStateLike,
): Promise<SessionFileFingerprint> {
  const directory = filePath.replace(/[\\/][^\\/]*$/, "");
  if (directory && directory !== filePath) await fs.mkdir(directory, { recursive: true });

  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(state), { mode: 0o600 });
    const written = await readStorageStateFile(temporaryPath);
    if (!written.ok) {
      throw new Error(`O arquivo temporário da sessão não passou na validação (${written.reason}).`);
    }

    const current = await readStorageStateFile(filePath);
    if (current.ok) await fs.copyFile(filePath, `${filePath}.bak`).catch(() => {});

    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }

  const fingerprint = await fingerprintSessionFile(filePath);
  if (!fingerprint) throw new Error("O arquivo de sessão desapareceu logo após ser gravado.");
  return fingerprint;
}
