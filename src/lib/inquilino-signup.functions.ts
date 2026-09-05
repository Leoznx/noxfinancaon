import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { enforceSecurityRateLimit } from "@/lib/security-rate-limit.server";

const linkSchema = z.object({
  cpf: z.string().min(11).max(20),
  // Preenchido no cadastro, mas o próprio .update() do cadastro.tsx roda sem sessão
  // ainda (e-mail não confirmado) e é bloqueado por RLS — reaplica aqui, já autenticado.
  telefone: z.string().optional(),
});

/**
 * Vincula um profile (por userId) a registros já existentes com o mesmo CPF
 * (consultas, faturas, documentos, inquilinos). Compartilhado entre
 * `linkTenantByCpf` (chamada autenticada, usada como rede de segurança pelo
 * SIGNED_IN do AuthProvider) e `signUpInquilino` (auth-signup.functions.ts,
 * que já roda com supabaseAdmin logo após criar a conta).
 */
export async function linkTenantRecordsByCpf(
  supabaseAdmin: any,
  userId: string,
  cpfNorm: string,
  telefone?: string,
) {
  if (telefone) {
    await supabaseAdmin
      .from("profiles")
      .update({ telefone } as any)
      .eq("id", userId)
      .is("telefone", null);
  }

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

  return { linkedConsultas: consultaIds.length };
}

/**
 * Vincula o usuário inquilino logado a registros já existentes
 * que tenham o mesmo CPF (consultas, faturas, documentos, inquilinos).
 */
export const linkTenantByCpf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => linkSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cpfNorm = data.cpf.replace(/\D/g, "");
    return linkTenantRecordsByCpf(supabaseAdmin, context.userId, cpfNorm, data.telefone);
  });

const checkSchema = z.object({
  email: z.string().email().max(255),
  cpf: z.string().min(11).max(20),
});

/**
 * Resposta deliberadamente uniforme para não expor a existência de CPF/e-mail.
 * O cadastro faz a validação real no servidor e devolve erro genérico.
 */
export const checkInquilinoExists = createServerFn({ method: "POST" })
  .validator((data: unknown) => checkSchema.parse(data))
  .handler(async ({ data }) => {
    const emailLower = data.email.toLowerCase().trim();
    await enforceSecurityRateLimit({
      scope: "account-precheck",
      identifier: emailLower,
      limit: 10,
      windowSeconds: 3600,
    });
    return { exists: false as const };
  });
