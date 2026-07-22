import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  HttpError,
  corsHeaders,
  jsonResponse,
  requireUser,
  supabaseAdmin,
} from "../_shared/asaas.ts";
import { dispatchD4SignContract } from "../_shared/d4sign.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST")
    return jsonResponse(req, { ok: false, error: "Metodo nao permitido." }, 405);

  try {
    const { user } = await requireUser(req);
    const admin = supabaseAdmin();
    const body = await req.json();
    const consultationId = String(body?.consultationId || body?.proposalId || "");
    if (!/^[0-9a-f-]{36}$/i.test(consultationId)) {
      return jsonResponse(req, { ok: false, error: "Consulta invalida." }, 400);
    }

    const { data: consulta } = await admin
      .from("consultas_credito")
      .select("profile_id_solicitante")
      .eq("id", consultationId)
      .maybeSingle();
    const { data: internal } = await admin
      .from("internal_users")
      .select("id")
      .eq("auth_user_id", user.id)
      .eq("status", "ativo")
      .limit(1);
    if (consulta?.profile_id_solicitante !== user.id && !internal?.length) {
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
