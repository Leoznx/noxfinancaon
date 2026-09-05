import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sendVerificationEmail } from "@/lib/resend.service";
import { NOX_INTERNAL_ACCOUNT_TYPES, noxInternalAccounts } from "@/lib/nox-internal-accounts";
import { defaultAvatarForName } from "@/lib/gender-avatar";
import { buildAuthEmailCallbackUrl } from "@/lib/auth-email-links";
import { enforceSecurityRateLimit } from "@/lib/security-rate-limit.server";

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
    .select("role, status")
    .eq("id", userId)
    .maybeSingle();
  const role = (profile as any)?.role;
  const status = (profile as any)?.status;
  if ((role !== "admin" && role !== "admin_master") || ["bloqueado", "excluido"].includes(status)) {
    throw new Error("Apenas administradores podem gerenciar contas da equipe NOX.");
  }
}

// ============================================================================
// Público somente com convite aleatório, descartável e ainda válido.
// ============================================================================

const signUpSchema = z.object({
  accountType: z.enum(NOX_INTERNAL_ACCOUNT_TYPES as [string, ...string[]]),
  inviteToken: z.string().regex(/^[0-9a-f]{64}$/i),
  nome: z.string().trim().min(3).max(200),
  email: z.string().email().max(255),
  telefone: z.string().min(8).max(30),
  senha: z.string().min(12).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/),
});

export const createNoxEmployeeInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z
      .object({ accountType: z.enum(NOX_INTERNAL_ACCOUNT_TYPES as [string, ...string[]]) })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertIsAdmin(context.supabase, context.userId);
    await enforceSecurityRateLimit({
      scope: "nox-invite-create",
      identifier: context.userId,
      limit: 30,
      windowSeconds: 3600,
      blockSeconds: 3600,
    });
    const { data: rows, error } = await (context.supabase.rpc as any)(
      "create_nox_employee_invite",
      {
        p_account_type: data.accountType,
        p_ttl_minutes: 1440,
      },
    );
    const invite = Array.isArray(rows) ? rows[0] : rows;
    if (error || !invite?.invite_token)
      throw new Error("Não foi possível criar o convite protegido.");
    return {
      ok: true as const,
      token: String(invite.invite_token),
      expiresAt: String(invite.expires_at),
    };
  });

export const signUpNoxEmployee = createServerFn({ method: "POST" })
  .validator((data: unknown) => signUpSchema.parse(data))
  .handler(async ({ data }) => {
    // z.enum ja rejeita qualquer valor fora da lista fixa (incluindo "admin"/
    // "admin_master") antes de chegar aqui, mas o if abaixo fica como reforço
    // explícito - essa rota NUNCA pode criar uma conta de administrador.
    if (!(NOX_INTERNAL_ACCOUNT_TYPES as readonly string[]).includes(data.accountType)) {
      return { ok: false as const, error: "invalido" as const };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const emailLower = data.email.toLowerCase().trim();
    const account = noxInternalAccounts[data.accountType as keyof typeof noxInternalAccounts];

    await enforceSecurityRateLimit({
      scope: "nox-employee-signup",
      identifier: emailLower,
      limit: 5,
      windowSeconds: 3600,
      blockSeconds: 3600,
    });

    const tokenHash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(data.inviteToken.toLowerCase()),
        ),
      ),
    )
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const { data: invite } = await supabaseAdmin
      .from("nox_employee_invites" as any)
      .select("id, created_by")
      .eq("token_hash", tokenHash)
      .eq("account_type", data.accountType)
      .is("used_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!invite) return { ok: false as const, error: "convite_invalido" as const };

    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("email", emailLower)
      .maybeSingle();
    if (existingProfile) return { ok: false as const, error: "erro" as const };

    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "signup",
      email: emailLower,
      password: data.senha,
      options: {
        data: {
          nome: data.nome,
          role: account.internalRole,
          seller_type: account.sellerType,
        },
      },
    });

    if (linkError || !linkData?.user) {
      return {
        ok: false as const,
        error: /already.*registered/i.test(linkError?.message || "")
          ? ("erro" as const)
          : ("erro" as const),
      };
    }

    const userId = linkData.user.id;

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({ status: "ativo", nome: data.nome, telefone: data.telefone } as any)
      .eq("id", userId);

    // Foto de perfil padrão por gênero detectado no primeiro nome (mesmo padrão de
    // signUpInquilino/signUpProfissional em auth-signup.functions.ts) — sem isso, as
    // contas da equipe NOX ficavam sempre com as iniciais em vez de uma foto fixa.
    const { error: avatarError } = await supabaseAdmin
      .from("profiles")
      .update({ avatar_url: defaultAvatarForName(data.nome) } as any)
      .eq("id", userId)
      .is("avatar_url", null);

    const { error: internalError } = await supabaseAdmin.from("internal_users" as any).upsert(
      {
        auth_user_id: userId,
        full_name: data.nome,
        email: emailLower,
        phone: data.telefone,
        role: account.internalRole,
        seller_type: account.sellerType,
        status: "ativo",
      } as any,
      { onConflict: "auth_user_id" },
    );

    if (profileError || avatarError || internalError) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return { ok: false as const, error: "erro" as const };
    }

    const { data: claimedInvite, error: claimError } = await supabaseAdmin
      .from("nox_employee_invites" as any)
      .update({ used_at: new Date().toISOString(), used_by: userId } as any)
      .eq("id", (invite as any).id)
      .is("used_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .select("id")
      .maybeSingle();
    if (claimError || !claimedInvite) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return { ok: false as const, error: "convite_invalido" as const };
    }

    await supabaseAdmin.from("internal_audit_logs" as any).insert({
      actor_user_id: (invite as any).created_by,
      actor_role: "admin",
      action: "cadastro_equipe_nox",
      table_name: "internal_users",
      record_id: userId,
      after: {
        role: account.internalRole,
        seller_type: account.sellerType,
        email: emailLower,
      },
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
      .select(
        "id, auth_user_id, full_name, email, phone, role, seller_type, status, time_clock_enabled, created_at",
      )
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
        sellerType: r.seller_type ?? null,
        accountType: r.role === "vendedor" ? (r.seller_type ?? "sdr") : r.role,
        timeClockEnabled: !!r.time_clock_enabled,
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
  accountType: z.enum(NOX_INTERNAL_ACCOUNT_TYPES as [string, ...string[]]),
});

export const updateNoxEmployeeRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => updateRoleSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertIsAdmin(context.supabase, context.userId);
    if (!(NOX_INTERNAL_ACCOUNT_TYPES as readonly string[]).includes(data.accountType)) {
      throw new Error("Cargo inválido.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const account = noxInternalAccounts[data.accountType as keyof typeof noxInternalAccounts];

    const { data: employee } = await supabaseAdmin
      .from("internal_users" as any)
      .select("role, seller_type, auth_user_id")
      .eq("id", data.employeeId)
      .maybeSingle();
    if (!employee) throw new Error("Funcionário não encontrado.");

    const { error } = await supabaseAdmin
      .from("internal_users" as any)
      .update({ role: account.internalRole, seller_type: account.sellerType } as any)
      .eq("id", data.employeeId);
    if (error) throw new Error("Não foi possível atualizar o cargo do funcionário.");

    // profiles.role acompanha internal_users.role pra manter as duas fontes
    // coerentes (profiles.role e' o que o trigger de cadastro grava;
    // internal_users.role e' a fonte editável de verdade depois disso).
    await supabaseAdmin
      .from("profiles")
      .update({ role: account.internalRole } as any)
      .eq("id", (employee as any).auth_user_id);

    await supabaseAdmin.from("internal_audit_logs" as any).insert({
      actor_user_id: context.userId,
      actor_role: "admin",
      action: "alterar_cargo_funcionario_nox",
      table_name: "internal_users",
      record_id: data.employeeId,
      before: { role: (employee as any).role, seller_type: (employee as any).seller_type },
      after: { role: account.internalRole, seller_type: account.sellerType },
    } as any);

    return { ok: true as const };
  });
