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

serve(async (request) => {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Método não permitido." }, { status: 405 });
  }
  if (hasOversizedBody(request, 16_384))
    return Response.json({ ok: false, error: "Payload muito grande." }, { status: 413 });

  const expectedSecret = Deno.env.get("CRON_NOTIFICATIONS_SECRET") || "";
  if (
    !expectedSecret ||
    !safeEqualSecret(request.headers.get("x-cron-secret") || "", expectedSecret)
  ) {
    return Response.json({ ok: false, error: "Não autorizado." }, { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const resendKey = Deno.env.get("RESEND_API_KEY") || "";
  const from = Deno.env.get("RESEND_FROM_EMAIL") || "NOX Fiança <noreply@noxfianca.com>";
  if (!supabaseUrl || !serviceRoleKey || !resendKey) {
    return Response.json(
      { ok: false, error: "Configuração de envio incompleta." },
      { status: 500 },
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const now = new Date();
  const horizon = new Date(now.getTime() + 31 * 60_000);

  const { data, error } = await admin
    .from("seller_appointments")
    .select(
      "id,title,scheduled_at,duration_minutes,contact_name,contact_email,contact_phone,sdr_id,assigned_closer_id",
    )
    .eq("source", "sdr_handoff")
    .in("status", ["agendado", "confirmado", "remarcado"])
    .gt("scheduled_at", now.toISOString())
    .lte("scheduled_at", horizon.toISOString())
    .not("sdr_id", "is", null)
    .not("assigned_closer_id", "is", null);

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  const appointments = (data || []) as Appointment[];
  const sellerIds = [
    ...new Set(appointments.flatMap((item) => [item.sdr_id, item.assigned_closer_id])),
  ];
  const { data: sellersData } = sellerIds.length
    ? await admin
        .from("internal_users")
        .select("id,auth_user_id,full_name,email")
        .in("id", sellerIds)
    : { data: [] as Seller[] };
  const sellers = new Map(((sellersData || []) as Seller[]).map((seller) => [seller.id, seller]));

  const report = { candidates: appointments.length, sent: 0, skipped: 0, errors: 0 };

  for (const appointment of appointments) {
    const minutesUntil = (new Date(appointment.scheduled_at).getTime() - now.getTime()) / 60_000;
    const reminder = [30, 5].find(
      (minutes) => minutesUntil <= minutes && minutesUntil > minutes - 2,
    );
    if (!reminder) continue;

    const recipients = [
      sellers.get(appointment.sdr_id),
      sellers.get(appointment.assigned_closer_id),
    ].filter((seller): seller is Seller => Boolean(seller?.email && seller.auth_user_id));

    for (const recipient of recipients) {
      const delivery = {
        appointment_id: appointment.id,
        recipient_user_id: recipient.auth_user_id,
        minutes_before: reminder,
        scheduled_at: appointment.scheduled_at,
        recipient_email: recipient.email,
        recipient_name: recipient.full_name,
        status: "pendente",
      };
      const { data: existing } = await admin
        .from("seller_meeting_reminder_deliveries")
        .select("id,status")
        .eq("appointment_id", appointment.id)
        .eq("recipient_user_id", recipient.auth_user_id)
        .eq("minutes_before", reminder)
        .eq("scheduled_at", appointment.scheduled_at)
        .maybeSingle();
      let claimed: { id: string } | null = existing?.status === "erro" ? { id: existing.id } : null;
      if (existing && existing.status !== "erro") {
        report.skipped += 1;
        continue;
      }
      if (claimed) {
        await admin
          .from("seller_meeting_reminder_deliveries")
          .update({
            status: "pendente",
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", claimed.id);
      } else {
        const { data: inserted, error: claimError } = await admin
          .from("seller_meeting_reminder_deliveries")
          .insert(delivery)
          .select("id")
          .maybeSingle();
        if (claimError || !inserted) {
          report.skipped += 1;
          continue;
        }
        claimed = inserted;
      }

      const startsAt = new Date(appointment.scheduled_at).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "full",
        timeStyle: "short",
      });
      const subject = `Reunião em ${reminder} minutos — NOX Fiança`;
      const html = renderNoxEmail(
        `<p>Olá, <strong>${escapeEmailHtml(recipient.full_name)}</strong>.</p>
         <h1 style="font-size:22px;margin:8px 0 14px">Sua reunião começa em ${reminder} minutos</h1>
         <div style="border:1px solid #f0d44a;background:#fffbea;border-radius:14px;padding:18px">
           <strong>${escapeEmailHtml(appointment.title)}</strong><br />
           Contato: ${escapeEmailHtml(appointment.contact_name || "não informado")}<br />
           Data e horário: ${escapeEmailHtml(startsAt)}
         </div>
         <p style="margin-top:18px">Acesse a Minha Agenda para consultar os dados, remarcar ou cancelar.</p>
         <p><a href="https://noxfianca.com/vendedor/agenda" style="display:inline-block;background:#171717;color:#ffd60a;text-decoration:none;border-radius:10px;padding:12px 18px;font-weight:700">Abrir minha agenda</a></p>`,
        `${appointment.title} começa em ${reminder} minutos.`,
      );

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
          .eq("id", claimed.id);
        report.sent += 1;
      } catch (sendError) {
        await admin
          .from("seller_meeting_reminder_deliveries")
          .update({
            status: "erro",
            last_error:
              sendError instanceof Error ? sendError.message.slice(0, 1000) : "Falha desconhecida",
            updated_at: new Date().toISOString(),
          })
          .eq("id", claimed.id);
        report.errors += 1;
      }
    }
  }

  return Response.json({ ok: true, report });
});
