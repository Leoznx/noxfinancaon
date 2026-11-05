import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import {
  corsHeaders,
  env,
  HttpError,
  jsonResponse,
  requireUser,
  supabaseAdmin,
} from "../_shared/asaas.ts";
import {
  finalizeD4SignContract,
  materializeD4SignContractDocument,
} from "../_shared/d4sign.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") {
    return jsonResponse(req, { ok: false, error: "Metodo nao permitido." }, 405);
  }

  try {
    const { user } = await requireUser(req);
    const body = await req.json();
    const policyId = String(body?.policyId || "");
    const action = String(body?.action || "materialize");
    if (!/^[0-9a-f-]{36}$/i.test(policyId)) {
      return jsonResponse(req, { ok: false, error: "Contrato invalido." }, 400);
    }

    const admin = supabaseAdmin();
    const { data: policy, error: policyError } = await admin
      .from("apolices")
      .select("id, consulta_id")
      .eq("id", policyId)
      .maybeSingle();
    if (policyError || !policy?.consulta_id) {
      return jsonResponse(req, { ok: false, error: "Contrato nao encontrado." }, 404);
    }

    const authorization = req.headers.get("Authorization") || "";
    const userClient = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    });
    const { data: allowed, error: accessError } = await userClient.rpc("can_view_policy", {
      _uid: user.id,
      _policy_id: policyId,
    });
    if (accessError || allowed !== true) {
      return jsonResponse(req, { ok: false, error: "Sem permissao para este contrato." }, 403);
    }

    if (action === "finalize_manual_signature") {
      const { data: signature, error: signatureError } = await admin
        .from("contract_signatures")
        .select("*")
        .eq("consultation_id", policy.consulta_id)
        .maybeSingle();
      if (
        signatureError ||
        !signature?.manual_signed_file_url ||
        !signature?.manual_signed_file_bucket ||
        signature?.signature_status !== "signed"
      ) {
        return jsonResponse(
          req,
          { ok: false, error: "A via assinada ainda nao foi confirmada." },
          409,
        );
      }
      const result = await finalizeD4SignContract(admin, signature);
      return jsonResponse(req, result as Record<string, unknown>);
    }

    if (action !== "materialize") {
      return jsonResponse(req, { ok: false, error: "Acao invalida." }, 400);
    }

    const result = await materializeD4SignContractDocument(
      admin,
      policy.consulta_id,
    );
    return jsonResponse(req, result as Record<string, unknown>);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof HttpError
      ? error.publicMessage
      : "Nao foi possivel preparar a visualizacao do contrato.";
    console.error("[contract-document] erro", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(req, { ok: false, error: message }, status);
  }
});
