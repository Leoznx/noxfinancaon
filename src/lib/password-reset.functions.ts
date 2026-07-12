import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { sendPasswordResetEmail } from "@/lib/resend.service";

function buildResetRedirectTo() {
  const base = (process.env.APP_URL || "https://noxfianca.com").replace(/\/$/, "");
  return `${base}/redefinir-senha`;
}

const requestSchema = z.object({
  email: z.string().email(),
});

/**
 * Gera o link de recuperação via Supabase (generateLink nunca envia e-mail
 * sozinho, só devolve o link) e o envia pelo template do Resend escolhido
 * (ver src/lib/resend.service.ts). Sempre responde { ok: true } — nunca
 * revela se o e-mail existe na base, evitando enumeração de contas.
 */
export const requestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => requestSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const emailLower = data.email.toLowerCase().trim();

    try {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("id, nome")
        .ilike("email", emailLower)
        .maybeSingle();
      if (!profile) return { ok: true as const };

      const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email: emailLower,
        options: { redirectTo: buildResetRedirectTo() },
      });
      if (linkError || !linkData?.properties?.action_link) {
        console.error("[requestPasswordReset] falha ao gerar link de recuperação:", linkError);
        return { ok: true as const };
      }

      await sendPasswordResetEmail({
        email: emailLower,
        nome: (profile as any).nome || "cliente",
        resetLink: linkData.properties.action_link,
      });
    } catch (e) {
      console.error("[requestPasswordReset] erro inesperado:", e);
    }

    return { ok: true as const };
  });
