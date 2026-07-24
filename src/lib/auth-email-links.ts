export type AuthEmailCallbackType =
  "signup" | "invite" | "magiclink" | "recovery" | "email_change" | "email";

const CALLBACK_TYPES = new Set<AuthEmailCallbackType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

export interface AuthEmailCallback {
  code: string | null;
  tokenHash: string | null;
  type: AuthEmailCallbackType | null;
  accessToken: string | null;
  refreshToken: string | null;
  error: string | null;
  errorDescription: string | null;
}

export function normalizeAuthEmailCallbackType(value: string | null): AuthEmailCallbackType | null {
  if (!value) return null;
  if (value === "email_change_current" || value === "email_change_new") return "email_change";
  return CALLBACK_TYPES.has(value as AuthEmailCallbackType)
    ? (value as AuthEmailCallbackType)
    : null;
}

/**
 * Monta um link que aponta direto para a aplicação e carrega somente o hash
 * de uso único. A confirmação acontece via verifyOtp quando a tela abre, sem
 * depender do redirect_to configurado no painel do Supabase.
 */
export function buildAuthEmailCallbackUrl({
  appUrl,
  path,
  tokenHash,
  type,
}: {
  appUrl: string;
  path: string;
  tokenHash: string;
  type: string;
}): string {
  const base = appUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${base}${normalizedPath}`);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", normalizeAuthEmailCallbackType(type) || type);
  return url.toString();
}

/** Lê callbacks novos (token_hash), PKCE (code) e links implícitos antigos (hash). */
export function parseAuthEmailCallback(href: string): AuthEmailCallback {
  const url = new URL(href);
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const getEither = (name: string) => url.searchParams.get(name) || hashParams.get(name);

  return {
    code: getEither("code"),
    tokenHash: getEither("token_hash"),
    type: normalizeAuthEmailCallbackType(getEither("type")),
    accessToken: hashParams.get("access_token"),
    refreshToken: hashParams.get("refresh_token"),
    error: getEither("error") || getEither("error_code"),
    errorDescription: getEither("error_description"),
  };
}

export function hasAuthEmailCallback(callback: AuthEmailCallback): boolean {
  return Boolean(
    callback.code ||
    callback.tokenHash ||
    (callback.accessToken && callback.refreshToken) ||
    callback.error ||
    callback.errorDescription,
  );
}

export function resolveTenantAccessReturnTo(value: string | null): string {
  return value === "/inquilino/documentos"
    ? value
    : "/inquilino/painel";
}
