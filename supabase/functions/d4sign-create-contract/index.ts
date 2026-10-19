import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  HttpError,
  corsHeaders,
  jsonResponse,
  requireUser,
  supabaseAdmin,
} from "../_shared/asaas.ts";
import { dispatchD4SignContract } from "../_shared/d4sign.ts";

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Internal roles autorizados a disparar o fluxo documental. SDR/SAC/suporte
// NAO podem gerar contrato na D4Sign nem reenviar convite para o inquilino.
const ROLES_INTERNAS_PERMITIDAS = new Set([
  "admin_master",
  "admin",
  "financeiro",
  "juridico",
  "closer",
  "vendedor",
]);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST")
    return jsonResponse(req, { ok: false, error: "Metodo nao permitido." }, 405);

  try {
    const { user } = await requireUser(req);
    const admin = supabaseAdmin();
    const body = await req.json();
    const consultationId = String(body?.consultationId || body?.proposalId || "");
    if (!UUID_V4_RE.test(consultationId)) {
      return jsonResponse(req, { ok: false, error: "Consulta invalida." }, 400);
    }

    const { data: consulta } = await admin
      .from("consultas_credito")
      .select("profile_id_solicitante")
      .eq("id", consultationId)
      .maybeSingle();
    const { data: internal } = await admin
      .from("internal_users")
      .select("id, role")
      .eq("auth_user_id", user.id)
      .eq("status", "ativo")
      .limit(1);
    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    const roleInterna = internal?.[0]?.role;
    const roleProfile = profile?.role;
    const temRoleInternaValida =
      ROLES_INTERNAS_PERMITIDAS.has(String(roleInterna || "")) ||
      ROLES_INTERNAS_PERMITIDAS.has(String(roleProfile || "")) ||
      roleProfile === "imobiliaria";
    const ehDonoDaConsulta = consulta?.profile_id_solicitante === user.id;
    if (!ehDonoDaConsulta && !temRoleInternaValida) {
      return jsonResponse(req, { ok: false, error: "Sem permissao para esta consulta." }, 403);
    }

    // A autorização é verificada com a sessão do solicitante; a integração
    // externa e seus registros internos usam o cliente administrativo.
    const result = await dispatchD4SignContract(admin, consultationId);
    return jsonResponse(req, result as Record<string, unknown>, result.ok ? 200 : 422);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message =
      error instanceof HttpError
        ? error.publicMessage
        : "Nao foi possivel enviar o contrato agora.";
    console.error("[d4sign-create-contract] erro", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(req, { ok: false, error: message }, status);
  }
});
