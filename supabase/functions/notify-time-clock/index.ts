// deno-lint-ignore-file no-import-prefix
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";
import { Resend } from "https://esm.sh/resend@3.2.0";
import { escapeEmailHtml, renderNoxEmail } from "../_shared/email-branding.ts";
import { corsHeaders, hasOversizedBody, rejectDisallowedOrigin } from "../_shared/http-security.ts";

const punchLabels: Record<string, string> = {
  entrada: "Entrada",
  inicio_intervalo: "Saída para almoço",
  fim_intervalo: "Retorno do almoço",
  saida: "Saída",
};

const classificationCopy: Record<string, { subject: string; title: string; color: string }> = {
  atrasado: {
    subject: "Registro de ponto com atraso",
    title: "Ponto registrado com atraso",
    color: "#B42318",
  },
  adiantado: {
    subject: "Parabéns pelo empenho no registro de ponto",
    title: "Parabéns pelo empenho!",
    color: "#137A45",
  },
  saida_antecipada: {
    subject: "Registro de saída antecipada",
    title: "Saída antecipada registrada",
    color: "#B54708",
  },
  hora_extra: {
    subject: "Tempo adicional registrado no ponto",
    title: "Tempo adicional registrado",
    color: "#8A6500",
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  const response = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  const rejected = rejectDisallowedOrigin(req);
  if (rejected) return rejected;
  if (req.method !== "POST") return response({ ok: false, error: "Método não permitido." }, 405);
  if (hasOversizedBody(req, 16_384))
    return response({ ok: false, error: "Payload muito grande." }, 413);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey || !resendKey) {
    return response({ ok: false, error: "Configuração de e-mail indisponível." }, 500);
  }

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return response({ ok: false, error: "Não autenticado." }, 401);

  let punchId = "";
  try {
    punchId = String((await req.json())?.punchId ?? "").trim();
  } catch {
    return response({ ok: false, error: "Corpo da requisição inválido." }, 400);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(punchId)) {
    return response({ ok: false, error: "Registro de ponto inválido." }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const userId = authData?.user?.id;
  if (authError || !userId)
    return response({ ok: false, error: "Sessão inválida ou expirada." }, 401);

  const { data: punch, error: punchError } = await admin
    .from("time_clock_punches")
    .select(
      "id, auth_user_id, employee_id, work_date, punch_type, punched_at, expected_at, deviation_minutes, classification",
    )
    .eq("id", punchId)
    .maybeSingle();
  if (punchError || !punch)
    return response({ ok: false, error: "Registro de ponto não encontrado." }, 404);
  if (punch.auth_user_id !== userId)
    return response({ ok: false, error: "Sem acesso a este registro." }, 403);

  const copy = classificationCopy[punch.classification];
  if (!copy) return response({ ok: true, skipped: true, reason: "Registro dentro da tolerância." });

  const { data: existing } = await admin
    .from("time_clock_email_deliveries")
    .select("status, provider_message_id")
    .eq("punch_id", punchId)
    .maybeSingle();
  if (existing?.status === "enviado") {
    return response({ ok: true, alreadySent: true, id: existing.provider_message_id });
  }

  const { data: employee } = await admin
    .from("internal_users")
    .select("full_name, email")
    .eq("id", punch.employee_id)
    .maybeSingle();
  if (!employee?.email)
    return response({ ok: false, error: "E-mail do colaborador não cadastrado." }, 422);

  const timezone = "America/Sao_Paulo";
  const actual = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(punch.punched_at));
  const expected = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(punch.expected_at));
  const workDate = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    dateStyle: "full",
  }).format(new Date(`${punch.work_date}T12:00:00-03:00`));
  const minutes = Math.abs(Number(punch.deviation_minutes || 0));
  const name = employee.full_name || "Colaborador(a)";
  const detail =
    punch.classification === "adiantado"
      ? `Você registrou ${minutes} minuto(s) antes do horário previsto. Parabéns pelo empenho!`
      : punch.classification === "atrasado"
        ? `A marcação ocorreu ${minutes} minuto(s) após o horário previsto.`
        : punch.classification === "saida_antecipada"
          ? `A marcação ocorreu ${minutes} minuto(s) antes do horário previsto.`
          : `A marcação ocorreu ${minutes} minuto(s) após o horário previsto. O banco de horas será apurado ao completar as quatro marcações do dia.`;

  const html = renderNoxEmail(
    `
      <div style="display:inline-block;background:#FFF4BF;color:${copy.color};font-size:12px;font-weight:800;padding:7px 11px;border-radius:999px">CONTROLE DE PONTO</div>
      <h1 style="font-size:24px;line-height:1.25;margin:18px 0 10px">${escapeEmailHtml(copy.title)}</h1>
      <p>Olá, <strong>${escapeEmailHtml(name)}</strong>.</p>
      <p>${escapeEmailHtml(detail)}</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:22px 0;background:#FAFAFA;border:1px solid #E8E8E8;border-radius:14px">
        <tr><td style="padding:12px 16px;border-bottom:1px solid #E8E8E8"><strong>Marcação</strong></td><td style="padding:12px 16px;border-bottom:1px solid #E8E8E8">${escapeEmailHtml(punchLabels[punch.punch_type] || punch.punch_type)}</td></tr>
        <tr><td style="padding:12px 16px;border-bottom:1px solid #E8E8E8"><strong>Data</strong></td><td style="padding:12px 16px;border-bottom:1px solid #E8E8E8">${escapeEmailHtml(workDate)}</td></tr>
        <tr><td style="padding:12px 16px;border-bottom:1px solid #E8E8E8"><strong>Horário registrado</strong></td><td style="padding:12px 16px;border-bottom:1px solid #E8E8E8">${escapeEmailHtml(actual)}</td></tr>
        <tr><td style="padding:12px 16px"><strong>Horário previsto</strong></td><td style="padding:12px 16px">${escapeEmailHtml(expected)}</td></tr>
      </table>
      <p style="font-size:13px;color:#666">As marcações são preservadas com horário oficial do servidor. O saldo diário considera a tolerância legal e só é fechado após entrada, almoço, retorno e saída.</p>
      <p style="margin-top:24px"><a href="https://noxfianca.com/vendedor/ponto" style="display:inline-block;background:#171717;color:#FFD60A;text-decoration:none;font-weight:800;padding:13px 20px;border-radius:10px">Ver meu histórico</a></p>
    `,
    `${copy.title}: ${punchLabels[punch.punch_type] || "marcação"} às ${actual}.`,
  );

  const recipients = [employee.email];
  const adminEmail = (Deno.env.get("TIME_CLOCK_ADMIN_EMAIL") ?? "").trim();
  if (adminEmail && adminEmail.toLowerCase() !== employee.email.toLowerCase())
    recipients.push(adminEmail);

  const resend = new Resend(resendKey);
  const { data, error } = await resend.emails.send({
    from: Deno.env.get("RESEND_FROM_EMAIL") || "NOX FIANÇA <financeiro@noxfianca.com>",
    to: recipients,
    subject: `${copy.subject} — ${punchLabels[punch.punch_type] || "Ponto"}`,
    html,
  });

  await admin.from("time_clock_email_deliveries").upsert(
    {
      punch_id: punchId,
      recipient: recipients.join(","),
      provider_message_id: data?.id ?? null,
      status: error ? "falhou" : "enviado",
      error_message: error ? String(error.message || error) : null,
    },
    { onConflict: "punch_id" },
  );

  if (error) {
    console.error("[notify-time-clock] Resend", { punchId, error });
    return response(
      { ok: false, error: "O ponto foi salvo, mas o e-mail não pôde ser enviado." },
      502,
    );
  }
  return response({ ok: true, id: data?.id });
});
