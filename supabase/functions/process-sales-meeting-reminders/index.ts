import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { escapeEmailHtml, renderNoxEmail } from "../_shared/email-branding.ts";
import { hasOversizedBody, safeEqualSecret } from "../_shared/http-security.ts";

type Appointment = {
  id: string;
  title: string;
  scheduled_at: string;
  duration_minutes: number;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  sdr_id: string;
  assigned_closer_id: string;
};

type Seller = {
  id: string;
  auth_user_id: string;
  full_name: string;
  email: string;
};

type DeliveryMinute = 0 | 5 | 30;
type DeliveryReport = {
  creationCandidates: number;
  reminderCandidates: number;
  creationSent: number;
  reminderSent: number;
  skipped: number;
  errors: number;
};

const MOTIVATIONAL_PHRASES = [
  "Cada conversa bem conduzida aproxima uma grande parceria.",
  "Confiança abre portas; presença e escuta fecham parcerias.",
  "Uma reunião preparada hoje pode virar uma parceria duradoura amanhã.",
  "Leve clareza, energia e propósito: a parceria começa na conexão.",
  "Grandes resultados nascem de conversas simples feitas com excelência.",
  "A oportunidade já está na agenda; agora é hora de transformar valor em parceria.",
  "Quem entende a necessidade do cliente encontra o caminho para o sim.",
  "Mais do que apresentar, conecte: boas parcerias começam com confiança.",
  "Entre preparado, escute com atenção e conduza com convicção.",
  "Toda reunião é uma nova chance de construir algo grande juntos.",
];

function phraseFor(appointmentId: string, offset: number) {
  const seed = [...appointmentId].reduce((total, character) => total + character.charCodeAt(0), 0);
  return MOTIVATIONAL_PHRASES[(seed + offset) % MOTIVATIONAL_PHRASES.length];
}

function meetingStartsAt(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "full",
    timeStyle: "short",
  });
}

function meetingBox(appointment: Appointment, startsAt: string) {
  return `<div style="border:1px solid #f0d44a;background:#fffbea;border-radius:14px;padding:18px">
    <strong>${escapeEmailHtml(appointment.title)}</strong><br />
    Contato: ${escapeEmailHtml(appointment.contact_name || "não informado")}<br />
    Data e horário: ${escapeEmailHtml(startsAt)}<br />
    Duração: ${appointment.duration_minutes || 60} minutos
  </div>`;
}

function motivationalBlock(phrase: string) {
  return `<div style="margin-top:18px;border-left:4px solid #ffd60a;background:#f8f8f8;border-radius:8px;padding:13px 15px;font-weight:700;color:#333">${escapeEmailHtml(phrase)}</div>`;
}

async function deliverEmail(
  admin: ReturnType<typeof createClient>,
  resendKey: string,
  from: string,
  appointment: Appointment,
  recipient: Seller,
  minutesBefore: DeliveryMinute,
  subject: string,
  html: string,
  report: DeliveryReport,
) {
  const { data: existing } = await admin
    .from("seller_meeting_reminder_deliveries")
    .select("id,status,updated_at")
    .eq("appointment_id", appointment.id)
    .eq("recipient_user_id", recipient.auth_user_id)
    .eq("minutes_before", minutesBefore)
    .eq("scheduled_at", appointment.scheduled_at)
    .maybeSingle();

  if (existing?.status === "enviado") {
    report.skipped += 1;
    return true;
  }

  const pendingIsStale = existing?.status === "pendente"
    && Date.now() - new Date(existing.updated_at).getTime() > 2 * 60_000;
  if (existing?.status === "pendente" && !pendingIsStale) {
    report.skipped += 1;
    return false;
  }

  let deliveryId = existing?.id as string | undefined;
  if (deliveryId) {
    const { error } = await admin
      .from("seller_meeting_reminder_deliveries")
      .update({ status: "pendente", last_error: null, updated_at: new Date().toISOString() })
      .eq("id", deliveryId);
    if (error) {
      report.errors += 1;
      return false;
    }
  } else {
    const { data: inserted, error } = await admin
      .from("seller_meeting_reminder_deliveries")
      .insert({
        appointment_id: appointment.id,
        recipient_user_id: recipient.auth_user_id,
        minutes_before: minutesBefore,
        scheduled_at: appointment.scheduled_at,
        recipient_email: recipient.email,
        recipient_name: recipient.full_name,
        status: "pendente",
      })
      .select("id")
      .maybeSingle();
    if (error || !inserted) {
      report.skipped += 1;
      return false;
    }
    deliveryId = inserted.id;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [recipient.email], subject, html }),
    });
    if (!response.ok) throw new Error(`Resend ${response.status}: ${await response.text()}`);
    await admin
      .from("seller_meeting_reminder_deliveries")
      .update({
        status: "enviado",
        sent_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", deliveryId);
    if (minutesBefore === 0) report.creationSent += 1;
    else report.reminderSent += 1;
    return true;
  } catch (sendError) {
    await admin
      .from("seller_meeting_reminder_deliveries")
      .update({
        status: "erro",
        last_error: sendError instanceof Error
          ? sendError.message.slice(0, 1000)
          : "Falha desconhecida",
        updated_at: new Date().toISOString(),
      })
      .eq("id", deliveryId);
    report.errors += 1;
    return false;
  }
}

serve(async (request) => {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Método não permitido." }, { status: 405 });
  }
  if (hasOversizedBody(request, 16_384)) {
    return Response.json({ ok: false, error: "Payload muito grande." }, { status: 413 });
  }

  const expectedSecret = Deno.env.get("CRON_NOTIFICATIONS_SECRET") || "";
  if (!expectedSecret || !safeEqualSecret(request.headers.get("x-cron-secret") || "", expectedSecret)) {
    return Response.json({ ok: false, error: "Não autorizado." }, { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const resendKey = Deno.env.get("RESEND_API_KEY") || "";
  const from = Deno.env.get("RESEND_FROM_EMAIL") || "NOX Fiança <noreply@noxfianca.com>";
  if (!supabaseUrl || !serviceRoleKey || !resendKey) {
    return Response.json({ ok: false, error: "Configuração de envio incompleta." }, { status: 500 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const now = new Date();
  const horizon = new Date(now.getTime() + 31 * 60_000);
  const fields = "id,title,scheduled_at,duration_minutes,contact_name,contact_email,contact_phone,sdr_id,assigned_closer_id";

  const [creationResult, reminderResult] = await Promise.all([
    admin
      .from("seller_appointments")
      .select(fields)
      .eq("source", "sdr_handoff")
      .in("status", ["agendado", "confirmado", "remarcado"])
      .gt("scheduled_at", now.toISOString())
      .is("creation_notified_at", null)
      .not("sdr_id", "is", null)
      .not("assigned_closer_id", "is", null)
      .order("scheduled_at", { ascending: true })
      .limit(100),
    admin
      .from("seller_appointments")
      .select(fields)
      .eq("source", "sdr_handoff")
      .in("status", ["agendado", "confirmado", "remarcado"])
      .gt("scheduled_at", now.toISOString())
      .lte("scheduled_at", horizon.toISOString())
      .not("sdr_id", "is", null)
      .not("assigned_closer_id", "is", null),
  ]);

  if (creationResult.error || reminderResult.error) {
    return Response.json({
      ok: false,
      error: creationResult.error?.message || reminderResult.error?.message,
    }, { status: 500 });
  }

  const creationAppointments = (creationResult.data || []) as Appointment[];
  const reminderAppointments = (reminderResult.data || []) as Appointment[];
  const allAppointments = [...creationAppointments, ...reminderAppointments];
  const sellerIds = [...new Set(allAppointments.flatMap((item) => [item.sdr_id, item.assigned_closer_id]))];
  const { data: sellersData, error: sellersError } = sellerIds.length
    ? await admin.from("internal_users").select("id,auth_user_id,full_name,email").in("id", sellerIds)
    : { data: [] as Seller[], error: null };
  if (sellersError) {
    return Response.json({ ok: false, error: sellersError.message }, { status: 500 });
  }
  const sellers = new Map(((sellersData || []) as Seller[]).map((seller) => [seller.id, seller]));
  const report: DeliveryReport = {
    creationCandidates: creationAppointments.length,
    reminderCandidates: reminderAppointments.length,
    creationSent: 0,
    reminderSent: 0,
    skipped: 0,
    errors: 0,
  };

  for (const appointment of creationAppointments) {
    const sdr = sellers.get(appointment.sdr_id);
    const closer = sellers.get(appointment.assigned_closer_id);
    if (!sdr?.email || !sdr.auth_user_id || !closer?.email || !closer.auth_user_id) {
      report.errors += 1;
      continue;
    }

    const startsAt = meetingStartsAt(appointment.scheduled_at);
    const sdrHtml = renderNoxEmail(
      `<p>Olá, <strong>${escapeEmailHtml(sdr.full_name)}</strong>.</p>
       <h1 style="font-size:22px;margin:8px 0 14px">Parabéns pelo agendamento!</h1>
       <p>A reunião foi confirmada e entrou automaticamente na agenda de <strong>${escapeEmailHtml(closer.full_name)}</strong>.</p>
       ${meetingBox(appointment, startsAt)}
       ${motivationalBlock(phraseFor(appointment.id, 0))}
       <p style="margin-top:18px"><a href="https://noxfianca.com/vendedor/agenda" style="display:inline-block;background:#171717;color:#ffd60a;text-decoration:none;border-radius:10px;padding:12px 18px;font-weight:700">Abrir minha agenda</a></p>`,
      `Parabéns! A reunião com ${appointment.contact_name || "o novo contato"} foi agendada.`,
    );
    const closerHtml = renderNoxEmail(
      `<p>Olá, <strong>${escapeEmailHtml(closer.full_name)}</strong>.</p>
       <h1 style="font-size:22px;margin:8px 0 14px">Nova reunião na sua agenda!</h1>
       <p><strong>${escapeEmailHtml(sdr.full_name)}</strong> qualificou e agendou uma nova oportunidade para você.</p>
       ${meetingBox(appointment, startsAt)}
       ${motivationalBlock(phraseFor(appointment.id, 1))}
       <p style="margin-top:18px"><a href="https://noxfianca.com/vendedor/agenda" style="display:inline-block;background:#171717;color:#ffd60a;text-decoration:none;border-radius:10px;padding:12px 18px;font-weight:700">Ver nova reunião</a></p>`,
      "Uma nova reunião entrou na sua agenda NOX Fiança.",
    );

    const sdrDelivered = await deliverEmail(
      admin, resendKey, from, appointment, sdr, 0,
      "Parabéns pelo agendamento — NOX Fiança", sdrHtml, report,
    );
    const closerDelivered = await deliverEmail(
      admin, resendKey, from, appointment, closer, 0,
      "Nova reunião na sua agenda — NOX Fiança", closerHtml, report,
    );

    if (sdrDelivered && closerDelivered) {
      await admin
        .from("seller_appointments")
        .update({ creation_notified_at: new Date().toISOString() })
        .eq("id", appointment.id)
        .eq("scheduled_at", appointment.scheduled_at)
        .is("creation_notified_at", null);
    }
  }

  for (const appointment of reminderAppointments) {
    const minutesUntil = (new Date(appointment.scheduled_at).getTime() - now.getTime()) / 60_000;
    const reminder = [30, 5].find(
      (minutes) => minutesUntil <= minutes && minutesUntil > minutes - 2,
    ) as 5 | 30 | undefined;
    if (!reminder) continue;

    const recipients = [
      sellers.get(appointment.sdr_id),
      sellers.get(appointment.assigned_closer_id),
    ].filter((seller): seller is Seller => Boolean(seller?.email && seller.auth_user_id));

    for (const recipient of recipients) {
      const isCloser = recipient.id === appointment.assigned_closer_id;
      const phrase = phraseFor(appointment.id, (reminder === 30 ? 2 : 4) + (isCloser ? 1 : 0));
      const startsAt = meetingStartsAt(appointment.scheduled_at);
      const html = renderNoxEmail(
        `<p>Olá, <strong>${escapeEmailHtml(recipient.full_name)}</strong>.</p>
         <h1 style="font-size:22px;margin:8px 0 14px">Sua reunião começa em ${reminder} minutos</h1>
         ${meetingBox(appointment, startsAt)}
         ${motivationalBlock(phrase)}
         <p style="margin-top:18px">Acesse a Minha Agenda para consultar os dados, remarcar ou cancelar.</p>
         <p><a href="https://noxfianca.com/vendedor/agenda" style="display:inline-block;background:#171717;color:#ffd60a;text-decoration:none;border-radius:10px;padding:12px 18px;font-weight:700">Abrir minha agenda</a></p>`,
        `${appointment.title} começa em ${reminder} minutos.`,
      );
      await deliverEmail(
        admin, resendKey, from, appointment, recipient, reminder,
        `Reunião em ${reminder} minutos — NOX Fiança`, html, report,
      );
    }
  }

  return Response.json({ ok: true, report });
});
