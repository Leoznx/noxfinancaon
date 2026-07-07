import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const tokenCpfSchema = z.object({
  token: z.string().min(16).max(128),
  cpf: z.string().min(11).max(20),
});

/**
 * Public: valida token + CPF e devolve os dados da proposta para o inquilino.
 * Usa RPC SECURITY DEFINER (não vaza dados sem CPF correto).
 */
export const validarTokenAtivacao = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tokenCpfSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc("validar_ativacao_token" as any, {
      _token: data.token,
      _cpf: data.cpf,
    });
    if (error) throw new Error(error.message);
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
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("consultas_credito")
    .select("id, activation_token, activation_token_expires_at")
    .eq("id", consultaId)
    .single();
  if (error || !data) throw new Error("Proposta não encontrada.");
  if ((data as any).activation_token !== token) throw new Error("Token inválido para esta proposta.");
  const exp = (data as any).activation_token_expires_at;
  if (exp && new Date(exp) < new Date()) throw new Error("Link expirado.");
  return true;
}

/** Etapa 2 - biometria (placeholder): recebe base64 e marca como enviada. */
export const enviarBiometria = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    consultaIdToken.extend({ imageBase64: z.string().min(100) }).parse(d),
  )
  .handler(async ({ data }) => {
    await assertTokenMatch(data.token, data.consultaId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const base64 = data.imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64, "base64");
    const path = `${data.consultaId}/${Date.now()}.jpg`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("biometria-ativacao")
      .upload(path, buffer, { contentType: "image/jpeg", upsert: true });
    if (upErr) throw new Error(upErr.message);

    await supabaseAdmin
      .from("consultas_credito")
      .update({
        biometria_status: "enviada",
        biometria_image_url: path,
        biometria_sent_at: new Date().toISOString(),
      } as any)
      .eq("id", data.consultaId);

    await logEvento(data.consultaId, "biometria_enviada", "Biometria facial enviada pelo inquilino.");
    return { ok: true };
  });

/** Etapa 3 - aceite do contrato. */
export const aceitarContrato = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    consultaIdToken
      .extend({
        userAgent: z.string().optional(),
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
  .inputValidator((d: unknown) =>
    consultaIdToken
      .extend({
        method: z.enum(["credit_card", "pix", "boleto"]),
        methodLabel: z.string(),
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
  .inputValidator((d: unknown) => consultaIdToken.parse(d))
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
    await logEvento(data.consultaId, "ativacao_concluida", "Fiança ativada com sucesso pelo inquilino.");
    return { ok: true, concluidoEm: now };
  });
