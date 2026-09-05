// deno-lint-ignore-file no-import-prefix
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@3.2.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";
import { escapeEmailHtml, renderNoxEmail } from "../_shared/email-branding.ts";
import { corsHeaders, hasOversizedBody, rejectDisallowedOrigin } from "../_shared/http-security.ts";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const destinatariosPorPerfil: Record<string, string> = {
  corretor: "parcerias-corretores@noxfianca.com",
  imobiliaria: "comercial-imobiliarias@noxfianca.com",
  proprietario: "atendimento-proprietarios@noxfianca.com",
};

function response(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    status,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  const rejected = rejectDisallowedOrigin(req);
  if (rejected) return rejected;
  if (req.method !== "POST")
    return response(req, { ok: false, error: "Método não permitido." }, 405);
  if (hasOversizedBody(req, 32_768))
    return response(req, { ok: false, error: "Payload muito grande." }, 413);

  try {
    const body = await req.json();
    const perfil = String(body?.perfil || "")
      .trim()
      .toLowerCase();
    const nome = String(body?.nome || "").trim();
    const email = String(body?.email || "")
      .trim()
      .toLowerCase();
    const telefone = String(body?.telefone || "").trim();
    const cidade = String(body?.cidade || "").trim();
    const uf = String(body?.uf || "")
      .trim()
      .toUpperCase();
    const mensagem = String(body?.mensagem || "").trim();
    if (
      !destinatariosPorPerfil[perfil] ||
      nome.length < 2 ||
      nome.length > 160 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 255 ||
      telefone.length < 8 ||
      telefone.length > 30 ||
      cidade.length > 120 ||
      !/^[A-Z]{2}$/.test(uf) ||
      mensagem.length > 2000
    )
      return response(req, { ok: false, error: "Dados inválidos." }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const address = (
      req.headers.get("x-forwarded-for") ||
      req.headers.get("x-real-ip") ||
      "unknown"
    )
      .split(",")[0]
      .trim();
    const { data: rate, error: rateError } = await admin.rpc("consume_security_rate_limit", {
      p_scope: "commercial-contact",
      p_identifier: `${address}:${email}`,
      p_limit: 5,
      p_window_seconds: 3600,
      p_block_seconds: 3600,
    });
    if (rateError || !rate?.[0]?.allowed) {
      return response(
        req,
        { ok: false, error: "Muitas tentativas. Aguarde e tente novamente." },
        429,
      );
    }

    const { error } = await resend.emails.send({
      from: Deno.env.get("RESEND_FROM_EMAIL") || "NOX FIANÇA <financeiro@noxfianca.com>",
      to: [destinatariosPorPerfil[perfil]],
      subject: `Novo lead — ${perfil.toUpperCase()} — ${nome}`,
      html: renderNoxEmail(
        `
          <h1 style="font-size:24px;line-height:1.25;margin:0 0 18px">Novo contato recebido</h1>
          <p><strong>Perfil:</strong> ${escapeEmailHtml(perfil)}</p>
          <p><strong>Nome:</strong> ${escapeEmailHtml(nome)}</p>
          <p><strong>E-mail:</strong> <a href="mailto:${escapeEmailHtml(email)}">${escapeEmailHtml(email)}</a></p>
          <p><strong>Telefone:</strong> <a href="https://wa.me/55${telefone.replace(/\D/g, "")}">${escapeEmailHtml(telefone)}</a></p>
          <p><strong>Cidade:</strong> ${escapeEmailHtml(cidade)}/${escapeEmailHtml(uf)}</p>
          ${mensagem ? `<p><strong>Mensagem:</strong></p><p>${escapeEmailHtml(mensagem)}</p>` : ""}
          <p style="margin-top:26px"><a href="https://noxfianca.com/painel/admin/leads" style="display:inline-block;background:#ffd60a;color:#171717;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:10px">Ver leads</a></p>
        `,
        `Novo contato de ${nome}.`,
      ),
    });
    if (error) throw error;
    return response(req, { ok: true });
  } catch (error) {
    console.error("[notificar-time-comercial] envio não concluído", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return response(req, { ok: false, error: "Não foi possível enviar a solicitação." }, 500);
  }
});
