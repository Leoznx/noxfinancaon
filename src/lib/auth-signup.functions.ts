import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { sendVerificationEmail } from "@/lib/resend.service";
import { linkTenantRecordsByCpf } from "@/lib/inquilino-signup.functions";
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

async function emailAlreadyRegistered(supabaseAdmin: any, email: string) {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  return !!data;
}

function isAlreadyRegisteredError(message: string | undefined) {
  return /already.*registered/i.test(message || "");
}

// ============================================================================
// Lista pública controlada para o cadastro de corretores. A consulta usa o
// servidor porque o visitante ainda não possui sessão e recebe somente os dois
// campos necessários para escolher a empresa.
export const listarImobiliariasCadastro = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("imobiliarias")
    .select("id, razao_social")
    .order("razao_social", { ascending: true });

  if (error) throw new Error("Não foi possível carregar as imobiliárias.");

  return {
    imobiliarias: (data ?? []).map((imobiliaria: { id: string; razao_social: string }) => ({
      id: imobiliaria.id,
      razaoSocial: imobiliaria.razao_social,
    })),
  };
});

// ============================================================================
// Inquilino
// ============================================================================

const inquilinoSchema = z.object({
  nome: z.string().min(3),
  cpf: z.string().min(11).max(20),
  email: z.string().email(),
  telefone: z.string().min(8),
  senha: z.string().min(8),
});

export const signUpInquilino = createServerFn({ method: "POST" })
  .validator((data: unknown) => inquilinoSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cpfNorm = data.cpf.replace(/\D/g, "");
    const emailLower = data.email.toLowerCase().trim();

    if (await emailAlreadyRegistered(supabaseAdmin, emailLower)) {
      return { ok: false as const, error: "ja_existe" as const };
    }
    const { data: byCpf } = await supabaseAdmin
      .from("inquilinos")
      .select("id, profile_id")
      .eq("cpf", cpfNorm)
      .maybeSingle();
    if ((byCpf as any)?.profile_id) {
      return { ok: false as const, error: "ja_existe" as const };
    }

    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "signup",
      email: emailLower,
      password: data.senha,
      options: {
        data: { nome: data.nome, role: "inquilino", cpf: cpfNorm, telefone: data.telefone },
      },
    });

    if (linkError || !linkData?.user) {
      return {
        ok: false as const,
        error: isAlreadyRegisteredError(linkError?.message)
          ? ("ja_existe" as const)
          : ("erro" as const),
      };
    }

    const userId = linkData.user.id;

    await supabaseAdmin
      .from("profiles")
      .update({
        status: "ativo",
        nome: data.nome,
        telefone: data.telefone,
        role: "inquilino",
      } as any)
      .eq("id", userId);

    // Foto de perfil padrão (por gênero detectado no primeiro nome) — só se o
    // usuário ainda não tiver nenhuma (perfil recém-criado, mas o .is() é uma
    // garantia extra contra sobrescrever uma foto já existente).
    await supabaseAdmin
      .from("profiles")
      .update({ avatar_url: defaultAvatarForName(data.nome) } as any)
      .eq("id", userId)
      .is("avatar_url", null);

    await supabaseAdmin
      .from("inquilinos")
      .upsert({ profile_id: userId, nome: data.nome, cpf: cpfNorm, tipo: "PF" } as any, {
        onConflict: "cpf",
      });

    const { linkedConsultas } = await linkTenantRecordsByCpf(supabaseAdmin, userId, cpfNorm);

    const emailResult = await sendVerificationEmail({
      email: emailLower,
      nome: data.nome,
      verificationLink: buildVerificationLink(linkData.properties),
    });

    return {
      ok: true as const,
      userId,
      emailSent: emailResult.sent,
      linkedConsultas,
    };
  });

// ============================================================================
// Imobiliária / Corretor / Proprietário
// ============================================================================

const profissionalSchema = z.object({
  role: z.enum(["imobiliaria", "corretor", "proprietario"]),
  email: z.string().email(),
  senha: z.string().min(8),
  telefone: z.string().min(8),
  // Imobiliária
  razaoSocial: z.string().optional(),
  nomeFantasia: z.string().optional(),
  cnpj: z.string().optional(),
  creciJuridico: z.string().optional(),
  cargo: z.string().optional(),
  responsavelNome: z.string().optional(),
  // Corretor
  nome: z.string().optional(),
  cpf: z.string().optional(),
  creci: z.string().optional(),
  vinculadoImobiliaria: z.boolean().optional(),
  imobiliariaId: z.string().optional(),
  // Proprietário
  cpfCnpj: z.string().optional(),
  // Comuns a corretor/proprietário
  cidade: z.string().optional(),
  estado: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.role === "corretor" && data.vinculadoImobiliaria && !data.imobiliariaId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["imobiliariaId"],
      message: "Selecione a imobiliária à qual o corretor está vinculado.",
    });
  }
});

export const signUpProfissional = createServerFn({ method: "POST" })
  .validator((data: unknown) => profissionalSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const emailLower = data.email.toLowerCase().trim();

    if (await emailAlreadyRegistered(supabaseAdmin, emailLower)) {
      return { ok: false as const, error: "ja_existe" as const };
    }

    if (data.role === "corretor" && data.vinculadoImobiliaria) {
      const { data: imobiliaria, error: imobiliariaError } = await supabaseAdmin
        .from("imobiliarias")
        .select("id")
        .eq("id", data.imobiliariaId!)
        .maybeSingle();
      if (imobiliariaError || !imobiliaria) {
        return { ok: false as const, error: "imobiliaria_nao_encontrada" as const };
      }
    }

    const nomeExibicao = data.role === "imobiliaria" ? data.razaoSocial! : data.nome!;

    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "signup",
      email: emailLower,
      password: data.senha,
      options: {
        data: { nome: nomeExibicao, role: data.role },
      },
    });

    if (linkError || !linkData?.user) {
      return {
        ok: false as const,
        error: isAlreadyRegisteredError(linkError?.message)
          ? ("ja_existe" as const)
          : ("erro" as const),
      };
    }

    const userId = linkData.user.id;

    await supabaseAdmin
      .from("profiles")
      .update({ status: "pendente_aprovacao", nome: nomeExibicao, telefone: data.telefone } as any)
      .eq("id", userId);

    // Foto de perfil padrão (por gênero detectado no primeiro nome) — só se o
    // usuário ainda não tiver nenhuma. Pra imobiliária, usa o nome do
    // responsável (pessoa física) em vez da razão social da empresa.
    const nomePessoaFisica = data.role === "imobiliaria" ? data.responsavelNome : data.nome;
    await supabaseAdmin
      .from("profiles")
      .update({ avatar_url: defaultAvatarForName(nomePessoaFisica) } as any)
      .eq("id", userId)
      .is("avatar_url", null);

    if (data.role === "imobiliaria") {
      await supabaseAdmin.from("imobiliarias").insert({
        razao_social: data.razaoSocial,
        nome_fantasia: data.nomeFantasia,
        cnpj: data.cnpj,
        creci: data.creciJuridico,
        cargo: data.cargo,
        cidade: data.cidade,
        estado: data.estado,
        contato_nome: data.responsavelNome,
        contato_email: emailLower,
        contato_telefone: data.telefone,
      } as any);
    } else if (data.role === "corretor") {
      await supabaseAdmin.from("corretores").insert({
        profile_id: userId,
        cpf: data.cpf,
        creci: data.creci,
        cidade: data.cidade,
        estado: data.estado,
        vinculado_imobiliaria: data.vinculadoImobiliaria ?? false,
        imobiliaria_id: data.vinculadoImobiliaria ? data.imobiliariaId : null,
      } as any);
    } else if (data.role === "proprietario") {
      await supabaseAdmin.from("proprietarios").insert({
        profile_id: userId,
        nome: data.nome,
        cpf_cnpj: data.cpfCnpj,
        email: emailLower,
        telefone: data.telefone,
      } as any);
    }

    const emailResult = await sendVerificationEmail({
      email: emailLower,
      nome: nomeExibicao,
      verificationLink: buildVerificationLink(linkData.properties),
    });

    return { ok: true as const, userId, emailSent: emailResult.sent };
  });

// ============================================================================
// Reenvio de e-mail de verificação
// ============================================================================

const resendSchema = z.object({
  email: z.string().email(),
});

const RESEND_MIN_INTERVAL_MS = 60_000;
const RESEND_MAX_PER_HOUR = 5;

/**
 * Sempre responde { ok: true } — nunca revela se o e-mail existe, já foi
 * confirmado, ou bateu no rate limit (evita enumeração de contas). O
 * trabalho de verificar/enviar acontece por trás, silenciosamente.
 */
export const resendVerificationEmail = createServerFn({ method: "POST" })
  .validator((data: unknown) => resendSchema.parse(data))
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

      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById((profile as any).id);
      if (!authUser?.user || authUser.user.email_confirmed_at) return { ok: true as const };

      const now = Date.now();
      const { data: recentSends } = await supabaseAdmin
        .from("email_verification_sends")
        .select("sent_at")
        .eq("email", emailLower)
        .gte("sent_at", new Date(now - 60 * 60 * 1000).toISOString());

      const sends = (recentSends ?? []) as { sent_at: string }[];
      const lastSentTooRecently = sends.some(
        (s) => now - new Date(s.sent_at).getTime() < RESEND_MIN_INTERVAL_MS,
      );
      if (lastSentTooRecently || sends.length >= RESEND_MAX_PER_HOUR) {
        return { ok: true as const };
      }

      const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email: emailLower,
      });
      if (linkError || !linkData?.properties?.hashed_token) return { ok: true as const };

      await sendVerificationEmail({
        email: emailLower,
        nome: (profile as any).nome || "cliente",
        verificationLink: buildVerificationLink(linkData.properties),
      });

      await supabaseAdmin.from("email_verification_sends").insert({ email: emailLower } as any);
    } catch (e) {
      console.error("[resendVerificationEmail] erro inesperado:", e);
    }

    return { ok: true as const };
  });
