import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  AsaasApiError,
  MESES_PT,
  addBusinessDays,
  asaasFetch,
  calculateMonthlyInstallmentValue,
  corsHeaders,
  formatBRL,
  formatDateBr,
  generateInstallmentSchedule,
  jsonResponse,
  logFinancialNotification,
  mapAsaasStatus,
  requireUser,
  resolvePaymentRecipient,
  sanitizeAsaasResponse,
  sendInstallmentScheduleEmail,
  sendInstallmentScheduleSms,
  sendPaymentWhatsapp,
  toMoney,
  wasNotificationSent,
} from "../_shared/asaas.ts";
import { ensureAsaasCustomer } from "../_shared/asaas-customer.ts";

const INSTALLMENT_COUNT = 12;

type Body = {
  proposalId?: string;
  consultationId?: string;
  amount?: number;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST")
    return jsonResponse(req, { ok: false, error: "Metodo nao permitido." }, 405);

  try {
    const { supabase, user } = await requireUser(req);
    const body = (await req.json()) as Body;
    const proposalId = body.proposalId || body.consultationId;
    if (!proposalId)
      return jsonResponse(req, { ok: false, error: "Proposta nao encontrada." }, 400);

    const { data: consulta, error: consultaError } = await supabase
      .from("consultas_credito")
      .select(
        "*, inquilinos(*), imoveis(*), planos(*), responsavel_profile:profiles!consultas_credito_profile_id_solicitante_fkey(nome, email, telefone)",
      )
      .eq("id", proposalId)
      .maybeSingle();
    if (consultaError) throw consultaError;
    if (!consulta) return jsonResponse(req, { ok: false, error: "Proposta nao encontrada." }, 404);

    // consultas_credito não possui coluna apolice_id. Resolve a apólice pelo
    // relacionamento real antes de criar as parcelas, garantindo que o evento
    // de pagamento consiga localizar o contrato que gerou a comissão.
    const { data: apolice, error: apoliceError } = await supabase
      .from("apolices")
      .select("id")
      .eq("consulta_id", proposalId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (apoliceError) throw apoliceError;

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    const role = profile?.role;
    const allowed =
      consulta.profile_id_solicitante === user.id ||
      consulta.tenant_user_id === user.id ||
      consulta.billing_responsible_user_id === user.id ||
      ["admin", "financeiro", "corretor", "imobiliaria"].includes(role);
    if (!allowed) return jsonResponse(req, { ok: false, error: "Acesso nao autorizado." }, 403);

    const recipient = resolvePaymentRecipient(consulta);
    if (recipient.paymentResponsible !== "tenant") {
      return jsonResponse(
        req,
        { ok: false, error: "Este fluxo de 12 boletos e so para pagamento pelo inquilino." },
        400,
      );
    }

    const monthlyValue = calculateMonthlyInstallmentValue(consulta);
    if (monthlyValue <= 0)
      return jsonResponse(req, { ok: false, error: "Nao foi possivel calcular o valor da mensalidade." }, 400);
    if (body.amount != null && Math.abs(toMoney(body.amount) - monthlyValue) > 0.02) {
      return jsonResponse(
        req,
        { ok: false, error: "O valor da mensalidade mudou. Atualize a pagina e tente novamente.", expectedAmount: monthlyValue },
        409,
      );
    }

    const { data: existentes, error: existentesError } = await supabase
      .from("faturas_inquilino")
      .select("*, asaas_payment:asaas_payments(*)")
      .eq("consulta_id", proposalId)
      .order("numero_parcela", { ascending: true });
    if (existentesError) throw existentesError;

    const jaCriadas = new Map<number, any>((existentes ?? []).map((f: any) => [f.numero_parcela, f]));

    if (jaCriadas.size >= INSTALLMENT_COUNT) {
      return jsonResponse(req, buildResponse([...jaCriadas.values()], recipient));
    }

    const primeiroVencimento = jaCriadas.size > 0 ? null : addBusinessDays(3);
    const schedule = generateInstallmentSchedule({
      firstDueDate: primeiroVencimento || (existentes?.[0]?.vencimento ?? addBusinessDays(3)),
      count: INSTALLMENT_COUNT,
    });

    const customerId = await ensureAsaasCustomer(supabase, consulta);
    const criadas: any[] = [...jaCriadas.values()];

    for (const item of schedule) {
      if (jaCriadas.has(item.installmentNumber)) continue;

      const externalReference = `nox:consulta:${proposalId}:installment:${item.installmentNumber}`;
      const description = `NOX Fiança — Mensalidade ${item.installmentNumber}/${INSTALLMENT_COUNT} — ${MESES_PT[item.referenceMonth - 1]} de ${item.referenceYear}`;

      let raw: any;
      try {
        raw = await asaasFetch("/payments", {
          method: "POST",
          body: JSON.stringify({
            customer: customerId,
            billingType: "BOLETO",
            value: monthlyValue,
            dueDate: item.dueDate,
            description,
            externalReference,
          }),
        });
      } catch (error) {
        console.error("[asaas-create-installment-plan] falha ao criar parcela", {
          proposalId,
          installmentNumber: item.installmentNumber,
          status: error instanceof AsaasApiError ? error.status : "unknown",
        });
        // Nao tenta as proximas - preserva o que ja foi criado (nunca apaga),
        // e uma nova chamada a esta funcao retoma exatamente daqui.
        return jsonResponse(
          req,
          {
            ok: false,
            error: `Nao foi possivel gerar a mensalidade ${item.installmentNumber}/${INSTALLMENT_COUNT}. As mensalidades ja criadas foram preservadas. Tente novamente.`,
            created: criadas.length,
            total: INSTALLMENT_COUNT,
          },
          502,
        );
      }

      const sanitized = sanitizeAsaasResponse(raw);
      const internalStatus = mapAsaasStatus(raw?.status);

      const { data: pagamento, error: pagamentoError } = await supabase
        .from("asaas_payments")
        .insert({
          consultation_id: proposalId,
          proposal_id: proposalId,
          plan_id: consulta.plano_id,
          user_id: user.id,
          tenant_user_id: consulta.tenant_user_id,
          asaas_customer_id: customerId,
          asaas_payment_id: raw?.id || null,
          external_reference: externalReference,
          idempotency_key: externalReference,
          payment_method: "boleto",
          value: monthlyValue,
          status: internalStatus,
          due_date: item.dueDate,
          boleto_url: raw?.bankSlipUrl || raw?.invoiceUrl || null,
          boleto_barcode: raw?.identificationField || raw?.nossoNumero || null,
          raw_response: sanitized,
          payment_responsible: recipient.paymentResponsible,
          recipient_type: recipient.recipientType,
          recipient_user_id: recipient.recipientUserId,
          recipient_tenant_id: recipient.recipientTenantId,
          recipient_name: recipient.recipientName,
          recipient_email: recipient.recipientEmail,
          recipient_phone: recipient.recipientPhone,
        })
        .select()
        .maybeSingle();
      if (pagamentoError) {
        console.error("[asaas-create-installment-plan] falha ao salvar asaas_payments", {
          proposalId,
          installmentNumber: item.installmentNumber,
          error: pagamentoError.message,
        });
      }

      const { data: fatura, error: faturaError } = await supabase
        .from("faturas_inquilino")
        .insert({
          apolice_id: apolice?.id || null,
          consulta_id: proposalId,
          tenant_user_id: consulta.tenant_user_id,
          numero_parcela: item.installmentNumber,
          installment_total: INSTALLMENT_COUNT,
          vencimento: item.dueDate,
          valor: monthlyValue,
          status: internalStatus,
          boleto_url: raw?.bankSlipUrl || raw?.invoiceUrl || null,
          linha_digitavel: raw?.identificationField || raw?.nossoNumero || null,
          payment_responsible: recipient.paymentResponsible,
          recipient_user_id: recipient.recipientUserId,
          asaas_payment_id: pagamento?.id || null,
        })
        .select()
        .maybeSingle();
      if (faturaError) {
        console.error("[asaas-create-installment-plan] falha ao salvar faturas_inquilino", {
          proposalId,
          installmentNumber: item.installmentNumber,
          error: faturaError.message,
        });
      }

      criadas.push({ ...fatura, asaas_payment: pagamento });
    }

    // So dispara o e-mail/SMS consolidados quando as 12 estao completas -
    // idempotente via financial_notifications, entao uma re-chamada que so
    // retoma parcelas faltando nunca reenvia.
    if (criadas.length >= INSTALLMENT_COUNT && recipient.recipientEmail) {
      const jaEnviadoEmail = await wasNotificationSent(supabase, {
        invoiceId: criadas[0]?.id,
        channel: "email",
        notificationType: "billing_schedule_created",
      });
      if (!jaEnviadoEmail) {
        const resultado = await sendInstallmentScheduleEmail({
          to: recipient.recipientEmail,
          nome: recipient.recipientName || "cliente",
          installments: criadas.map((f) => ({
            installmentNumber: f.numero_parcela,
            dueDate: f.vencimento,
            referenceMonth: Number(String(f.vencimento).split("-")[1]),
            referenceYear: Number(String(f.vencimento).split("-")[0]),
            value: Number(f.valor),
          })),
        });
        await logFinancialNotification(supabase, {
          invoiceId: criadas[0]?.id,
          recipientType: recipient.recipientType,
          recipientId: recipient.recipientTenantId || recipient.recipientUserId,
          channel: "email",
          notificationType: "billing_schedule_created",
          result: resultado,
        });
      }
    }
    if (criadas.length >= INSTALLMENT_COUNT && recipient.recipientPhone) {
      const jaEnviadoSms = await wasNotificationSent(supabase, {
        invoiceId: criadas[0]?.id,
        channel: "sms",
        notificationType: "billing_schedule_created",
      });
      if (!jaEnviadoSms) {
        const resultado = await sendInstallmentScheduleSms({
          to: recipient.recipientPhone,
          installments: criadas.map((f) => ({
            installmentNumber: f.numero_parcela,
            dueDate: f.vencimento,
            referenceMonth: Number(String(f.vencimento).split("-")[1]),
            referenceYear: Number(String(f.vencimento).split("-")[0]),
            value: Number(f.valor),
          })),
        });
        await logFinancialNotification(supabase, {
          invoiceId: criadas[0]?.id,
          recipientType: recipient.recipientType,
          recipientId: recipient.recipientTenantId || recipient.recipientUserId,
          channel: "sms",
          notificationType: "billing_schedule_created",
          result: resultado,
        });
        // WhatsApp segue o mesmo gate de idempotencia - so tenta enviar (e so
        // funciona de verdade quando WHATSAPP_API_KEY/WHATSAPP_PROVIDER_URL
        // existirem; ate la so registra "not_configured").
        const jaEnviadoWhatsapp = await wasNotificationSent(supabase, {
          invoiceId: criadas[0]?.id,
          channel: "whatsapp",
          notificationType: "billing_schedule_created",
        });
        if (!jaEnviadoWhatsapp) {
          const primeira = criadas[0];
          const resultadoWpp = await sendPaymentWhatsapp({
            to: recipient.recipientPhone,
            mensagem: `Olá, ${recipient.recipientName || "cliente"}. Os ${INSTALLMENT_COUNT} boletos mensais da NOX Fiança foram gerados. Primeira mensalidade: ${formatBRL(Number(primeira.valor))}, vencimento ${formatDateBr(primeira.vencimento)}. Acesse sua conta para visualizar ou pagar o boleto.`,
          });
          await logFinancialNotification(supabase, {
            invoiceId: criadas[0]?.id,
            recipientType: recipient.recipientType,
            recipientId: recipient.recipientTenantId || recipient.recipientUserId,
            channel: "whatsapp",
            notificationType: "billing_schedule_created",
            result: resultadoWpp,
          });
        }
      }
    }

    return jsonResponse(req, buildResponse(criadas, recipient));
  } catch (error) {
    console.error("[asaas-create-installment-plan] erro", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(req, { ok: false, error: "Nao foi possivel gerar os boletos agora." }, 500);
  }
});

function maskEmailLocal(email?: string | null) {
  if (!email) return null;
  const [u, domain] = email.split("@");
  if (!domain) return email;
  return `${u.slice(0, 2)}${"*".repeat(Math.max(u.length - 2, 2))}@${domain}`;
}

function maskPhoneLocal(phone?: string | null) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length < 4) return phone;
  return `+55 (***) *****-${digits.slice(-4)}`;
}

function buildResponse(faturas: any[], recipient: ReturnType<typeof resolvePaymentRecipient>) {
  const ordenadas = [...faturas].sort((a, b) => a.numero_parcela - b.numero_parcela);
  return {
    success: true,
    installmentTotal: INSTALLMENT_COUNT,
    installments: ordenadas.map((f) => ({
      installmentNumber: f.numero_parcela,
      dueDate: f.vencimento,
      value: Number(f.valor),
      status: f.status,
      boletoUrl: f.boleto_url,
      boletoBarcode: f.linha_digitavel,
      faturaId: f.id,
    })),
    recipient: {
      responsible: recipient.paymentResponsible,
      type: recipient.recipientType,
      emailMasked: maskEmailLocal(recipient.recipientEmail),
      phoneMasked: maskPhoneLocal(recipient.recipientPhone),
    },
  };
}
