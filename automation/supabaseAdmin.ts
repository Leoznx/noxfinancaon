import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

const fetchWithTimeout: typeof fetch = async (input, init = {}) => {
  const controller = new AbortController();
  const sourceSignal = init.signal;
  const forwardAbort = () => controller.abort(sourceSignal?.reason);
  if (sourceSignal?.aborted) forwardAbort();
  else sourceSignal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), env.supabaseRequestTimeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    sourceSignal?.removeEventListener("abort", forwardAbort);
  }
};

/**
 * Client Supabase com service role key — só pode ser usado neste processo
 * Node local (worker). Nunca importar este módulo a partir do frontend.
 */
export const supabaseAdmin = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: fetchWithTimeout },
});
