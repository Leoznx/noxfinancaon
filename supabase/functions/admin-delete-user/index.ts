import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.110.0";
import { corsHeaders, hasOversizedBody, rejectDisallowedOrigin } from "../_shared/http-security.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USER_PREFIX_BUCKETS = ["time-clock-photos", "documentos-verificacao"] as const;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  const response = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  const rejected = rejectDisallowedOrigin(req);
  if (rejected) return rejected;
  if (req.method !== "POST") return response({ ok: false, error: "Método não permitido." }, 405);
  if (hasOversizedBody(req, 8_192))
    return response({ ok: false, error: "Payload muito grande." }, 413);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey)
    return response({ ok: false, error: "Credenciais do backend ausentes." }, 500);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return response({ ok: false, error: "Não autenticado." }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: callerData, error: callerError } = await admin.auth.getUser(token);
  const callerId = callerData?.user?.id;
  if (callerError || !callerId)
    return response({ ok: false, error: "Sessão inválida ou expirada." }, 401);

  const [{ data: callerProfile }, { data: callerInternal }] = await Promise.all([
    admin.from("profiles").select("role, status").eq("id", callerId).maybeSingle(),
    admin.from("internal_users").select("role, status").eq("auth_user_id", callerId).maybeSingle(),
  ]);
  const callerRole = String(callerProfile?.role ?? callerInternal?.role ?? "");
  const isAdmin =
    (["admin", "admin_master"].includes(String(callerProfile?.role ?? "")) &&
      !["bloqueado", "excluido"].includes(String(callerProfile?.status ?? ""))) ||
    (callerInternal?.role === "admin_master" && callerInternal?.status === "ativo");
  if (!isAdmin)
    return response({ ok: false, error: "Apenas administradores podem excluir usuários." }, 403);

  let targetUserId = "";
  try {
    const body = await req.json();
    targetUserId = String(body?.targetUserId ?? "").trim();
  } catch {
    return response({ ok: false, error: "Corpo da requisição inválido." }, 400);
  }
  if (!UUID_RE.test(targetUserId)) return response({ ok: false, error: "Usuário inválido." }, 400);
  if (targetUserId === callerId)
    return response(
      { ok: false, error: "Você não pode excluir a própria conta por esta tela." },
      409,
    );

  const [{ data: targetProfile, error: profileError }, { data: targetInternal }] =
    await Promise.all([
      admin
        .from("profiles")
        .select("id, nome, email, role, status")
        .eq("id", targetUserId)
        .maybeSingle(),
      admin
        .from("internal_users")
        .select("id, full_name, email, role, seller_type")
        .eq("auth_user_id", targetUserId)
        .maybeSingle(),
    ]);
  if (profileError)
    return response({ ok: false, error: "Não foi possível localizar o usuário." }, 500);
  if (!targetProfile) return response({ ok: false, error: "Usuário não encontrado." }, 404);
  if (targetProfile.role === "admin_master" || targetInternal?.role === "admin_master")
    return response({ ok: false, error: "A conta Admin Master não pode ser excluída." }, 409);

  try {
    for (const bucket of USER_PREFIX_BUCKETS) {
      const paths = await listFilesRecursively(admin, bucket, targetUserId);
      if (!paths.length) continue;
      const { error } = await admin.storage.from(bucket).remove(paths);
      if (error) throw new Error(`Falha ao remover arquivos de ${bucket}: ${error.message}`);
    }
  } catch (error) {
    console.error("[admin-delete-user] storage cleanup", { targetUserId, error });
    return response(
      { ok: false, error: "Não foi possível remover todos os arquivos do usuário." },
      500,
    );
  }

  const { data: purgeSummary, error: purgeError } = await admin.rpc("admin_purge_user_data", {
    p_user_id: targetUserId,
  });
  if (purgeError) {
    console.error("[admin-delete-user] data purge", {
      targetUserId,
      error: purgeError.message,
    });
    return response(
      { ok: false, error: "Não foi possível remover todos os vínculos do usuário." },
      500,
    );
  }

  const { error: authDeleteError } = await admin.auth.admin.deleteUser(targetUserId, false);
  if (authDeleteError) {
    console.error("[admin-delete-user] auth delete", {
      targetUserId,
      error: authDeleteError.message,
    });
    return response(
      {
        ok: false,
        error: "Os dados foram removidos, mas a conta de acesso não pôde ser finalizada.",
      },
      500,
    );
  }

  await admin.from("internal_audit_logs").insert({
    actor_user_id: callerId,
    actor_role: callerRole || "admin",
    action: "excluir_usuario_total",
    table_name: "auth.users",
    record_id: targetUserId,
    before: {
      nome: targetProfile.nome,
      email: targetProfile.email,
      role: targetProfile.role,
      internal_role: targetInternal?.role ?? null,
      seller_type: targetInternal?.seller_type ?? null,
    },
    after: { deleted: true, purge_summary: purgeSummary },
  });

  return response({ ok: true, deletedUserId: targetUserId, purgeSummary });
});

async function listFilesRecursively(
  admin: SupabaseClient<any, "public", "public", any, any>,
  bucket: string,
  prefix: string,
) {
  const files: string[] = [];
  const walk = async (path: string) => {
    let offset = 0;
    while (true) {
      const { data, error } = await admin.storage.from(bucket).list(path, {
        limit: 1000,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) {
        if (/not found/i.test(error.message)) return;
        throw error;
      }
      const entries = data ?? [];
      for (const entry of entries) {
        const child = `${path}/${entry.name}`;
        if (entry.id) files.push(child);
        else await walk(child);
      }
      if (entries.length < 1000) break;
      offset += entries.length;
    }
  };
  await walk(prefix);
  return files;
}
