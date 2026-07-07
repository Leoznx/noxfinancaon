import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const salvarConfigSchema = z.object({
  consultaId: z.string().uuid(),
  insurance_coverages: z.array(z.string()).default([]),
  insurance_assistance: z.string().nullable(),
  insurance_commission_pct: z.number().min(0).max(20),
});

export const salvarConfiguracaoSeguro = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => salvarConfigSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("consultas_credito")
      .update({
        insurance_coverages: data.insurance_coverages,
        insurance_assistance: data.insurance_assistance,
        insurance_commission_pct: data.insurance_commission_pct,
      } as any)
      .eq("id", data.consultaId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const salvarPagamentoSchema = z.object({
  consultaId: z.string().uuid(),
  insurance_payment_method: z.enum(["credit_card", "pix", "boleto"]),
  insurance_payment_method_label: z.string(),
  property_not_wood_confirmed: z.boolean(),
  terms_accepted: z.boolean(),
});

export const salvarFormaPagamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => salvarPagamentoSchema.parse(d))
  .handler(async ({ data, context }) => {
    if (!data.property_not_wood_confirmed) throw new Error("Confirme que o imóvel não é de madeira para continuar.");
    if (!data.terms_accepted) throw new Error("Aceite os Termos e Condições para continuar.");

    const { error } = await context.supabase
      .from("consultas_credito")
      .update({
        insurance_payment_method: data.insurance_payment_method,
        insurance_payment_method_label: data.insurance_payment_method_label,
        property_not_wood_confirmed: true,
        terms_accepted: true,
        terms_accepted_at: new Date().toISOString(),
        insurance_restriction_warning_acknowledged: true,
      } as any)
      .eq("id", data.consultaId);
    if (error) throw new Error(error.message);

    await context.supabase.from("proposta_historico").insert({
      consulta_id: data.consultaId,
      tipo_evento: "pagamento_selecionado",
      descricao: `Forma de pagamento do seguro selecionada: ${data.insurance_payment_method_label}. Termos aceitos. Confirmação de imóvel não madeirado realizada.`,
      created_by: context.userId,
    } as any);

    return { ok: true };
  });

const enviarPropostaSchema = z.object({ consultaId: z.string().uuid() });

export const enviarProposta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => enviarPropostaSchema.parse(d))
  .handler(async ({ data, context }) => {
    const now = new Date().toISOString();
    // Gera token único e validade de 30 dias
    const token =
      (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)) +
      "-" +
      Math.random().toString(36).slice(2) +
      Date.now().toString(36);
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await context.supabase
      .from("consultas_credito")
      .update({
        status: "aguardando_ativacao",
        substatus: "aguardando_assinatura",
        proposta_enviada_em: now,
        link_ativacao_enviado_em: now,
        activation_token: token,
        activation_token_expires_at: expires,
        activation_status: "pendente",
      } as any)
      .eq("id", data.consultaId);
    if (error) throw new Error(error.message);

    const eventos = [
      { tipo: "proposta_enviada", desc: "Proposta enviada com sucesso." },
      { tipo: "link_gerado", desc: `Link de ativação gerado: /ativar-fianca/${token}` },
      { tipo: "link_email", desc: "Link de ativação enviado por e-mail ao inquilino." },
      { tipo: "link_sms", desc: "Link de ativação enviado por SMS ao inquilino." },
      { tipo: "aguardando_assinatura", desc: "Aguardando ativação do inquilino." },
    ];
    for (const e of eventos) {
      await context.supabase.from("proposta_historico").insert({
        consulta_id: data.consultaId,
        tipo_evento: e.tipo,
        descricao: e.desc,
        created_by: context.userId,
      } as any);
    }

    return { ok: true, enviadoEm: now, activationToken: token, activationUrl: `/ativar-fianca/${token}` };
  });


export const listarHistoricoProposta = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ consultaId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: hist, error } = await context.supabase
      .from("proposta_historico")
      .select("id, tipo_evento, descricao, created_at")
      .eq("consulta_id", data.consultaId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { historico: hist ?? [] };
  });
