// deno-lint-ignore-file no-import-prefix
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@3.2.0";
import { escapeEmailHtml, renderNoxEmail } from "../_shared/email-branding.ts";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const destinatariosPorPerfil: Record<string, string> = {
  corretor: "parcerias-corretores@noxfianca.com",
  imobiliaria: "comercial-imobiliarias@noxfianca.com",
  proprietario: "atendimento-proprietarios@noxfianca.com",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { perfil, nome, email, telefone, cidade, uf, mensagem } = await req.json();

    const to = destinatariosPorPerfil[perfil] || "atendimento@noxfianca.com";

    const { data, error } = await resend.emails.send({
      from: Deno.env.get("RESEND_FROM_EMAIL") || "NOX FIANÇA <financeiro@noxfianca.com>",
      to: [to],
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

    if (error) {
      console.error("Resend error:", error);
      throw error;
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: unknown) {
    console.error("Error in notificar-time-comercial function:", error);
    const message = error instanceof Error ? error.message : "Erro interno ao enviar o e-mail";
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
