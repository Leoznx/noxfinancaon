import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

type RunBody = {
  dryRun?: boolean;
  testPhone?: string;
};

type FollowupRow = {
  id: string;
  recipient_name: string;
  recipient_phone: string;
  message_variant: number;
  attempts: number;
};

const WEEKLY_FOLLOWUP_MESSAGES = [
  "E aí, {nome}! 😊 Tá conseguindo fazer as simulações certinho? Se precisar de ajuda, chama a gente por aqui! 💛",
  "Oi, {nome}! Tudo bem por aí? 👋 Conseguiu fazer suas simulações direitinho? A equipe NOX está por aqui se precisar. 😊",
  "Passando pra saber como estão as simulações, {nome}! 🚀 Tá conseguindo fazer tudo certinho? Conta com a NOX! 💛",
  "E aí, {nome}! 😄 Como estão as simulações esta semana? Se surgir qualquer dúvida, pode falar com a gente! 🤝",
  "Oi, {nome}! Só passando pra acompanhar você. 💛 As simulações estão saindo certinho? Estamos aqui pra ajudar! 😊",
  "Fala, {nome}! 👋 Tá tudo certo com suas simulações? Se travar em alguma etapa, chama a NOX que a gente ajuda. 🚀",
  "Como você está, {nome}? 😊 Conseguiu avançar nas simulações? Pode contar com a gente pra deixar tudo mais simples! 💛",
  "E aí, {nome}! Passando com aquele lembrete amigo. 😄 Tá conseguindo simular certinho? Qualquer coisa, chama a NOX! 🤝",
] as const;

function jsonResponse(request: Request, body: Record<string, unknown>, status = 200) {
  const origin = request.headers.get("origin");
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      Vary: "Origin",
      ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    },
  });
}

function supabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function hasOversizedBody(request: Request, maxBytes: number) {
  const length = Number(request.headers.get("content-length") || "0");
  return Number.isFinite(length) && length > maxBytes;
}

function safeEqualSecret(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a[index] ^ b[index];
  return result === 0;
}

function normalizeWhatsappPhone(value: string | null | undefined) {
  let digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (!digits.startsWith("55")) digits = `55${digits}`;
  return digits.length >= 12 && digits.length <= 13 ? digits : "";
}

function zApiCredentials() {
  const instanceId = Deno.env.get("ZAPI_INSTANCE_ID")?.trim() || "";
  const instanceToken = Deno.env.get("ZAPI_INSTANCE_TOKEN")?.trim() || "";
  const clientToken = Deno.env.get("ZAPI_CLIENT_TOKEN")?.trim() || "";
  const valid = /^[A-Za-z0-9_-]+$/;
  return valid.test(instanceId) && valid.test(instanceToken)
    ? { instanceId, instanceToken, clientToken }
    : null;
}

async function zApiFetch(url: string, init: RequestInit, clientToken: string) {
  const headers = new Headers(init.headers);
  if (clientToken) headers.set("Client-Token", clientToken);
  let response = await fetch(url, { ...init, headers });
  if (!clientToken || response.status !== 403) return response;
  const body = await response.clone().text().catch(() => "");
  if (!/client-?token[^\n]*not allowed/i.test(body)) return response;
  headers.delete("Client-Token");
  response = await fetch(url, { ...init, headers });
  return response;
}

function providerReason(body: unknown, status: number) {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const code = String(
    (typeof body === "string" ? body : "") || record.error || record.message || record.code || `http_${status}`,
  )
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80);
  return `provider_http_${status}${code ? `_${code}` : ""}`;
}

async function getZApiConnectionStatus() {
  const auth = zApiCredentials();
  if (!auth) return { configured: false, connected: false, smartphoneConnected: false };
  try {
    const response = await zApiFetch(
      `https://api.z-api.io/instances/${auth.instanceId}/token/${auth.instanceToken}/status`,
      { method: "GET", headers: { "Content-Type": "application/json" } },
      auth.clientToken,
    );
    if (!response.ok) {
      const rawBody = await response.text().catch(() => "");
      let body: unknown = rawBody;
      try {
        body = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        // Mantém o texto do provedor apenas para gerar um diagnóstico seguro.
      }
      return {
        configured: true,
        connected: false,
        smartphoneConnected: false,
        status: response.status,
        reason: providerReason(body, response.status),
      };
    }
    const data = await response.json();
    return {
      configured: true,
      connected: data?.connected === true,
      smartphoneConnected: data?.smartphoneConnected === true,
    };
  } catch {
    return {
      configured: true,
      connected: false,
      smartphoneConnected: false,
      reason: "provider_unavailable",
    };
  }
}

async function sendZApiText(params: { to: string; message: string }) {
  const auth = zApiCredentials();
  if (!auth) return { sent: false, reason: "not_configured" };
  const phone = normalizeWhatsappPhone(params.to);
  if (!phone) return { sent: false, reason: "invalid_phone" };
  try {
    const response = await zApiFetch(
      `https://api.z-api.io/instances/${auth.instanceId}/token/${auth.instanceToken}/send-text`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, message: params.message }),
      },
      auth.clientToken,
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { sent: false, reason: providerReason(data, response.status) };
    const providerMessageId = data?.messageId || data?.zaapId || data?.id;
    return providerMessageId
      ? { sent: true, providerMessageId: String(providerMessageId) }
      : { sent: false, reason: "provider_invalid_response" };
  } catch {
    return { sent: false, reason: "provider_unavailable" };
  }
}

function buildWeeklyFollowupMessage(params: { name?: string | null; variant?: number | null }) {
  const name = String(params.name || "").trim().split(/\s+/)[0].slice(0, 60) || "tudo bem";
  const index = Math.abs(Math.trunc(Number(params.variant) || 0)) % WEEKLY_FOLLOWUP_MESSAGES.length;
  return WEEKLY_FOLLOWUP_MESSAGES[index].replace("{nome}", name) +
    "\n\nSe preferir não receber estes lembretes, responda SAIR.";
}

function saoPauloBusinessClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  return { date, weekday, hour, minute, insideBusinessWindow: weekday >= 1 && weekday <= 5 && hour >= 9 && hour < 18 };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(request, { ok: false, error: "method_not_allowed" }, 405);
  }
  if (hasOversizedBody(request, 8_192)) {
    return jsonResponse(request, { ok: false, error: "payload_too_large" }, 413);
  }

  const expectedSecret = Deno.env.get("CRON_NOTIFICATIONS_SECRET")?.trim() || "";
  if (
    !expectedSecret ||
    !safeEqualSecret(request.headers.get("x-cron-secret") || "", expectedSecret)
  ) {
    return jsonResponse(request, { ok: false, error: "unauthorized" }, 401);
  }

  const body = (await request.json().catch(() => ({}))) as RunBody;
  const admin = supabaseAdmin();
  const { data: settings, error: settingsError } = await admin
    .from("weekly_whatsapp_followup_settings")
    .select("enabled, dispatch_enabled, batch_size")
    .eq("id", true)
    .maybeSingle();
  if (settingsError) {
    console.error("[weekly-followup] settings unavailable", settingsError.message);
    return jsonResponse(request, { ok: false, error: "settings_unavailable" }, 503);
  }
  if (settings?.enabled === false) {
    return jsonResponse(request, { ok: true, skipped: "automation_disabled" });
  }

  const testPhone = normalizeWhatsappPhone(body.testPhone);
  const dryRun = body.dryRun === true || settings?.dispatch_enabled !== true;
  const now = new Date();
  const clock = saoPauloBusinessClock(now);

  if (body.testPhone && !testPhone) {
    return jsonResponse(request, { ok: false, error: "invalid_test_phone" }, 400);
  }

  const zapi = await getZApiConnectionStatus().catch(() => ({
    configured: true,
    connected: false,
    smartphoneConnected: false,
    reason: "provider_unavailable",
  }));
  if (!zapi.configured || !zapi.connected || !zapi.smartphoneConnected) {
    return jsonResponse(request, { ok: false, error: "zapi_not_connected", zapi }, 503);
  }

  if (testPhone) {
    const message = buildWeeklyFollowupMessage({ name: "Leo", variant: 0 });
    const weekStart = startOfSaoPauloWeek(clock.date);
    const { data: audit, error: auditError } = await admin
      .from("weekly_whatsapp_followups")
      .insert({
        week_start: weekStart,
        recipient_name: "Teste da automação NOX",
        recipient_role: "test",
        recipient_phone: testPhone,
        message_variant: 0,
        scheduled_at: now.toISOString(),
        status: dryRun ? "skipped" : "processing",
        attempts: dryRun ? 0 : 1,
        is_test: true,
      })
      .select("id")
      .maybeSingle();
    if (auditError || !audit?.id) {
      console.error("[weekly-followup] test audit unavailable", auditError?.message);
      return jsonResponse(request, { ok: false, error: "audit_unavailable" }, 503);
    }
    if (dryRun) {
      return jsonResponse(request, {
        ok: true,
        test: true,
        dryRun: true,
        phone: maskPhone(testPhone),
        message,
      });
    }
    const result = await sendZApiText({ to: testPhone, message });
    await admin
      .from("weekly_whatsapp_followups")
      .update(
        result.sent
          ? {
              status: "queued",
              provider_message_id: result.providerMessageId,
              sent_at: now.toISOString(),
              last_error: null,
            }
          : {
              status: "failed",
              last_error: result.reason || "send_failed",
              next_attempt_at: null,
            },
      )
      .eq("id", audit.id);
    return jsonResponse(
      request,
      {
        ok: result.sent,
        test: true,
        phone: maskPhone(testPhone),
        providerMessageId: result.providerMessageId || null,
        error: result.sent ? null : result.reason || "send_failed",
      },
      result.sent ? 200 : 502,
    );
  }

  if (!clock.insideBusinessWindow) {
    return jsonResponse(request, {
      ok: true,
      skipped: "outside_business_window",
      local: `${clock.date} ${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`,
    });
  }

  const { data: planned, error: planError } = await admin.rpc("plan_weekly_whatsapp_followups", {
    p_now: now.toISOString(),
  });
  if (planError) {
    console.error("[weekly-followup] planner failed", planError.message);
    return jsonResponse(request, { ok: false, error: "planner_failed" }, 500);
  }
  if (dryRun) {
    return jsonResponse(request, {
      ok: true,
      dryRun: true,
      planned: Number(planned || 0),
      localDate: clock.date,
    });
  }

  const batchSize = Math.min(Math.max(Number(settings?.batch_size || 20), 1), 50);
  const { data: rows, error: claimError } = await admin.rpc("claim_due_weekly_whatsapp_followups", {
    p_limit: batchSize,
    p_now: now.toISOString(),
  });
  if (claimError) {
    console.error("[weekly-followup] claim failed", claimError.message);
    return jsonResponse(request, { ok: false, error: "claim_failed" }, 500);
  }

  const report = {
    planned: Number(planned || 0),
    claimed: (rows || []).length,
    queued: 0,
    failed: 0,
    skipped: 0,
  };
  for (const row of (rows || []) as FollowupRow[]) {
    const phone = normalizeWhatsappPhone(row.recipient_phone);
    if (!phone) {
      report.skipped += 1;
      await admin
        .from("weekly_whatsapp_followups")
        .update({ status: "skipped", last_error: "invalid_phone" })
        .eq("id", row.id);
      continue;
    }
    const message = buildWeeklyFollowupMessage({
      name: row.recipient_name,
      variant: row.message_variant,
    });
    const result = await sendZApiText({ to: phone, message });
    if (result.sent) {
      report.queued += 1;
      await admin
        .from("weekly_whatsapp_followups")
        .update({
          status: "queued",
          provider_message_id: result.providerMessageId,
          sent_at: new Date().toISOString(),
          last_error: null,
          next_attempt_at: null,
        })
        .eq("id", row.id);
    } else {
      report.failed += 1;
      const terminal = Number(row.attempts || 0) >= 3;
      await admin
        .from("weekly_whatsapp_followups")
        .update({
          status: "failed",
          last_error: result.reason || "send_failed",
          next_attempt_at: terminal
            ? null
            : new Date(Date.now() + Math.max(1, row.attempts) * 15 * 60_000).toISOString(),
        })
        .eq("id", row.id);
    }
  }

  return jsonResponse(request, { ok: true, localDate: clock.date, report });
});

function startOfSaoPauloWeek(date: string) {
  const parsed = new Date(`${date}T12:00:00Z`);
  const weekday = parsed.getUTCDay() || 7;
  parsed.setUTCDate(parsed.getUTCDate() - weekday + 1);
  return parsed.toISOString().slice(0, 10);
}

function maskPhone(phone: string) {
  return phone.length > 4 ? `${"*".repeat(phone.length - 4)}${phone.slice(-4)}` : "****";
}
