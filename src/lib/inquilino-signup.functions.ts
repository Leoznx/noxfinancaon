import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const linkSchema = z.object({
  cpf: z.string().min(11).max(20),
});

/**
 * Vincula o usuário inquilino logado a registros já existentes
 * que tenham o mesmo CPF (consultas, faturas, documentos, inquilinos).
 */
export const linkTenantByCpf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => linkSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cpfNorm = data.cpf.replace(/\D/g, "");
    const userId = context.userId;

    // 1. Vincular consultas que tenham tenant_document = cpf
    const { data: consultas } = await supabaseAdmin
      .from("consultas_credito")
      .update({ tenant_user_id: userId } as any)
      .eq("tenant_document", cpfNorm)
      .is("tenant_user_id", null)
      .select("id");

    const consultaIds = (consultas ?? []).map((c: any) => c.id);

    // 2. Vincular faturas/documentos das consultas encontradas
    if (consultaIds.length > 0) {
      await supabaseAdmin
        .from("faturas_inquilino")
        .update({ tenant_user_id: userId } as any)
        .in("consulta_id", consultaIds);

      await supabaseAdmin
        .from("documentos_proposta")
        .update({ tenant_user_id: userId } as any)
        .in("consulta_id", consultaIds);
    }

    // 3. Vincular o registro em inquilinos (cpf único) ao profile
    await supabaseAdmin
      .from("inquilinos")
      .update({ profile_id: userId } as any)
      .eq("cpf", cpfNorm);

    return {
      linkedConsultas: consultaIds.length,
    };
  });

const checkSchema = z.object({
  email: z.string().email().max(255),
  cpf: z.string().min(11).max(20),
});

/**
 * Verifica se já existe conta com este e-mail ou CPF.
 * Público (sem auth) — usado antes do signup.
 */
export const checkInquilinoExists = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => checkSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const emailLower = data.email.toLowerCase().trim();
    const cpfNorm = data.cpf.replace(/\D/g, "");

    // Profile por email
    const { data: byEmail } = await supabaseAdmin
      .from("profiles")
      .select("id, role")
      .ilike("email", emailLower)
      .maybeSingle();

    if (byEmail) return { exists: true, reason: "email" as const };

    // Inquilino por cpf que já tenha profile_id
    const { data: byCpf } = await supabaseAdmin
      .from("inquilinos")
      .select("id, profile_id")
      .eq("cpf", cpfNorm)
      .maybeSingle();

    if (byCpf?.profile_id) return { exists: true, reason: "cpf" as const };

    return { exists: false as const };
  });
