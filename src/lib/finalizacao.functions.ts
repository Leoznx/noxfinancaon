import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PAYMENT_DUE_DAYS } from "@/lib/payment-due-date";
import { z } from "zod";

const salvarConfigSchema = z.object({
  consultaId: z.string().uuid(),
  insurance_coverages: z.array(z.string()).default([]),
  insurance_assistance: z.string().nullable(),
  insurance_commission_pct: z.number().min(0).max(20),
  /**
   * Subtipo do imóvel escolhido na tela do seguro. Precisa ser gravado antes de
   * gerar a cobrança: a Edge Function calcula a alíquota do seguro incêndio a
   * partir dele, e se a tela e o banco discordarem o Asaas recusa o pagamento
   * com "O valor do pagamento mudou".
   */
  imovel_subtipo: z.string().trim().min(1).optional(),
});

export const salvarConfiguracaoSeguro = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => salvarConfigSchema.parse(d))
  .handler(async ({ data, context }) => {
    const payload: Record<string, unknown> = {
      insurance_coverages: data.insurance_coverages,
      insurance_assistance: data.insurance_assistance,
      insurance_commission_pct: data.insurance_commission_pct,
    };
    if (data.imovel_subtipo) payload.imovel_subtipo = data.imovel_subtipo;

    const { error } = await context.supabase
      .from("consultas_credito")
      .update(payload as any)
      .eq("id", data.consultaId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const salvarPagamentoSchema = z.object({
  consultaId: z.string().uuid(),
  payment_type: z.enum(["imobiliaria", "inquilino"]),
  insurance_payment_method: z.enum(["credit_card", "pix", "boleto"]),
  insurance_payment_method_label: z.string(),
  billing_due_day: z
    .number()
    .int()
    .refine((value) => PAYMENT_DUE_DAYS.includes(value as (typeof PAYMENT_DUE_DAYS)[number]))
    .optional(),
  property_not_wood_confirmed: z.boolean(),
  terms_accepted: z.boolean(),
});

export const salvarFormaPagamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => salvarPagamentoSchema.parse(d))
  .handler(async ({ data, context }) => {
    if (!data.property_not_wood_confirmed)
      throw new Error("Confirme que o imóvel não é de madeira para continuar.");
    if (!data.terms_accepted) throw new Error("Aceite os Termos e Condições para continuar.");

    const { data: consulta, error: consultaError } = await context.supabase
      .from("consultas_credito")
      .select("tenant_user_id, profile_id_solicitante")
      .eq("id", data.consultaId)
      .single();
    if (consultaError) throw new Error(consultaError.message);

    const { error } = await context.supabase
      .from("consultas_credito")
      .update({
        payment_type: data.payment_type,
        billing_responsible_role: data.payment_type,
        billing_responsible_user_id:
          data.payment_type === "inquilino"
            ? (consulta as any)?.tenant_user_id ?? null
            : (consulta as any)?.profile_id_solicitante ?? null,
        insurance_payment_method: data.insurance_payment_method,
        insurance_payment_method_label: data.insurance_payment_method_label,
        ...(data.billing_due_day ? { billing_due_day: data.billing_due_day } : {}),
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
      descricao: `Responsável pelo pagamento: ${data.payment_type === "imobiliaria" ? "imobiliária" : "inquilino"}. Forma de pagamento do seguro selecionada: ${data.insurance_payment_method_label}.${data.billing_due_day ? ` Vencimento escolhido: dia ${data.billing_due_day}.` : ""} Termos aceitos. Confirmação de imóvel não madeirado realizada.`,
      created_by: context.userId,
    } as any);

    return { ok: true };
  });

const enviarPropostaSchema = z.object({ consultaId: z.string().uuid() });

export const enviarProposta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => enviarPropostaSchema.parse(d))
  .handler(async ({ data, context }) => {
    const now = new Date().toISOString();

    const { error } = await context.supabase
      .from("consultas_credito")
      .update({
        status: "aguardando_ativacao",
        substatus: "aguardando_pagamento_e_assinatura_d4sign",
        proposta_enviada_em: now,
        link_ativacao_enviado_em: null,
        activation_token: null,
        activation_token_expires_at: null,
        activation_status: "aguardando_pagamento_e_assinatura",
        signature_status: "pending",
        policy_status: "issued_pending",
      } as any)
      .eq("id", data.consultaId);
    if (error) throw new Error(error.message);

    const eventos = [
      { tipo: "proposta_registrada", desc: "Proposta registrada com sucesso." },
      {
        tipo: "aguardando_pagamento",
        desc: "Aguardando a confirmação do primeiro pagamento pelo Asaas.",
      },
      {
        tipo: "contrato_d4sign_pendente",
        desc: "O contrato pode ser enviado pela D4Sign enquanto o pagamento permanece pendente.",
      },
    ];
    for (const e of eventos) {
      await context.supabase.from("proposta_historico").insert({
        consulta_id: data.consultaId,
        tipo_evento: e.tipo,
        descricao: e.desc,
        created_by: context.userId,
      } as any);
    }

    return { ok: true, enviadoEm: now };
  });

const pagamentoDepoisSchema = z.object({
  consultaId: z.string().uuid(),
  metodo: z.enum(["pix", "boleto"]),
  valor: z.number().nonnegative().optional(),
  vencimento: z.string().nullable().optional(),
});

/**
 * "Pagar depois": o Pix/boleto já foi gerado e continua válido, mas o usuário
 * optou por não pagar agora. A cobrança fica em aberto na aba de faturas dele e
 * o fluxo documental e a assinatura seguem de forma independente. A cobertura
 * permanece pendente ate assinatura e confirmacao financeira.
 */
export const registrarPagamentoDepois = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => pagamentoDepoisSchema.parse(d))
  .handler(async ({ data, context }) => {
    const metodoLabel = data.metodo === "pix" ? "Pix" : "boleto";
    const valorLabel =
      typeof data.valor === "number" && data.valor > 0
        ? ` no valor de ${data.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`
        : "";
    const vencimentoLabel = data.vencimento ? ` Vencimento em ${data.vencimento}.` : "";

    const { error } = await context.supabase
      .from("consultas_credito")
      .update({
        substatus: "aguardando_pagamento_e_assinatura_d4sign",
        activation_status: "aguardando_pagamento_e_assinatura",
        payment_deferred: true,
        payment_deferred_at: new Date().toISOString(),
        policy_status: "issued_pending",
      } as any)
      .eq("id", data.consultaId);
    if (error) throw new Error(error.message);

    await context.supabase.from("proposta_historico").insert({
      consulta_id: data.consultaId,
      tipo_evento: "pagamento_adiado",
      descricao: `Pagamento adiado pelo usuário: ${metodoLabel}${valorLabel} ficou em aberto na aba de faturas.${vencimentoLabel} A emissão documental e o envio para assinatura continuam; a cobertura permanece pendente até os requisitos contratuais e financeiros serem cumpridos.`,
      created_by: context.userId,
    } as any);

    return { ok: true };
  });

export const listarHistoricoProposta = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ consultaId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: hist, error } = await context.supabase
      .from("proposta_historico")
      .select("id, tipo_evento, descricao, created_at")
      .eq("consulta_id", data.consultaId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { historico: hist ?? [] };
  });
