import { createClient } from "npm:@supabase/supabase-js@2";

const NOX_EMAIL_LOGO_URL = "https://noxfianca.com/favicon-512.png";
const DEFAULT_ALLOWED_ORIGINS = ["https://noxfianca.com", "https://www.noxfianca.com"];

function escapeEmailHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderNoxEmail(content: string, preheader = "") {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>NOX Fiança</title></head>
  <body style="margin:0;background:#f5f5f5;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#171717">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeEmailHtml(preheader)}</div>` : ""}
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;background:#fff;border:1px solid #e8e8e8;border-radius:18px;overflow:hidden">
  <tr><td style="padding:24px 28px;border-bottom:1px solid #eee"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
  <td><img src="${NOX_EMAIL_LOGO_URL}" width="52" height="52" alt="Logo da NOX Fiança" style="display:block;width:52px;height:52px;border:0;border-radius:13px" /></td>
  <td style="padding-left:14px"><div style="font-size:19px;font-weight:800;letter-spacing:.4px">NOX FIANÇA</div><div style="font-size:12px;color:#666;margin-top:3px">A proteção que não dorme.</div></td>
  </tr></table></td></tr><tr><td style="padding:30px 28px;font-size:15px;line-height:1.6">${content}</td></tr>
  <tr><td style="padding:18px 28px;background:#171717;color:#fff;font-size:12px;line-height:1.5">Equipe NOX Fiança<br /><a href="https://noxfianca.com" style="color:#ffd60a;text-decoration:none">noxfianca.com</a></td></tr>
  </table></td></tr></table></body></html>`;
}

function allowedOrigins() {
  return (Deno.env.get("ALLOWED_ORIGINS") || DEFAULT_ALLOWED_ORIGINS.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (!origin || allowedOrigins().includes(origin)) {
    if (origin) headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function rejectDisallowedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || allowedOrigins().includes(origin)) return null;
  return new Response(JSON.stringify({ ok: false, error: "Origem não autorizada." }), {
    status: 403,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" },
  });
}

function hasOversizedBody(request: Request, maxBytes: number) {
  const length = Number(request.headers.get("content-length") || "0");
  return Number.isFinite(length) && length > maxBytes;
}

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

type InvitationRow = {
  invitation_id: string;
  invitation_token?: string;
  invitation_expires_at: string;
  invitation_status?: string;
  activated_now?: boolean;
  broker_profile_id?: string;
  broker_name: string;
  broker_email?: string;
  agency_profile_id?: string;
  agency_name: string;
  agency_email?: string;
  allocation_mode: string;
};

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" },
  });
}

function firstRow<T>(value: T[] | T | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function modeLabel(mode: string) {
  if (mode === "split_50") return "50% para a imobiliária e 50% para você";
  if (mode === "agency_full") return "100% para a imobiliária";
  return "100% para você";
}

function publicError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const allowed = [
    "Corretor não encontrado.",
    "Este corretor está bloqueado ou indisponível para vínculo.",
    "Este corretor já está vinculado à sua imobiliária.",
    "Este corretor já possui vínculo ativo com outra imobiliária.",
    "Este corretor já possui um convite pendente de outra imobiliária.",
    "Convite inválido.",
    "Convite inválido ou expirado.",
    "O corretor já possui vínculo ativo com outra imobiliária.",
  ];
  return allowed.find((candidate) => message.includes(candidate)) || "Não foi possível concluir a operação.";
}

async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY")?.trim();
  const from =
    Deno.env.get("RESEND_FROM_EMAIL")?.trim() ||
    "NOX FIANÇA <noreply@noxfianca.com>";
  if (!apiKey || !to) throw new Error("Serviço de e-mail indisponível.");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      reply_to: Deno.env.get("RESEND_REPLY_TO") || undefined,
      html,
    }),
  });
  if (!response.ok) throw new Error(`Resend ${response.status}`);
  return response.json().catch(() => ({}));
}

function invitationEmail(row: InvitationRow, confirmationUrl: string) {
  return renderNoxEmail(
    `
      <div style="display:inline-block;margin-bottom:18px;border-radius:999px;background:#fff3ad;color:#5f4900;padding:7px 12px;font-size:12px;font-weight:800;letter-spacing:.5px">CONVITE DE VÍNCULO</div>
      <h1 style="font-size:26px;line-height:1.2;margin:0 0 18px;color:#171717">${escapeEmailHtml(row.agency_name)} quer ter você na equipe</h1>
      <p>Olá, <strong>${escapeEmailHtml(row.broker_name || "corretor")}</strong>.</p>
      <p>A imobiliária <strong>${escapeEmailHtml(row.agency_name)}</strong> solicitou seu vínculo profissional na plataforma NOX Fiança.</p>
      <div style="margin:22px 0;border:1px solid #f0d44a;background:#fffbea;border-radius:14px;padding:18px">
        <div style="font-size:12px;color:#6b5a00;font-weight:800;text-transform:uppercase;letter-spacing:.5px">Regra de comissão dos novos contratos</div>
        <div style="margin-top:7px;font-size:17px;font-weight:800;color:#171717">${escapeEmailHtml(modeLabel(row.allocation_mode))}</div>
      </div>
      <p>O vínculo só será ativado depois da sua confirmação. Até lá, você continuará sem vínculo com essa imobiliária.</p>
      <p style="margin:28px 0">
        <a href="${escapeEmailHtml(confirmationUrl)}" style="display:inline-block;background:#ffd60a;color:#171717;text-decoration:none;font-weight:800;padding:15px 24px;border-radius:11px">Revisar e confirmar vínculo</a>
      </p>
      <p style="font-size:13px;color:#666">O convite é pessoal, possui validade de 7 dias e substitui links anteriores enviados pela mesma imobiliária.</p>
      <p style="font-size:13px;color:#666">Se você não reconhece a imobiliária, não confirme o vínculo.</p>
    `,
    `${row.agency_name} convidou você para confirmar um vínculo na NOX Fiança.`,
  );
}

function agencyActivationEmail(row: InvitationRow) {
  return renderNoxEmail(
    `
      <div style="display:inline-block;margin-bottom:18px;border-radius:999px;background:#dcfce7;color:#166534;padding:7px 12px;font-size:12px;font-weight:800;letter-spacing:.5px">VÍNCULO ATIVO</div>
      <h1 style="font-size:26px;line-height:1.2;margin:0 0 18px;color:#171717">Seu novo corretor confirmou o vínculo</h1>
      <p>A confirmação foi concluída com sucesso.</p>
      <div style="margin:22px 0;border-left:5px solid #ffd60a;background:#f8f8f8;border-radius:12px;padding:18px">
        <div style="font-size:18px;font-weight:800">${escapeEmailHtml(row.broker_name)}</div>
        <div style="margin-top:5px;color:#555">Regra financeira: ${escapeEmailHtml(modeLabel(row.allocation_mode))}</div>
      </div>
      <p>O corretor já aparece como <strong>Ativo</strong> no painel da imobiliária. Os próximos contratos seguirão automaticamente a regra de comissão confirmada.</p>
      <p style="margin:28px 0">
        <a href="https://noxfianca.com/corretores-admin" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;font-weight:800;padding:15px 24px;border-radius:11px">Abrir Meus Corretores</a>
      </p>
    `,
    `${row.broker_name} confirmou o vínculo com sua imobiliária.`,
  );
}

function brokerActivationEmail(row: InvitationRow) {
  return renderNoxEmail(
    `
      <div style="display:inline-block;margin-bottom:18px;border-radius:999px;background:#dcfce7;color:#166534;padding:7px 12px;font-size:12px;font-weight:800;letter-spacing:.5px">CONFIRMAÇÃO CONCLUÍDA</div>
      <h1 style="font-size:26px;line-height:1.2;margin:0 0 18px;color:#171717">Vínculo ativado com sucesso</h1>
      <p>Olá, <strong>${escapeEmailHtml(row.broker_name)}</strong>.</p>
      <p>Seu vínculo com <strong>${escapeEmailHtml(row.agency_name)}</strong> já está ativo na NOX Fiança.</p>
      <div style="margin:22px 0;border:1px solid #f0d44a;background:#fffbea;border-radius:14px;padding:18px">
        <div style="font-size:12px;color:#6b5a00;font-weight:800;text-transform:uppercase">Comissão dos novos contratos</div>
        <div style="margin-top:7px;font-size:17px;font-weight:800">${escapeEmailHtml(modeLabel(row.allocation_mode))}</div>
      </div>
      <p>A partir de agora, consultas e contratos vinculados a você serão organizados automaticamente dentro dessa equipe.</p>
    `,
    `Seu vínculo com ${row.agency_name} está ativo.`,
  );
}

async function authenticatedClient(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Autenticação obrigatória.");
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new Error("Autenticação obrigatória.");
  return { client, userId: data.user.id };
}

async function createInvitation(request: Request, payload: Record<string, unknown>) {
  const { userId } = await authenticatedClient(request);
  const corretorId = String(payload.corretorId || "");
  const allocationMode = String(payload.commissionAllocationMode || "");
  if (!corretorId || !["broker_full", "split_50", "agency_full"].includes(allocationMode)) {
    return json(request, { ok: false, error: "Dados do convite inválidos." }, 400);
  }

  const { data: rate, error: rateError } = await admin.rpc("consume_security_rate_limit", {
    p_scope: "broker-agency-invitation",
    p_identifier: userId,
    p_limit: 20,
    p_window_seconds: 3600,
    p_block_seconds: 3600,
  });
  if (rateError || !rate?.[0]?.allowed) {
    return json(request, { ok: false, error: "Limite de convites atingido. Tente novamente mais tarde." }, 429);
  }

  const { data, error } = await admin.rpc("create_my_broker_agency_invitation", {
    p_corretor_id: corretorId,
    p_commission_allocation_mode: allocationMode,
    p_agency_profile_id: userId,
  });
  if (error) throw new Error(error.message);
  const row = firstRow(data) as InvitationRow | null;
  if (!row?.invitation_token || !row.broker_email) throw new Error("Convite não criado.");

  const siteUrl = (Deno.env.get("PUBLIC_SITE_URL") || Deno.env.get("SITE_URL") || "https://noxfianca.com").replace(/\/$/, "");
  const confirmationUrl = `${siteUrl}/confirmar-vinculo-corretor?token=${encodeURIComponent(row.invitation_token)}`;
  let emailSent = false;
  try {
    await sendEmail(
      row.broker_email,
      `${row.agency_name} convidou você para a equipe | NOX Fiança`,
      invitationEmail(row, confirmationUrl),
    );
    emailSent = true;
    await admin
      .from("broker_agency_invitations")
      .update({ invitation_email_sent_at: new Date().toISOString(), last_email_error: null })
      .eq("id", row.invitation_id);
  } catch (emailError) {
    await admin
      .from("broker_agency_invitations")
      .update({ last_email_error: "Falha ao enviar convite por e-mail." })
      .eq("id", row.invitation_id);
    console.error("[broker-agency-invitation] invitation email", {
      name: emailError instanceof Error ? emailError.name : "unknown",
    });
  }

  return json(request, {
    ok: true,
    invitationId: row.invitation_id,
    emailSent,
    status: "pending",
  });
}

async function inspectInvitation(request: Request, payload: Record<string, unknown>) {
  const token = String(payload.token || "").trim();
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return json(request, { ok: false, error: "Convite inválido." }, 404);
  }
  const { data, error } = await admin.rpc("inspect_broker_agency_invitation", { p_token: token });
  if (error) throw error;
  const row = firstRow(data) as InvitationRow | null;
  if (!row) return json(request, { ok: false, error: "Convite inválido." }, 404);
  return json(request, {
    ok: true,
    invitation: {
      id: row.invitation_id,
      status: row.invitation_status,
      expiresAt: row.invitation_expires_at,
      brokerName: row.broker_name,
      agencyName: row.agency_name,
      commissionAllocationMode: row.allocation_mode,
    },
  });
}

async function acceptInvitation(request: Request, payload: Record<string, unknown>) {
  const token = String(payload.token || "").trim();
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return json(request, { ok: false, error: "Convite inválido ou expirado." }, 400);
  }
  const { data, error } = await admin.rpc("accept_broker_agency_invitation", { p_token: token });
  if (error) throw new Error(error.message);
  const row = firstRow(data) as InvitationRow | null;
  if (!row?.invitation_id || !row.broker_email || !row.agency_email) throw new Error("Aceite inválido.");

  const { data: delivery } = await admin
    .from("broker_agency_invitations")
    .select("broker_activation_email_sent_at, agency_activation_email_sent_at")
    .eq("id", row.invitation_id)
    .maybeSingle();

  const warnings: string[] = [];
  if (!delivery?.broker_activation_email_sent_at) {
    try {
      await sendEmail(row.broker_email, "Seu vínculo está ativo | NOX Fiança", brokerActivationEmail(row));
      await admin
        .from("broker_agency_invitations")
        .update({ broker_activation_email_sent_at: new Date().toISOString(), last_email_error: null })
        .eq("id", row.invitation_id);
    } catch {
      warnings.push("broker_email");
    }
  }
  if (!delivery?.agency_activation_email_sent_at) {
    try {
      await sendEmail(
        row.agency_email,
        `${row.broker_name} confirmou o vínculo | NOX Fiança`,
        agencyActivationEmail(row),
      );
      await admin
        .from("broker_agency_invitations")
        .update({ agency_activation_email_sent_at: new Date().toISOString(), last_email_error: null })
        .eq("id", row.invitation_id);
    } catch {
      warnings.push("agency_email");
    }
  }
  if (warnings.length) {
    await admin
      .from("broker_agency_invitations")
      .update({ last_email_error: "Falha temporária em e-mail de ativação." })
      .eq("id", row.invitation_id);
  }

  return json(request, {
    ok: true,
    activatedNow: Boolean(row.activated_now),
    status: "accepted",
    brokerName: row.broker_name,
    agencyName: row.agency_name,
    warnings,
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  const rejected = rejectDisallowedOrigin(request);
  if (rejected) return rejected;
  if (request.method !== "POST") return json(request, { ok: false, error: "Método inválido." }, 405);
  if (hasOversizedBody(request, 24_000)) return json(request, { ok: false, error: "Payload muito grande." }, 413);

  try {
    const body = await request.json();
    const action = String(body?.action || "");
    const payload = (body?.payload || {}) as Record<string, unknown>;
    if (action === "create") return await createInvitation(request, payload);
    if (action === "inspect") return await inspectInvitation(request, payload);
    if (action === "accept") return await acceptInvitation(request, payload);
    return json(request, { ok: false, error: "Ação inválida." }, 400);
  } catch (error) {
    console.error("[broker-agency-invitation]", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return json(request, { ok: false, error: publicError(error) }, 400);
  }
});
