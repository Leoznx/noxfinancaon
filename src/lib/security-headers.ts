const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://connect.facebook.net https://cakto-sdk.pages.dev",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://viacep.com.br https://api.cakto.com.br https://www.google-analytics.com https://region1.google-analytics.com https://www.googleadservices.com https://stats.g.doubleclick.net https://www.facebook.com",
  "worker-src 'self' blob:",
  "frame-src 'self' https://www.facebook.com",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const PRIVATE_PATH_PREFIXES = [
  "/admin",
  "/dashboard",
  "/consultas",
  "/apolices",
  "/configuracoes",
  "/vendedor",
  "/inquilino",
  "/login",
  "/cadastro",
  "/email-verificado",
  "/redefinir-senha",
  "/recuperar-acesso",
  "/acesso-inquilino",
  "/completar-acesso-inquilino",
  "/_server",
];

export function applySecurityHeaders(request: Request, response: Response) {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Permissions-Policy",
    "camera=(self), geolocation=(self), microphone=(), payment=(self), usb=()",
  );
  headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  headers.set("Cross-Origin-Resource-Policy", "same-site");

  const pathname = new URL(request.url).pathname;
  const isPrivate =
    !["GET", "HEAD"].includes(request.method.toUpperCase()) ||
    headers.has("set-cookie") ||
    PRIVATE_PATH_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
  if (isPrivate) {
    headers.set("Cache-Control", "private, no-store, max-age=0");
    headers.set("Pragma", "no-cache");
    headers.set("Expires", "0");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
