const DEFAULT_ALLOWED_ORIGINS = ["https://noxfianca.com", "https://www.noxfianca.com"];

function configuredOrigins() {
  return (Deno.env.get("ALLOWED_ORIGINS") || DEFAULT_ALLOWED_ORIGINS.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function isAllowedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  if (configuredOrigins().includes(origin)) return true;
  if (Deno.env.get("ALLOW_LOCAL_ORIGINS") === "true") {
    try {
      const hostname = new URL(origin).hostname;
      return hostname === "localhost" || hostname === "127.0.0.1";
    } catch {
      return false;
    }
  }
  return false;
}

export function corsHeaders(request: Request, extraHeaders = "") {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": `authorization, x-client-info, apikey, content-type${extraHeaders}`,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && isAllowedOrigin(request)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

export function rejectDisallowedOrigin(request: Request) {
  return isAllowedOrigin(request)
    ? null
    : new Response(JSON.stringify({ ok: false, error: "Origem não autorizada." }), {
        status: 403,
        headers: { ...corsHeaders(request), "Content-Type": "application/json" },
      });
}

export function hasOversizedBody(request: Request, maxBytes = 1_048_576) {
  const length = Number(request.headers.get("content-length") || "0");
  return Number.isFinite(length) && length > maxBytes;
}

export function safeEqualSecret(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a[index] ^ b[index];
  return result === 0;
}
