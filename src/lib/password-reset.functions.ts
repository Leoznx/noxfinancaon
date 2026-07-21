import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { sendPasswordResetEmail } from "@/lib/resend.service";
import { buildAuthEmailCallbackUrl } from "@/lib/auth-email-links";

function buildResetLink(properties: { hashed_token: string; verification_type: string }) {
  const appUrl =
    process.env.APP_URL ||
    process.env.APP_BASE_URL ||
    process.env.FRONTEND_URL ||
    "https://noxfianca.com";
  return buildAuthEmailCallbackUrl({
    appUrl,
    path: "/redefinir-senha",
    tokenHash: properties.hashed_token,
    type: properties.verification_type,
  });
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
  .validator((data: unknown) => requestSchema.parse(data))
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
      });
      if (linkError || !linkData?.properties?.hashed_token) {
        console.error("[requestPasswordReset] falha ao gerar link de recuperação:", linkError);
        return { ok: true as const };
      }

      await sendPasswordResetEmail({
        email: emailLower,
        nome: (profile as any).nome || "cliente",
        resetLink: buildResetLink(linkData.properties),
      });
    } catch (e) {
      console.error("[requestPasswordReset] erro inesperado:", e);
    }

    return { ok: true as const };
  });
