import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { enforceSecurityRateLimit } from "@/lib/security-rate-limit.server";

const tokenCpfSchema = z.object({
  token: z.string().min(16).max(128),
  cpf: z.string().min(11).max(20),
});

/**
 * Public: valida token + CPF e devolve os dados da proposta para o inquilino.
 * Usa RPC SECURITY DEFINER (não vaza dados sem CPF correto).
 */
export const validarTokenAtivacao = createServerFn({ method: "POST" })
  .validator((d: unknown) => tokenCpfSchema.parse(d))
  .handler(async ({ data }) => {
    await enforceSecurityRateLimit({
      scope: "activation-validate",
      identifier: data.token,
      limit: 12,
      windowSeconds: 900,
      blockSeconds: 3600,
    });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc("validar_ativacao_token" as any, {
      _token: data.token,
      _cpf: data.cpf,
    });
    if (error) throw new Error("Não foi possível validar o link.");
    const r = result as any;
    if (!r?.ok) {
      const map: Record<string, string> = {
        token_invalido: "Link inválido.",
        token_nao_encontrado: "Link inválido ou inexistente.",
        token_expirado: "Link expirado. Solicite um novo à imobiliária.",
        bloqueado_tentativas: "Muitas tentativas. Entre em contato com o corretor.",
        cpf_invalido: "CPF não corresponde à proposta enviada.",
      };
      throw new Error(map[r?.error] || "Não foi possível validar o link.");
    }
    return r;
  });

const consultaIdToken = z.object({
  token: z.string().min(16),
  consultaId: z.string().uuid(),
});

/** Registra evento no histórico (público — protegido por token+id). */
async function logEvento(consultaId: string, tipo: string, descricao: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("proposta_historico").insert({
    consulta_id: consultaId,
    tipo_evento: tipo,
    descricao,
  } as any);
}

async function assertTokenMatch(token: string, consultaId: string) {
  await enforceSecurityRateLimit({
    scope: "activation-action",
    identifier: token,
    limit: 20,
    windowSeconds: 1800,
    blockSeconds: 3600,
  });
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("consultas_credito")
    .select("id, activation_token, activation_token_expires_at")
    .eq("id", consultaId)
    .single();
  if (error || !data) throw new Error("Proposta não encontrada.");
  const expected = new TextEncoder().encode(String((data as any).activation_token || ""));
  const received = new TextEncoder().encode(token);
  if (expected.length !== received.length) throw new Error("Token inválido para esta proposta.");
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1)
    difference |= expected[index] ^ received[index];
  if (difference !== 0) throw new Error("Token inválido para esta proposta.");
  const exp = (data as any).activation_token_expires_at;
  if (exp && new Date(exp) < new Date()) throw new Error("Link expirado.");
  return true;
}

/** Etapa 2 - biometria (placeholder): recebe base64 e marca como enviada. */
export const enviarBiometria = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    consultaIdToken.extend({ imageBase64: z.string().min(100).max(7_100_000) }).parse(d),
  )
  .handler(async ({ data }) => {
    await assertTokenMatch(data.token, data.consultaId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/]+={0,2})$/.exec(
      data.imageBase64,
    );
    if (!match) throw new Error("Imagem inválida. Use JPEG, PNG ou WebP.");
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.byteLength < 100 || buffer.byteLength > 5 * 1024 * 1024) {
      throw new Error("A imagem deve ter no máximo 5 MB.");
    }
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isPng = buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isWebp =
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP";
    const detectedType = isJpeg ? "image/jpeg" : isPng ? "image/png" : isWebp ? "image/webp" : null;
    if (!detectedType || detectedType !== match[1])
      throw new Error("O conteúdo do arquivo não corresponde ao formato informado.");
    const extension = detectedType === "image/jpeg" ? "jpg" : detectedType.split("/")[1];
    const path = `${data.consultaId}/${crypto.randomUUID()}.${extension}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("biometria-ativacao")
      .upload(path, buffer, { contentType: detectedType, upsert: false });
    if (upErr) throw new Error("Não foi possível armazenar a biometria.");

    await supabaseAdmin
      .from("consultas_credito")
      .update({
        biometria_status: "enviada",
        biometria_image_url: path,
        biometria_sent_at: new Date().toISOString(),
      } as any)
      .eq("id", data.consultaId);

    await logEvento(
      data.consultaId,
      "biometria_enviada",
      "Biometria facial enviada pelo inquilino.",
    );
    return { ok: true };
  });

/** Etapa 3 - aceite do contrato. */
export const aceitarContrato = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    consultaIdToken
      .extend({
        userAgent: z.string().max(512).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await assertTokenMatch(data.token, data.consultaId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    await supabaseAdmin
      .from("consultas_credito")
      .update({
        contract_accepted: true,
        contract_accepted_at: now,
        terms_accepted: true,
        terms_accepted_at: now,
        accepted_user_agent: data.userAgent ?? null,
      } as any)
      .eq("id", data.consultaId);
    await logEvento(data.consultaId, "termos_aceitos", "Termos e contrato aceitos pelo inquilino.");
    return { ok: true };
  });

/** Etapa 4 - confirma forma de pagamento. */
export const confirmarPagamento = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    consultaIdToken
      .extend({
        method: z.enum(["credit_card", "pix", "boleto"]),
        methodLabel: z.string().trim().min(2).max(40),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await assertTokenMatch(data.token, data.consultaId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("consultas_credito")
      .update({
        insurance_payment_method: data.method,
        insurance_payment_method_label: data.methodLabel,
        payment_status: "gerado",
      } as any)
      .eq("id", data.consultaId);
    await logEvento(
      data.consultaId,
      "pagamento_gerado",
      `Forma de pagamento selecionada: ${data.methodLabel}.`,
    );
    return { ok: true };
  });

/** Etapa 5 - conclui ativação. */
export const concluirAtivacao = createServerFn({ method: "POST" })
  .validator((d: unknown) => consultaIdToken.parse(d))
  .handler(async ({ data }) => {
    await assertTokenMatch(data.token, data.consultaId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    await supabaseAdmin
      .from("consultas_credito")
      .update({
        status: "ativado",
        activation_status: "concluido",
        activation_completed_at: now,
        payment_status: "aprovado",
        payment_confirmed_at: now,
      } as any)
      .eq("id", data.consultaId);
    await logEvento(
      data.consultaId,
      "ativacao_concluida",
      "Fiança ativada com sucesso pelo inquilino.",
    );
    return { ok: true, concluidoEm: now };
  });
