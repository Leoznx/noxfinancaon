import { getRequest } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type RateLimitOptions = {
  scope: string;
  identifier?: string;
  limit: number;
  windowSeconds: number;
  blockSeconds?: number;
};

function requestAddress() {
  const request = getRequest();
  const forwarded =
    request?.headers.get("x-vercel-forwarded-for") ||
    request?.headers.get("x-forwarded-for") ||
    request?.headers.get("x-real-ip") ||
    "unknown";
  return forwarded.split(",")[0]?.trim().slice(0, 128) || "unknown";
}

export async function enforceSecurityRateLimit(options: RateLimitOptions) {
  const identifier = `${requestAddress()}:${(options.identifier || "anonymous").toLowerCase().trim()}`;
  const { data, error } = await (supabaseAdmin.rpc as any)("consume_security_rate_limit", {
    p_scope: options.scope,
    p_identifier: identifier,
    p_limit: options.limit,
    p_window_seconds: options.windowSeconds,
    p_block_seconds: options.blockSeconds ?? 900,
  });
  if (error) {
    console.error("[security] rate limit unavailable", { scope: options.scope, code: error.code });
    throw new Error("Serviço temporariamente indisponível. Tente novamente em instantes.");
  }
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.allowed) {
    throw new Error("Muitas tentativas. Aguarde alguns minutos e tente novamente.");
  }
}
