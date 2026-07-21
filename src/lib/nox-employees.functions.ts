import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sendVerificationEmail } from "@/lib/resend.service";
import { NOX_INTERNAL_ROLES } from "@/lib/nox-internal-accounts";
import { defaultAvatarForName } from "@/lib/gender-avatar";
import { buildAuthEmailCallbackUrl } from "@/lib/auth-email-links";

function buildVerificationLink(properties: { hashed_token: string; verification_type: string }) {
  const appUrl =
    process.env.APP_URL ||
    process.env.APP_BASE_URL ||
    process.env.FRONTEND_URL ||
    "https://noxfianca.com";
  return buildAuthEmailCallbackUrl({
    appUrl,
    path: "/email-verificado",
    tokenHash: properties.hashed_token,
    type: properties.verification_type,
  });
}

// Confere se quem chamou é um admin de verdade — nunca confia em roles/
// internalRole vindos do frontend. Usa o supabase da requireSupabaseAuth
// (RLS, com o JWT de quem chamou) só pra ler o PRÓPRIO profile.role — todo
// mundo já pode ler o próprio perfil, então isso nunca esbarra em RLS.
async function assertIsAdmin(supabase: any, userId: string) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  const role = (profile as any)?.role;
  if (role !== "admin" && role !== "admin_master") {
    throw new Error("Apenas administradores podem gerenciar contas da equipe NOX.");
  }
}

// ============================================================================
// Público: cadastro pelo link fixo (/login/<cargo>nox) - sem convite, sem
// token. O cargo vem da ROTA (fixo por arquivo, ver login_.vendedornox.tsx e
// os outros 3), nunca de um campo livre do formulário - mas mesmo assim o
// backend valida de novo contra a MESMA lista fixa de 4 cargos, porque nao da
// pra confiar que o valor que chegou aqui realmente veio da rota certa (podia
// ter vindo de um fetch direto pelo DevTools).
// ============================================================================

const signUpSchema = z.object({
  role: z.enum(NOX_INTERNAL_ROLES as [string, ...string[]]),
  nome: z.string().trim().min(3).max(200),
  email: z.string().email().max(255),
  telefone: z.string().min(8).max(30),
  senha: z
    .string()
    .min(8)
    .regex(/[a-zA-Z]/)
    .regex(/[0-9]/),
});

export const signUpNoxEmployee = createServerFn({ method: "POST" })
  .validator((data: unknown) => signUpSchema.parse(data))
  .handler(async ({ data }) => {
    // z.enum ja rejeita qualquer valor fora da lista fixa (incluindo "admin"/
    // "admin_master") antes de chegar aqui, mas o if abaixo fica como reforço
    // explícito - essa rota NUNCA pode criar uma conta de administrador.
    if (!(NOX_INTERNAL_ROLES as readonly string[]).includes(data.role)) {
      return { ok: false as const, error: "invalido" as const };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const emailLower = data.email.toLowerCase().trim();

    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("email", emailLower)
      .maybeSingle();
    if (existingProfile) return { ok: false as const, error: "email_cadastrado" as const };

    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "signup",
      email: emailLower,
      password: data.senha,
      options: {
        data: { nome: data.nome, role: data.role },
      },
    });

    if (linkError || !linkData?.user) {
      return {
        ok: false as const,
        error: /already.*registered/i.test(linkError?.message || "")
          ? ("email_cadastrado" as const)
          : ("erro" as const),
      };
    }

    const userId = linkData.user.id;

    await supabaseAdmin
      .from("profiles")
      .update({ status: "ativo", nome: data.nome, telefone: data.telefone } as any)
      .eq("id", userId);

    // Foto de perfil padrão por gênero detectado no primeiro nome (mesmo padrão de
    // signUpInquilino/signUpProfissional em auth-signup.functions.ts) — sem isso, as
    // contas da equipe NOX ficavam sempre com as iniciais em vez de uma foto fixa.
    await supabaseAdmin
      .from("profiles")
      .update({ avatar_url: defaultAvatarForName(data.nome) } as any)
      .eq("id", userId)
      .is("avatar_url", null);

    await supabaseAdmin.from("internal_users" as any).upsert(
      {
        auth_user_id: userId,
        full_name: data.nome,
        email: emailLower,
        phone: data.telefone,
        role: data.role,
        status: "ativo",
      } as any,
      { onConflict: "auth_user_id" },
    );

    await supabaseAdmin.from("internal_audit_logs" as any).insert({
      actor_user_id: userId,
      actor_role: data.role,
      action: "cadastro_equipe_nox",
      table_name: "internal_users",
      record_id: userId,
      after: { role: data.role, email: emailLower },
    } as any);

    const emailResult = await sendVerificationEmail({
      email: emailLower,
      nome: data.nome,
      verificationLink: buildVerificationLink(linkData.properties),
    });

    return { ok: true as const, userId, emailSent: emailResult.sent };
  });

// ============================================================================
// Admin: listar funcionários internos cadastrados
// ============================================================================

export const listNoxEmployees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({}).optional().parse(data))
  .handler(async ({ context }) => {
    await assertIsAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows, error } = await supabaseAdmin
      .from("internal_users" as any)
      .select("id, auth_user_id, full_name, email, phone, role, status, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error("Não foi possível carregar os funcionários.");

    // Cruza com auth.users pra saber quem ainda não confirmou o e-mail e
    // quando foi o último acesso - nenhum desses dois campos existe em
    // internal_users/profiles, só na tabela de autenticação do Supabase.
    const { data: authList } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const authById = new Map((authList?.users ?? []).map((u: any) => [u.id, u]));

    const employees = ((rows as any[]) ?? []).map((r) => {
      const authUser = authById.get(r.auth_user_id);
      const emailConfirmed = !!authUser?.email_confirmed_at;
      const status: "ativo" | "bloqueado" | "aguardando_confirmacao" =
        r.status === "bloqueado"
          ? "bloqueado"
          : !emailConfirmed
            ? "aguardando_confirmacao"
            : "ativo";
      return {
        id: r.id,
        authUserId: r.auth_user_id,
        nome: r.full_name,
        email: r.email,
        telefone: r.phone,
        cargo: r.role,
        criadoEm: r.created_at,
        status,
        ultimoAcesso: authUser?.last_sign_in_at || null,
      };
    });

    return { ok: true as const, employees };
  });

// ============================================================================
// Admin: bloquear / reativar funcionário
// ============================================================================

const updateStatusSchema = z.object({
  employeeId: z.string().uuid(),
  status: z.enum(["ativo", "bloqueado"]),
});

export const updateNoxEmployeeStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => updateStatusSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertIsAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: before } = await supabaseAdmin
      .from("internal_users" as any)
      .select("status")
      .eq("id", data.employeeId)
      .maybeSingle();

    const { error } = await supabaseAdmin
      .from("internal_users" as any)
      .update({ status: data.status } as any)
      .eq("id", data.employeeId);
    if (error) throw new Error("Não foi possível atualizar o status do funcionário.");

    await supabaseAdmin.from("internal_audit_logs" as any).insert({
      actor_user_id: context.userId,
      actor_role: "admin",
      action: "alterar_status_funcionario_nox",
      table_name: "internal_users",
      record_id: data.employeeId,
      before: { status: (before as any)?.status ?? null },
      after: { status: data.status },
    } as any);

    return { ok: true as const };
  });

// ============================================================================
// Admin: alterar cargo do funcionário (nunca admin/admin_master)
// ============================================================================

const updateRoleSchema = z.object({
  employeeId: z.string().uuid(),
  role: z.enum(NOX_INTERNAL_ROLES as [string, ...string[]]),
});

export const updateNoxEmployeeRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => updateRoleSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertIsAdmin(context.supabase, context.userId);
    if (!(NOX_INTERNAL_ROLES as readonly string[]).includes(data.role)) {
      throw new Error("Cargo inválido.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: employee } = await supabaseAdmin
      .from("internal_users" as any)
      .select("role, auth_user_id")
      .eq("id", data.employeeId)
      .maybeSingle();
    if (!employee) throw new Error("Funcionário não encontrado.");

    const { error } = await supabaseAdmin
      .from("internal_users" as any)
      .update({ role: data.role } as any)
      .eq("id", data.employeeId);
    if (error) throw new Error("Não foi possível atualizar o cargo do funcionário.");

    // profiles.role acompanha internal_users.role pra manter as duas fontes
    // coerentes (profiles.role e' o que o trigger de cadastro grava;
    // internal_users.role e' a fonte editável de verdade depois disso).
    await supabaseAdmin
      .from("profiles")
      .update({ role: data.role } as any)
      .eq("id", (employee as any).auth_user_id);

    await supabaseAdmin.from("internal_audit_logs" as any).insert({
      actor_user_id: context.userId,
      actor_role: "admin",
      action: "alterar_cargo_funcionario_nox",
      table_name: "internal_users",
      record_id: data.employeeId,
      before: { role: (employee as any).role },
      after: { role: data.role },
    } as any);

    return { ok: true as const };
  });
