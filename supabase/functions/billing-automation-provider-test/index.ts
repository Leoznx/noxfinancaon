import {
  corsHeaders,
  jsonResponse,
  requireUser,
  supabaseAdmin,
} from "../_shared/asaas.ts";
import {
  getZApiConnectionStatus,
  normalizeWhatsappPhone,
  sendZApiText,
  updateZApiContractWebhooks,
} from "../_shared/zapi.ts";

async function getD4SignConnectionStatus() {
  const token = Deno.env.get("D4SIGN_TOKEN_API")?.trim() || "";
  const cryptKey = Deno.env.get("D4SIGN_CRYPT_KEY")?.trim() || "";
  const safeUuid = Deno.env.get("D4SIGN_SAFE_UUID")?.trim() || "";
  if (!token || !cryptKey || !safeUuid) {
    return {
      configured: false,
      connected: false,
      safeAccessible: false,
      reason: "not_configured",
    };
  }
  const base = (Deno.env.get("D4SIGN_API_BASE_URL") ||
    "https://secure.d4sign.com.br/api/v1").replace(/\/$/, "");
  const url = new URL(
    `${base}/documents/${encodeURIComponent(safeUuid)}/safe`,
  );
  url.searchParams.set("pg", "1");
  url.searchParams.set("tokenAPI", token);
  url.searchParams.set("cryptKey", cryptKey);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      return {
        configured: true,
        connected: false,
        safeAccessible: false,
        reason: `provider_http_${response.status}`,
      };
    }
    return { configured: true, connected: true, safeAccessible: true };
  } catch {
    return {
      configured: true,
      connected: false,
      safeAccessible: false,
      reason: "provider_unavailable",
    };
  }
}

function safeEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a[index] ^ b[index];
  }
  return result === 0;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(request) });
  }
  if (request.method !== "POST") {
    return jsonResponse(
      request,
      { ok: false, error: "method_not_allowed" },
      405,
    );
  }

  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const bearer =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const internalKey = request.headers.get("x-service-role-key") || "";
  const expectedTestToken = Deno.env.get("BILLING_TEST_TOKEN") || "";
  const receivedTestToken = request.headers.get("x-billing-test-token") || "";
  const internal = (!!serviceRole &&
    (safeEqual(bearer, serviceRole) ||
      safeEqual(internalKey, serviceRole))) ||
    (!!expectedTestToken && safeEqual(receivedTestToken, expectedTestToken));
  if (!internal) {
    try {
      const { user } = await requireUser(request);
      const admin = supabaseAdmin();
      const [{ data: profile }, { data: internalUser }] = await Promise.all([
        admin.from("profiles").select("role").eq("id", user.id).maybeSingle(),
        admin
          .from("internal_users")
          .select("role, status")
          .eq("auth_user_id", user.id)
          .maybeSingle(),
      ]);
      const allowedProfile = ["admin", "financeiro"].includes(
        String(profile?.role || ""),
      );
      const allowedInternal =
        ["active", "ativo"].includes(String(internalUser?.status || "")) &&
        ["admin_master", "financeiro"].includes(
          String(internalUser?.role || ""),
        );
      if (!allowedProfile && !allowedInternal) {
        return jsonResponse(request, { ok: false, error: "forbidden" }, 403);
      }
    } catch {
      return jsonResponse(request, { ok: false, error: "unauthorized" }, 401);
    }
  }

  const body = await request.json().catch(() => null);
  if (body?.action === "status") {
    const [zapi, d4sign] = await Promise.all([
      getZApiConnectionStatus(),
      getD4SignConnectionStatus(),
    ]);
    return jsonResponse(request, {
      ok: zapi.connected === true &&
        zapi.smartphoneConnected === true &&
        d4sign.connected === true &&
        d4sign.safeAccessible === true,
      zapi,
      d4sign,
    });
  }
  if (
    ["configure_received_webhook", "configure_contract_webhooks"].includes(
      String(body?.action || ""),
    ) &&
    ["CONFIGURE_RECEIVED_WEBHOOK", "CONFIGURE_CONTRACT_WEBHOOKS"].includes(
      String(body?.confirmation || ""),
    )
  ) {
    const baseUrl = Deno.env.get("SUPABASE_URL") || "";
    const webhookSecret = Deno.env.get("ZAPI_WEBHOOK_SECRET") || "";
    if (!baseUrl || !webhookSecret) {
      return jsonResponse(
        request,
        {
          ok: false,
          error: "webhook_not_configured",
        },
        503,
      );
    }
    const result = await updateZApiContractWebhooks(
      `${baseUrl}/functions/v1/zapi-webhook?secret=${
        encodeURIComponent(webhookSecret)
      }`,
    );
    if (!result.updated) {
      return jsonResponse(
        request,
        { ok: false, error: result.reason || "webhook_update_failed" },
        502,
      );
    }
    return jsonResponse(request, {
      ok: true,
      configured: true,
      webhooks: result.webhooks,
    });
  }
  if (
    body?.action === "run_billing_dry_run" &&
    body?.confirmation === "RUN_BILLING_DRY_RUN"
  ) {
    const baseUrl = Deno.env.get("SUPABASE_URL") || "";
    const cronSecret = Deno.env.get("CRON_NOTIFICATIONS_SECRET") || "";
    if (!baseUrl || !cronSecret) {
      return jsonResponse(
        request,
        {
          ok: false,
          error: "scheduler_not_configured",
        },
        503,
      );
    }
    const response = await fetch(
      `${baseUrl}/functions/v1/process-scheduled-invoice-notifications`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cron-secret": cronSecret,
        },
        body: JSON.stringify({ dryRun: true }),
      },
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.ok !== true) {
      return jsonResponse(
        request,
        {
          ok: false,
          error: "scheduler_dry_run_failed",
        },
        502,
      );
    }
    return jsonResponse(request, { ok: true, report: result.report });
  }
  const phone = normalizeWhatsappPhone(body?.phone);
  if (!phone || body?.confirmation !== "SEND_PROVIDER_TEST") {
    return jsonResponse(
      request,
      { ok: false, error: "invalid_test_request" },
      400,
    );
  }

  const status = await getZApiConnectionStatus();
  if (!status.configured || !status.connected || !status.smartphoneConnected) {
    return jsonResponse(
      request,
      {
        ok: false,
        error: "zapi_not_connected",
        status,
      },
      503,
    );
  }
  const result = await sendZApiText({
    to: phone,
    message:
      "Teste de homologação NOX Fiança: a automação financeira via WhatsApp está conectada. Nenhuma cobrança foi criada por esta mensagem.",
  });
  if (!result.sent) {
    return jsonResponse(
      request,
      {
        ok: false,
        error: result.reason || "send_failed",
      },
      502,
    );
  }
  return jsonResponse(request, {
    ok: true,
    sent: true,
    providerMessageId: result.providerMessageId,
  });
});
