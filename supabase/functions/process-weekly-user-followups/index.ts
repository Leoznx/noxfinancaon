import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { buildWeeklyFollowupInteractiveContent } from "../_shared/weekly-user-followups.ts";
import {
  sendZApiButtonActions,
  getZApiConnectionStatus,
  normalizeWhatsappPhone,
} from "../_shared/zapi.ts";

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
  return {
    date,
    weekday,
    hour,
    minute,
    insideBusinessWindow: weekday >= 1 && weekday <= 5 && hour >= 9 && hour < 18,
  };
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
    const interactive = buildWeeklyFollowupInteractiveContent({ name: "Leo", variant: 0 });
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
        message: `${interactive.message}\n\n${interactive.footer}`,
      });
    }
    const result = await sendZApiButtonActions({
      to: testPhone,
      ...interactive,
    });
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
    const interactive = buildWeeklyFollowupInteractiveContent({
      name: row.recipient_name,
      variant: row.message_variant,
    });
    const result = await sendZApiButtonActions({ to: phone, ...interactive });
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
