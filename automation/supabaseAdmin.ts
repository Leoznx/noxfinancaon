import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

/**
 * Client Supabase com service role key — só pode ser usado neste processo
 * Node local (worker). Nunca importar este módulo a partir do frontend.
 */
export const supabaseAdmin = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
