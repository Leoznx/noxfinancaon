import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@3.2.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const destinatariosPorPerfil: Record<string, string> = {
  corretor: "parcerias-corretores@noxfianca.com.br",
  imobiliaria: "comercial-imobiliarias@noxfianca.com.br",
  proprietario: "atendimento-proprietarios@noxfianca.com.br",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { perfil, nome, email, telefone, cidade, uf, mensagem } = await req.json();

    const to = destinatariosPorPerfil[perfil] || "atendimento@noxfianca.com.br";

    const { data, error } = await resend.emails.send({
      from: "NOX FIANÇA <leads@noxfianca.com.br>",
      to: [to],
      subject: `Novo lead — ${perfil.toUpperCase()} — ${nome}`,
      html: `
        <h2>Novo contato recebido</h2>
        <p><strong>Perfil:</strong> ${perfil}</p>
        <p><strong>Nome:</strong> ${nome}</p>
        <p><strong>E-mail:</strong> <a href="mailto:${email}">${email}</a></p>
        <p><strong>Telefone:</strong> <a href="https://wa.me/55${telefone.replace(/\D/g, "")}">${telefone}</a></p>
        <p><strong>Cidade:</strong> ${cidade}/${uf}</p>
        ${mensagem ? `<p><strong>Mensagem:</strong></p><p>${mensagem}</p>` : ""}
        <hr>
        <p>Acesse o painel para ver mais detalhes: <a href="https://noxfianca.com.br/painel/admin/leads">Ver leads</a></p>
      `,
    });

    if (error) {
      console.error("Resend error:", error);
      throw error;
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: any) {
    console.error("Error in notificar-time-comercial function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
