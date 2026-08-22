import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
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
  insurance_payment_method: z.enum(["credit_card", "pix", "boleto"]),
  insurance_payment_method_label: z.string(),
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
  .validator((d: unknown) => enviarPropostaSchema.parse(d))
  .handler(async ({ data, context }) => {
    const now = new Date().toISOString();

    const { error } = await context.supabase
      .from("consultas_credito")
      .update({
        status: "aguardando_ativacao",
        substatus: "aguardando_pagamento",
        proposta_enviada_em: now,
        link_ativacao_enviado_em: null,
        activation_token: null,
        activation_token_expires_at: null,
        activation_status: "aguardando_pagamento",
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
        desc: "O contrato será enviado pela D4Sign após a confirmação do pagamento.",
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
 * o contrato só segue para assinatura quando o Asaas confirmar o pagamento —
 * é exatamente o mesmo gatilho do fluxo normal, nada é liberado antes.
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
        substatus: "aguardando_pagamento",
        activation_status: "aguardando_pagamento",
        payment_deferred: true,
        payment_deferred_at: new Date().toISOString(),
      } as any)
      .eq("id", data.consultaId);
    if (error) throw new Error(error.message);

    await context.supabase.from("proposta_historico").insert({
      consulta_id: data.consultaId,
      tipo_evento: "pagamento_adiado",
      descricao: `Pagamento adiado pelo usuário: ${metodoLabel}${valorLabel} ficou em aberto na aba de faturas.${vencimentoLabel} O envio para assinatura acontece somente após a confirmação do primeiro pagamento.`,
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
