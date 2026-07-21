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
 * Retorna { tenantUserId, tempPassword? } onde tempPassword vem populado quando o user é novo.
 */
export const ensureTenantUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => ensureTenantSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const emailLower = data.email.toLowerCase().trim();

    // 1. Try find existing user by email via admin listUsers
    let tenantUserId: string | null = null;
    let tempPassword: string | undefined;

    // Use admin API to list users filtered by email
    const { data: existing, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (listErr) throw new Error("Falha ao buscar usuário existente: " + listErr.message);

    const found = existing.users.find((u) => (u.email ?? "").toLowerCase() === emailLower);
    if (found) {
      tenantUserId = found.id;
    } else {
      // create new
      tempPassword = "Nox@" + Math.random().toString(36).slice(2, 8) + "!";
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: emailLower,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { nome: data.nome, cpf: data.cpf, telefone: data.telefone, role: "inquilino" },
      });
      if (createErr || !created.user) {
        throw new Error("Falha ao criar usuário inquilino: " + (createErr?.message ?? "desconhecido"));
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
        { onConflict: "id" }
      );
    }

    // 2. Update consulta with tenant_user_id
    await supabaseAdmin
      .from("consultas_credito")
      .update({ tenant_user_id: tenantUserId } as any)
      .eq("id", data.consultaId);

    return { tenantUserId, tempPassword };
  });
