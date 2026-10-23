import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import {
  normalizeDirectDResult,
  sanitizeDirectDResponse,
  type DirectDScoreResponse,
} from "../_shared/directd-credit.ts";
import {
  isDirectDIdentityNotFound,
  normalizeDirectDIdentity,
  normalizeDirectDIdentityName,
  sanitizeDirectDIdentityResponse,
  type DirectDIdentityResponse,
  type NormalizedDirectDIdentity,
} from "../_shared/directd-identity.ts";
import { corsHeaders, hasOversizedBody, rejectDisallowedOrigin } from "../_shared/http-security.ts";

const ALLOWED_ROLES = new Set(["corretor", "imobiliaria", "admin", "analista"]);
const DIRECTD_SCORE_URL = "https://apiv3.directd.com.br/api/Score";
const DIRECTD_PF_IDENTITY_URL = "https://apiv3.directd.com.br/api/CadastroPessoaFisica";
const DIRECTD_PJ_IDENTITY_URL = "https://apiv3.directd.com.br/api/CadastroPessoaJuridica";
const REQUEST_TIMEOUT_MS = 30_000;

type ClaimedConsultation = {
  id: string;
  documento: string | null;
  tenant_document: string | null;
  tenant_name: string | null;
  tenant_data_nascimento: string | null;
  tipo_pessoa: string | null;
  profile_id_solicitante: string;
  execution_version: number;
};

type IdentityRequestState = {
  identity_status: string | null;
  identity_attempt_count: number | null;
  identity_provider_consulta_uid: string | null;
  identity_customer_name: string | null;
  identity_birth_date: string | null;
  identity_provider_http_status: number | null;
  identity_error_code: string | null;
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

    const { data: identityProviderConfig, error: identityProviderConfigError } = await supabaseAdmin
      .from("credit_api_provider_config")
      .select("enabled, unit_cost_cents")
      .eq("provider_key", "directd-cadastro")
      .maybeSingle();
    if (identityProviderConfigError || !identityProviderConfig?.enabled) {
      await supabaseAdmin.rpc("fail_official_credit_simulation_configuration", {
        p_consultation_id: consultaId,
        p_error_code: "DIRECTD_IDENTITY_PROVIDER_DISABLED",
      });
      return json({ ok: false, error: "A consulta cadastral oficial não está configurada." });
    }
    const identityCostCents = Number(identityProviderConfig.unit_cost_cents) || 16;

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

    const { data: storedIdentityRequest, error: storedIdentityRequestError } = await supabaseAdmin
      .from("directd_credit_requests")
      .select(
        "identity_status, identity_attempt_count, identity_provider_consulta_uid, identity_customer_name, identity_birth_date, identity_provider_http_status, identity_error_code",
      )
      .eq("consultation_id", consultaId)
      .maybeSingle();
    if (storedIdentityRequestError) {
      await supabaseAdmin.rpc("fail_official_credit_simulation", {
        p_consultation_id: consultaId,
        p_worker_id: workerId,
        p_execution_version: claimed.execution_version,
        p_error_code: "IDENTITY_LEDGER_READ_FAILED",
        p_user_message: "Não foi possível preparar a identificação do CPF ou CNPJ.",
        p_ambiguous_charge: false,
        p_provider_http_status: null,
        p_charge_confirmed: false,
      });
      return json({ ok: false, error: "Não foi possível preparar a identificação do cliente." });
    }

    const storedIdentity = storedIdentityRequest as IdentityRequestState | null;
    let identity: NormalizedDirectDIdentity | null = null;
    const storedCustomerName = normalizeDirectDIdentityName(storedIdentity?.identity_customer_name);
    if (storedIdentity?.identity_status === "succeeded" && storedCustomerName) {
      identity = {
        customerName: storedCustomerName,
        birthDate: storedIdentity.identity_birth_date,
        providerExternalId: storedIdentity.identity_provider_consulta_uid,
      };
    } else if (
      storedIdentity?.identity_status === "failed_billed" &&
      storedIdentity.identity_error_code === "DIRECTD_IDENTITY_NOT_FOUND"
    ) {
      const documentLabel = document.length === 14 ? "CNPJ" : "CPF";
      const message = `${documentLabel} não localizado na base cadastral. Confira o documento antes de tentar novamente.`;
      await supabaseAdmin.rpc("fail_official_credit_simulation", {
        p_consultation_id: consultaId,
        p_worker_id: workerId,
        p_execution_version: claimed.execution_version,
        p_error_code: "DIRECTD_IDENTITY_NOT_FOUND",
        p_user_message: message,
        p_ambiguous_charge: false,
        p_provider_http_status: storedIdentity.identity_provider_http_status,
        p_charge_confirmed: false,
      });
      return json({ ok: false, error: message });
    } else if (storedIdentity?.identity_status === "requires_verification") {
      await supabaseAdmin.rpc("fail_official_credit_simulation", {
        p_consultation_id: consultaId,
        p_worker_id: workerId,
        p_execution_version: claimed.execution_version,
        p_error_code: storedIdentity.identity_error_code ?? "DIRECTD_IDENTITY_REQUIRES_VERIFICATION",
        p_user_message:
          "A identificação oficial anterior precisa de conferência antes de um novo envio.",
        p_ambiguous_charge: true,
        p_provider_http_status: storedIdentity.identity_provider_http_status,
        p_charge_confirmed: false,
      });
      return json({ ok: false, error: "A identificação oficial anterior precisa de conferência." });
    } else {
      const identityAttemptCount = Number(storedIdentity?.identity_attempt_count ?? 0) + 1;
      const { error: identityStartError } = await supabaseAdmin
        .from("directd_credit_requests")
        .update({
          identity_status: "submitting",
          identity_attempt_count: identityAttemptCount,
          identity_provider_http_status: null,
          identity_error_code: null,
          identity_requested_at: new Date().toISOString(),
          identity_completed_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("consultation_id", consultaId);
      if (identityStartError) {
        await supabaseAdmin.rpc("fail_official_credit_simulation", {
          p_consultation_id: consultaId,
          p_worker_id: workerId,
          p_execution_version: claimed.execution_version,
          p_error_code: "IDENTITY_LEDGER_WRITE_FAILED",
          p_user_message: "Não foi possível preparar a identificação do CPF ou CNPJ.",
          p_ambiguous_charge: false,
          p_provider_http_status: null,
          p_charge_confirmed: false,
        });
        return json({ ok: false, error: "Não foi possível preparar a identificação do cliente." });
      }
      await supabaseAdmin
        .from("consultas_credito")
        .update({ automation_step: "consultando_cadastro", heartbeat_at: new Date().toISOString() })
        .eq("id", consultaId)
        .eq("worker_id", workerId)
        .eq("execution_version", claimed.execution_version);

      const failIdentity = async ({
        errorCode,
        message,
        ambiguousCharge,
        providerHttpStatus,
        billed,
        safeResponse,
        providerExternalId,
      }: {
        errorCode: string;
        message: string;
        ambiguousCharge: boolean;
        providerHttpStatus: number | null;
        billed: boolean;
        safeResponse?: Record<string, unknown> | null;
        providerExternalId?: string | null;
      }) => {
        await supabaseAdmin
          .from("directd_credit_requests")
          .update({
            identity_status: ambiguousCharge
              ? "requires_verification"
              : billed
                ? "failed_billed"
                : "failed_no_charge",
            identity_provider_http_status: providerHttpStatus,
            identity_provider_consulta_uid: providerExternalId ?? null,
            identity_billed_cents: billed ? identityCostCents : null,
            identity_error_code: errorCode,
            identity_response: safeResponse ?? null,
            identity_completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("consultation_id", consultaId);
        await supabaseAdmin.rpc("fail_official_credit_simulation", {
          p_consultation_id: consultaId,
          p_worker_id: workerId,
          p_execution_version: claimed.execution_version,
          p_error_code: errorCode,
          p_user_message: message,
          p_ambiguous_charge: ambiguousCharge,
          p_provider_http_status: providerHttpStatus,
          // Este campo registra somente a cobrança da API de Score. A cobrança
          // cadastral é auditada separadamente nas colunas identity_*.
          p_charge_confirmed: false,
        });
        return json({ ok: false, error: message });
      };

      const identityUrl = new URL(
        document.length === 11 ? DIRECTD_PF_IDENTITY_URL : DIRECTD_PJ_IDENTITY_URL,
      );
      identityUrl.searchParams.set("TOKEN", directDToken);
      identityUrl.searchParams.set(document.length === 11 ? "CPF" : "CNPJ", document);

      const identityController = new AbortController();
      const identityTimeout = setTimeout(() => identityController.abort(), REQUEST_TIMEOUT_MS);
      let identityResponse: Response;
      try {
        identityResponse = await fetch(identityUrl, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: identityController.signal,
        });
      } catch (error) {
        return await failIdentity({
          errorCode:
            error instanceof DOMException && error.name === "AbortError"
              ? "DIRECTD_IDENTITY_TIMEOUT"
              : "DIRECTD_IDENTITY_NETWORK_ERROR",
          message:
            "A identificação oficial ficou inconclusiva. O suporte precisa conferir antes de um novo envio.",
          ambiguousCharge: true,
          providerHttpStatus: null,
          billed: false,
        });
      } finally {
        clearTimeout(identityTimeout);
      }

      const identityResponseText = await identityResponse.text();
      const parsedIdentity = safeJson(identityResponseText) as DirectDIdentityResponse | null;
      const safeIdentityResponse = parsedIdentity
        ? sanitizeDirectDIdentityResponse(parsedIdentity, document.length)
        : null;
      const identityProviderExternalId = parsedIdentity?.metaDados?.consultaUid?.trim() || null;

      if (identityResponse.status === 201 || identityResponse.status === 202) {
        return await failIdentity({
          errorCode: "DIRECTD_IDENTITY_ASYNC_PENDING",
          message:
            "A identificação foi aceita de forma assíncrona e precisa de conferência antes de continuar.",
          ambiguousCharge: true,
          providerHttpStatus: identityResponse.status,
          billed: false,
          safeResponse: safeIdentityResponse,
          providerExternalId: identityProviderExternalId,
        });
      }

      if (!identityResponse.ok || !parsedIdentity) {
        const safeToRetry = [400, 401, 403, 404, 503].includes(identityResponse.status);
        return await failIdentity({
          errorCode: `DIRECTD_IDENTITY_HTTP_${identityResponse.status}`,
          message:
            identityResponse.status === 403
              ? "Saldo indisponível na Direct Data. Recarregue a conta antes de tentar novamente."
              : "A API oficial não conseguiu identificar o CPF ou CNPJ.",
          ambiguousCharge: !safeToRetry,
          providerHttpStatus: identityResponse.status,
          billed: false,
          safeResponse: safeIdentityResponse,
          providerExternalId: identityProviderExternalId,
        });
      }

      if (isDirectDIdentityNotFound(parsedIdentity)) {
        const documentLabel = document.length === 14 ? "CNPJ" : "CPF";
        return await failIdentity({
          errorCode: "DIRECTD_IDENTITY_NOT_FOUND",
          message: `${documentLabel} não localizado na base cadastral. Confira o documento antes de tentar novamente.`,
          ambiguousCharge: false,
          providerHttpStatus: identityResponse.status,
          billed: true,
          safeResponse: safeIdentityResponse,
          providerExternalId: identityProviderExternalId,
        });
      }

      identity = normalizeDirectDIdentity(parsedIdentity, document.length);
      if (!identity) {
        return await failIdentity({
          errorCode: "DIRECTD_IDENTITY_NAME_MISSING",
          message:
            "A consulta cadastral foi concluída, mas não devolveu um nome válido. O suporte precisa conferir o retorno.",
          ambiguousCharge: true,
          providerHttpStatus: identityResponse.status,
          billed: true,
          safeResponse: safeIdentityResponse,
          providerExternalId: identityProviderExternalId,
        });
      }

      const { data: identitySaved, error: identitySaveError } = await supabaseAdmin.rpc(
        "save_official_credit_identity",
        {
          p_consultation_id: consultaId,
          p_worker_id: workerId,
          p_execution_version: claimed.execution_version,
          p_customer_name: identity.customerName,
          p_birth_date: identity.birthDate,
          p_provider_external_id: identity.providerExternalId,
          p_sanitized_response: safeIdentityResponse,
          p_provider_http_status: identityResponse.status,
        },
      );
      if (identitySaveError || !identitySaved) {
        return await failIdentity({
          errorCode: "DIRECTD_IDENTITY_PERSISTENCE_FAILED",
          message:
            "A identificação foi concluída, mas não pôde ser salva. O suporte precisa conferir antes de continuar.",
          ambiguousCharge: true,
          providerHttpStatus: identityResponse.status,
          billed: true,
          safeResponse: safeIdentityResponse,
          providerExternalId: identity.providerExternalId,
        });
      }
    }

    if (!identity) {
      await supabaseAdmin.rpc("fail_official_credit_simulation", {
        p_consultation_id: consultaId,
        p_worker_id: workerId,
        p_execution_version: claimed.execution_version,
        p_error_code: "DIRECTD_IDENTITY_UNAVAILABLE",
        p_user_message: "Não foi possível confirmar a identidade do CPF ou CNPJ.",
        p_ambiguous_charge: true,
        p_provider_http_status: null,
        p_charge_confirmed: false,
      });
      return json({ ok: false, error: "Não foi possível confirmar a identidade do cliente." });
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
        customerNameSource: "directd_cadastro",
        identityLookupBilledCents: identityCostCents,
        scoreBilledCents: 198,
        billedCents: 198 + identityCostCents,
      },
    });

    return json({
      ok: true,
      resultado: {
        status: result.decision,
        faixaScore: result.faixaScore,
        score: result.score,
        nome: identity.customerName,
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
