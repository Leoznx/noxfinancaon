import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, jsonResponse, requireUser } from "../_shared/asaas.ts";

type Body = { apolice_id?: string };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Endpoint de compatibilidade. A geração real acontece na função SQL
// `generate_commissions_for_policy`, também chamada automaticamente pelo
// trigger de ativação da apólice. O cliente nunca informa base, percentual,
// nível, quantidade de contratos, valor ou status.
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") {
    return jsonResponse(req, { ok: false, error: "Metodo nao permitido." }, 405);
  }

  try {
    const { supabase, user } = await requireUser(req);
    const body = (await req.json()) as Body;
    const policyId = String(body.apolice_id || "").trim();
    if (!UUID_PATTERN.test(policyId)) {
      return jsonResponse(req, { ok: false, error: "Apolice nao encontrada." }, 400);
    }

    const [{ data: policy, error: policyError }, { data: profile }, { data: internalUser }] =
      await Promise.all([
        supabase
          .from("apolices")
          .select("id, status, corretor_profile_id, imobiliaria_profile_id, proprietario_profile_id")
          .eq("id", policyId)
          .maybeSingle(),
        supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
        supabase
          .from("internal_users")
          .select("role, status")
          .eq("auth_user_id", user.id)
          .maybeSingle(),
      ]);

    if (policyError) throw policyError;
    if (!policy) return jsonResponse(req, { ok: false, error: "Apolice nao encontrada." }, 404);

    const ownsPolicy = [
      policy.corretor_profile_id,
      policy.imobiliaria_profile_id,
      policy.proprietario_profile_id,
    ].includes(user.id);
    const profileRole = String(profile?.role || "");
    const internalRole =
      internalUser?.status === "ativo" ? String(internalUser?.role || "") : "";
    const isAuthorizedStaff =
      ["admin", "admin_master", "financeiro"].includes(profileRole) ||
      ["admin_master", "financeiro"].includes(internalRole);

    if (!ownsPolicy && !isAuthorizedStaff) {
      return jsonResponse(req, { ok: false, error: "Acesso nao autorizado." }, 403);
    }

    const { data, error } = await supabase.rpc("generate_commissions_for_policy", {
      p_policy_id: policyId,
      p_event_key: `POLICY_ACTIVATED:${policyId}`,
      p_notify: true,
    });
    if (error) throw error;

    return jsonResponse(req, { ok: true, result: data });
  } catch (error) {
    console.error("[calcular-comissoes-contrato] falha segura", {
      code:
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code || "unknown")
          : "unknown",
    });
    return jsonResponse(
      req,
      { ok: false, error: "Nao foi possivel materializar as comissoes." },
      500,
    );
  }
});

