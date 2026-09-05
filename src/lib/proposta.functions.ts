import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ensureTenantSchema = z.object({
  consultaId: z.string().uuid(),
  email: z.string().email().max(255),
  nome: z.string().min(1).max(255),
  cpf: z.string().min(11).max(20),
  telefone: z.string().max(30).optional().nullable(),
});

/**
 * Cria (se necessário) o usuário do inquilino na auth e atribui role 'inquilino'.
 * Retorna somente o identificador do inquilino; credenciais temporárias nunca saem do servidor.
 */
export const ensureTenantUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => ensureTenantSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const emailLower = data.email.toLowerCase().trim();

    // A consulta precisa estar visível pelo JWT/RLS e pertencer ao solicitante,
    // à imobiliária dele ou a um colaborador interno ativo. Só depois usamos a
    // service role para a operação administrativa na Auth.
    const { data: consultation, error: consultationError } = await context.supabase
      .from("consultas_credito")
      .select("id, profile_id_solicitante")
      .eq("id", data.consultaId)
      .maybeSingle();
    if (consultationError || !consultation)
      throw new Error("Consulta não encontrada ou acesso negado.");

    const [{ data: ownProfile }, { data: internalUser }, { data: ownsOrManages }] =
      await Promise.all([
        context.supabase
          .from("profiles")
          .select("role, status")
          .eq("id", context.userId)
          .maybeSingle(),
        context.supabase
          .from("internal_users" as any)
          .select("id")
          .eq("auth_user_id", context.userId)
          .eq("status", "ativo")
          .maybeSingle(),
        (context.supabase.rpc as any)("eh_dono_ou_imobiliaria_da_consulta", {
          p_profile_id_solicitante: (consultation as any).profile_id_solicitante,
        }),
      ]);
    const profileRole = (ownProfile as any)?.role;
    const authorized =
      ownsOrManages === true ||
      !!internalUser ||
      ((profileRole === "admin" || profileRole === "admin_master") &&
        (ownProfile as any)?.status !== "bloqueado");
    if (!authorized)
      throw new Error("Você não tem permissão para vincular um usuário a esta consulta.");

    // 1. Try find existing user by email via admin listUsers
    let tenantUserId: string | null = null;

    // Use admin API to list users filtered by email
    const { data: existing, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (listErr) throw new Error("Não foi possível validar o usuário do inquilino.");

    const found = existing.users.find((u) => (u.email ?? "").toLowerCase() === emailLower);
    if (found) {
      tenantUserId = found.id;
    } else {
      // create new
      const randomPassword = `N0x!${Array.from(crypto.getRandomValues(new Uint8Array(24)))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")}`;
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: emailLower,
        password: randomPassword,
        email_confirm: true,
        user_metadata: {
          nome: data.nome,
          cpf: data.cpf,
          telefone: data.telefone,
          role: "inquilino",
        },
      });
      if (createErr || !created.user) {
        throw new Error("Não foi possível criar o acesso do inquilino.");
      }
      tenantUserId = created.user.id;

      // Create profile row
      await supabaseAdmin.from("profiles").upsert(
        {
          id: tenantUserId,
          email: emailLower,
          nome: data.nome,
          telefone: data.telefone ?? null,
          role: "inquilino" as any,
          status: "ativo",
        } as any,
        { onConflict: "id" },
      );
    }

    // 2. Update consulta with tenant_user_id
    const { error: updateError } = await supabaseAdmin
      .from("consultas_credito")
      .update({ tenant_user_id: tenantUserId } as any)
      .eq("id", data.consultaId);
    if (updateError) throw new Error("Não foi possível vincular o inquilino à consulta.");

    return { tenantUserId };
  });
