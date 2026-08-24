import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return response({ ok: false, error: "Método não permitido." }, 405);

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
    admin.from("profiles").select("role").eq("id", callerId).maybeSingle(),
    admin.from("internal_users").select("role, status").eq("auth_user_id", callerId).maybeSingle(),
  ]);
  const isAdmin =
    ["admin", "admin_master"].includes(String(callerProfile?.role ?? "")) ||
    (callerInternal?.role === "admin_master" && callerInternal?.status === "ativo");
  if (!isAdmin)
    return response(
      { ok: false, error: "Apenas administradores podem excluir colaboradores." },
      403,
    );

  let employeeId = "";
  try {
    const body = await req.json();
    employeeId = String(body?.employeeId ?? "").trim();
  } catch {
    return response({ ok: false, error: "Corpo da requisição inválido." }, 400);
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(employeeId)
  ) {
    return response({ ok: false, error: "Colaborador inválido." }, 400);
  }

  const { data: employee, error: employeeError } = await admin
    .from("internal_users")
    .select("id, auth_user_id, full_name, email, role, status")
    .eq("id", employeeId)
    .maybeSingle();
  if (employeeError)
    return response({ ok: false, error: "Não foi possível localizar o colaborador." }, 500);
  if (!employee) return response({ ok: false, error: "Colaborador não encontrado." }, 404);
  if (employee.auth_user_id === callerId)
    return response(
      { ok: false, error: "Você não pode excluir a própria conta por esta tela." },
      409,
    );
  if (employee.role === "admin_master")
    return response(
      { ok: false, error: "A conta Admin Master não pode ser excluída por esta tela." },
      409,
    );

  await admin.from("internal_audit_logs").insert({
    actor_user_id: callerId,
    actor_role: String(callerProfile?.role ?? callerInternal?.role ?? "admin"),
    action: "excluir_colaborador_nox",
    table_name: "internal_users",
    record_id: employee.id,
    before: {
      auth_user_id: employee.auth_user_id,
      nome: employee.full_name,
      email: employee.email,
      role: employee.role,
      status: employee.status,
    },
    after: null,
  });

  const { error: deleteError } = await admin.auth.admin.deleteUser(employee.auth_user_id);
  if (deleteError) {
    console.error("[delete-nox-employee] auth.admin.deleteUser", {
      employeeId,
      error: deleteError.message,
    });
    return response(
      { ok: false, error: "Não foi possível excluir o cadastro do colaborador." },
      500,
    );
  }

  // As FKs usam ON DELETE CASCADE. A limpeza defensiva abaixo também remove
  // uma eventual linha órfã criada antes dessas constraints existirem.
  await admin.from("internal_users").delete().eq("id", employeeId);
  await admin.from("profiles").delete().eq("id", employee.auth_user_id);

  return response({ ok: true, deletedUserId: employee.auth_user_id });
});
