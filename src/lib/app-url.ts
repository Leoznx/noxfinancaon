// Fonte única do domínio de produção pro código que roda no navegador — nunca
// aponta pra localhost nem pra URL de preview da Vercel, nem em fallback. Uso
// server-side (createServerFn/Edge Functions) deve usar process.env.APP_URL
// (ver buildRedirectTo em auth-signup.functions.ts/password-reset.functions.ts),
// não este módulo — import.meta.env não existe no lado servidor puro.
const PRODUCTION_APP_URL = "https://noxfianca.com";

export const APP_URL = String(
  (import.meta as any).env?.VITE_PUBLIC_SITE_URL || PRODUCTION_APP_URL,
).replace(/\/+$/, "");

export function buildAppUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${APP_URL}${normalizedPath}`;
}
