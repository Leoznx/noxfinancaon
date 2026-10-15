const RECOVERY_STORAGE_KEY = "nox:navigation-recovery:v1";
const RECOVERY_COOLDOWN_MS = 30_000;

type RecoveryState = {
  href: string;
  attemptedAt: number;
};

type ReloadOptions = {
  force?: boolean;
};

const RECOVERABLE_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /failed to load module script/i,
  /chunkloaderror/i,
  /loading (?:css )?chunk .+ failed/i,
  /unable to preload css/i,
  /module script.+mime type/i,
];

let installed = false;
let lastInMemoryAttempt: RecoveryState | undefined;

function collectErrorText(value: unknown, seen = new Set<object>()): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object" || seen.has(value)) return [];

  seen.add(value);
  const record = value as Record<string, unknown>;
  const texts: string[] = [];

  for (const key of ["name", "message", "cause", "error", "reason", "payload"]) {
    texts.push(...collectErrorText(record[key], seen));
  }

  return texts;
}

export function isRecoverableNavigationError(error: unknown): boolean {
  const message = collectErrorText(error).join(" ");
  return RECOVERABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function readRecoveryState(): RecoveryState | undefined {
  try {
    const stored = window.sessionStorage.getItem(RECOVERY_STORAGE_KEY);
    if (!stored) return lastInMemoryAttempt;
    const parsed = JSON.parse(stored) as Partial<RecoveryState>;
    if (typeof parsed.href === "string" && typeof parsed.attemptedAt === "number") {
      return parsed as RecoveryState;
    }
  } catch {
    // Alguns navegadores bloqueiam sessionStorage. O controle em memória ainda
    // evita várias tentativas concorrentes antes da navegação ser substituída.
  }
  return lastInMemoryAttempt;
}

function rememberRecoveryAttempt(state: RecoveryState) {
  lastInMemoryAttempt = state;
  try {
    window.sessionStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A recuperação não deve depender da disponibilidade do storage.
  }
}

/**
 * Troca uma aba presa em assets de um deploy antigo pelo documento atual.
 * A janela de proteção impede loops quando a causa real não é uma versão antiga.
 */
export function reloadCurrentDocumentForNavigationError(
  error: unknown,
  options: ReloadOptions = {},
): boolean {
  if (typeof window === "undefined") return false;
  if (!options.force && !isRecoverableNavigationError(error)) return false;

  const now = Date.now();
  const href = window.location.href;
  const previous = readRecoveryState();
  if (
    !options.force &&
    previous?.href === href &&
    now - previous.attemptedAt < RECOVERY_COOLDOWN_MS
  ) {
    return false;
  }

  rememberRecoveryAttempt({ href, attemptedAt: now });
  window.location.reload();
  return true;
}

/** Instala a recuperação antes que qualquer rota dividida seja carregada. */
export function installNavigationRecovery() {
  if (typeof window === "undefined" || installed) return;
  installed = true;

  window.addEventListener("vite:preloadError", (event) => {
    const error = (event as Event & { payload?: unknown }).payload ?? event;
    if (reloadCurrentDocumentForNavigationError(error)) event.preventDefault();
  });

  window.addEventListener("unhandledrejection", (event) => {
    if (reloadCurrentDocumentForNavigationError(event.reason)) event.preventDefault();
  });

  window.addEventListener("error", (event) => {
    const error = event.error ?? event.message;
    if (reloadCurrentDocumentForNavigationError(error)) event.preventDefault();
  });
}
