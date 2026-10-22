import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import {
  normalizeDirectDResult,
  sanitizeDirectDResponse,
  type DirectDScoreResponse,
} from "../_shared/directd-credit.ts";
import { corsHeaders, hasOversizedBody, rejectDisallowedOrigin } from "../_shared/http-security.ts";

const ALLOWED_ROLES = new Set(["corretor", "imobiliaria", "admin", "analista"]);
const DIRECTD_SCORE_URL = "https://apiv3.directd.com.br/api/Score";
const REQUEST_TIMEOUT_MS = 30_000;

type ClaimedConsultation = {
  id: string;
  documento: string | null;
  tenant_document: string | null;
  tipo_pessoa: string | null;
  execution_version: number;
};

function digits(value: unknown): string {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });

  const rejected = rejectDisallowedOrigin(req);
  if (rejected) return rejected;
  if (req.method !== "POST") return json({ ok: false, error: "Método não permitido." }, 405);
  if (hasOversizedBody(req, 16_384))
    return json({ ok: false, error: "Payload muito grande." }, 413);

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const directDToken = Deno.env.get("DIRECTD_API_TOKEN")?.trim() ?? "";

  try {
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await supabaseUser.auth.getUser();
    if (!user) return json({ ok: false, error: "Não autenticado." }, 401);

    const body = (await req.json()) as { consultaId?: unknown };
    const consultaId = typeof body.consultaId === "string" ? body.consultaId.trim() : "";
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(consultaId)
    ) {
      return json({ ok: false, error: "consultaId inválido." }, 400);
    }

    const [{ data: profile }, { data: visibleConsultation }] = await Promise.all([
      supabaseUser.from("profiles").select("role").eq("id", user.id).maybeSingle(),
      supabaseUser.from("consultas_credito").select("id").eq("id", consultaId).maybeSingle(),
    ]);
    if (!profile || !ALLOWED_ROLES.has(String((profile as { role?: string }).role ?? ""))) {
      return json({ ok: false, error: "Sem permissão para simular crédito." }, 403);
    }
    if (!visibleConsultation) return json({ ok: false, error: "Consulta não encontrada." }, 404);

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);
    if (!directDToken) {
      await supabaseAdmin.rpc("fail_official_credit_simulation_configuration", {
        p_consultation_id: consultaId,
        p_error_code: "DIRECTD_TOKEN_MISSING",
      });
      return json({ ok: false, error: "A API oficial de crédito não está configurada." });
    }

    const workerId = `edge-directd-${crypto.randomUUID()}`;
    const { data: claimedRows, error: claimError } = await supabaseAdmin.rpc(
      "claim_official_credit_simulation",
      { p_consultation_id: consultaId, p_worker_id: workerId },
    );
    if (claimError) throw claimError;
    const claimed = (
      Array.isArray(claimedRows) ? claimedRows[0] : claimedRows
    ) as ClaimedConsultation | null;

    if (!claimed) {
      const { data: current } = await supabaseAdmin
        .from("consultas_credito")
        .select("status, resultado, technical_status")
        .eq("id", consultaId)
        .maybeSingle();
      return json({ ok: true, idempotent: true, consulta: current ?? null });
    }

    const document = digits(claimed.documento || claimed.tenant_document);
    if (document.length !== 11 && document.length !== 14) {
      await supabaseAdmin.rpc("fail_official_credit_simulation", {
        p_consultation_id: consultaId,
        p_worker_id: workerId,
        p_execution_version: claimed.execution_version,
        p_error_code: "INVALID_DOCUMENT",
        p_user_message: "CPF ou CNPJ inválido para a consulta oficial.",
        p_ambiguous_charge: false,
        p_provider_http_status: 400,
        p_charge_confirmed: false,
      });
      return json({ ok: false, error: "CPF ou CNPJ inválido para a consulta oficial." });
    }

    const url = new URL(DIRECTD_SCORE_URL);
    url.searchParams.set("TOKEN", directDToken);
    url.searchParams.set(document.length === 11 ? "CPF" : "CNPJ", document);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let providerResponse: Response;
    try {
      providerResponse = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } catch (error) {
      await supabaseAdmin.rpc("fail_official_credit_simulation", {
        p_consultation_id: consultaId,
        p_worker_id: workerId,
        p_execution_version: claimed.execution_version,
        p_error_code:
          error instanceof DOMException && error.name === "AbortError"
            ? "DIRECTD_TIMEOUT"
            : "DIRECTD_NETWORK_ERROR",
        p_user_message:
          "A resposta da API oficial ficou inconclusiva. O suporte precisa conferir antes de um novo envio.",
        p_ambiguous_charge: true,
        p_provider_http_status: null,
        p_charge_confirmed: false,
      });
      return json({
        ok: false,
        error: "A resposta da API oficial ficou inconclusiva e não será reenviada automaticamente.",
      });
    } finally {
      clearTimeout(timeout);
    }

    const responseText = await providerResponse.text();
    const parsed = safeJson(responseText) as DirectDScoreResponse | null;

    if (providerResponse.status === 201 || providerResponse.status === 202) {
      await supabaseAdmin.rpc("fail_official_credit_simulation", {
        p_consultation_id: consultaId,
        p_worker_id: workerId,
        p_execution_version: claimed.execution_version,
        p_error_code: "DIRECTD_ASYNC_PENDING",
        p_user_message:
          "A Direct Data aceitou a consulta de forma assíncrona. O suporte precisa acompanhar o retorno sem gerar nova cobrança.",
        p_ambiguous_charge: true,
        p_provider_http_status: providerResponse.status,
        p_charge_confirmed: false,
      });
      return json({ ok: false, error: "Consulta aceita pelo provedor e aguardando conferência." });
    }

    if (!providerResponse.ok || !parsed) {
      const safeToRetry = [400, 401, 403, 404, 503].includes(providerResponse.status);
      await supabaseAdmin.rpc("fail_official_credit_simulation", {
        p_consultation_id: consultaId,
        p_worker_id: workerId,
        p_execution_version: claimed.execution_version,
        p_error_code: `DIRECTD_HTTP_${providerResponse.status}`,
        p_user_message:
          providerResponse.status === 403
            ? "Saldo indisponível na Direct Data. Recarregue a conta antes de tentar novamente."
            : "A API oficial não conseguiu concluir a consulta.",
        p_ambiguous_charge: !safeToRetry,
        p_provider_http_status: providerResponse.status,
        p_charge_confirmed: false,
      });
      return json({ ok: false, error: "A API oficial não conseguiu concluir a consulta." });
    }

    const result = normalizeDirectDResult(parsed, document.length);
    if (!result) {
      await supabaseAdmin.rpc("fail_official_credit_simulation", {
        p_consultation_id: consultaId,
        p_worker_id: workerId,
        p_execution_version: claimed.execution_version,
        p_error_code: "DIRECTD_UNKNOWN_SCORE_RANGE",
        p_user_message:
          "A QUOD retornou uma faixa de score não reconhecida. O suporte precisa revisar o resultado.",
        p_ambiguous_charge: true,
        p_provider_http_status: providerResponse.status,
        p_charge_confirmed: true,
      });
      return json({
        ok: false,
        error: "Faixa de score não reconhecida; revisão manual necessária.",
      });
    }

    const sanitizedResponse = sanitizeDirectDResponse(parsed, document.length);
    const { data: finished, error: finishError } = await supabaseAdmin.rpc(
      "finish_official_credit_simulation",
      {
        p_consultation_id: consultaId,
        p_worker_id: workerId,
        p_execution_version: claimed.execution_version,
        p_credit_result: result.decision,
        p_message: result.message,
        p_score: result.score,
        p_score_band: result.faixaScore,
        p_provider_external_id: parsed.metaDados?.consultaUid ?? null,
        p_sanitized_response: sanitizedResponse,
        p_provider_http_status: providerResponse.status,
      },
    );
    if (finishError) throw finishError;
    if (!finished) {
      return json({ ok: false, error: "A consulta perdeu o vínculo de processamento." });
    }

    await supabaseAdmin.from("audit_logs").insert({
      action: "simulacao_credito_quod_concluida",
      module: "consultas_credito",
      target_id: consultaId,
      performed_by: user.id,
      new_value: {
        provider: "directd_quod",
        decision: result.decision,
        scoreBand: result.faixaScore,
        billedCents: 198,
      },
    });

    return json({
      ok: true,
      resultado: {
        status: result.decision,
        faixaScore: result.faixaScore,
        score: result.score,
      },
    });
  } catch (error) {
    console.error(
      "Falha na simulação oficial de crédito:",
      error instanceof Error ? error.message : "erro desconhecido",
    );
    return json({ ok: false, error: "Não foi possível concluir a consulta oficial." }, 500);
  }
});
