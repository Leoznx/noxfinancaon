import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  AsaasApiError,
  FireMode,
  PaymentMethod,
  asaasFetch,
  buildExternalReference,
  calculateExpectedPayment,
  corsHeaders,
  jsonResponse,
  mapAsaasStatus,
  normalizedPaymentResponse,
  refetchPixQrCode,
  requireUser,
  resolvePaymentRecipient,
  sanitizeAsaasResponse,
  sendPaymentEmail,
  sendPaymentSms,
  todayDate,
  addBusinessDays,
  toMoney,
} from "../_shared/asaas.ts";
import { ensureAsaasCustomer } from "../_shared/asaas-customer.ts";

type Body = {
  proposalId?: string;
  consultationId?: string;
  paymentMethod?: PaymentMethod;
  selectedFireInsuranceMode?: FireMode;
  amount?: number;
  creditCard?: {
    holderName?: string;
    number?: string;
    expiryMonth?: string;
    expiryYear?: string;
    ccv?: string;
  };
  creditCardHolderInfo?: {
    name?: string;
    email?: string;
    cpfCnpj?: string;
    postalCode?: string;
    addressNumber?: string;
    phone?: string;
  };
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST")
    return jsonResponse(req, { ok: false, error: "Metodo nao permitido." }, 405);

  try {
    const { supabase, user } = await requireUser(req);
    const body = (await req.json()) as Body;
    const proposalId = body.proposalId || body.consultationId;
    const paymentMethod = body.paymentMethod;
    const fireMode = body.selectedFireInsuranceMode || "embutido";

    if (!proposalId)
      return jsonResponse(req, { ok: false, error: "Proposta nao encontrada." }, 400);
    if (!paymentMethod || !["pix", "boleto", "credit_card"].includes(paymentMethod)) {
      return jsonResponse(req, { ok: false, error: "Selecione uma forma de pagamento." }, 400);
    }

    const { data: consulta, error: consultaError } = await supabase
      .from("consultas_credito")
      .select(
        "*, inquilinos(*), imoveis(*), planos(*), responsavel_profile:profiles!consultas_credito_profile_id_solicitante_fkey(nome, email, telefone)",
      )
      .eq("id", proposalId)
      .maybeSingle();
    if (consultaError) throw consultaError;
    if (!consulta) return jsonResponse(req, { ok: false, error: "Proposta nao encontrada." }, 404);

    const recipient = resolvePaymentRecipient(consulta);

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

    const expectedAmount = calculateExpectedPayment(consulta, fireMode);
    const requestedAmount = toMoney(body.amount || expectedAmount);
    if (expectedAmount <= 0)
      return jsonResponse(
        req,
        { ok: false, error: "Nao foi possivel calcular o valor do pagamento." },
        400,
      );
    if (Math.abs(requestedAmount - expectedAmount) > 0.02) {
      return jsonResponse(
        req,
        {
          ok: false,
          error: "O valor do pagamento mudou. Atualize a pagina e tente novamente.",
          expectedAmount,
        },
        409,
      );
    }

    const externalReference = buildExternalReference({
      consultationId: proposalId,
      paymentMethod,
      fireMode,
      amount: expectedAmount,
    });

    const { data: existente } = await supabase
      .from("asaas_payments")
      .select("*")
      .eq("idempotency_key", externalReference)
      .maybeSingle();

    if (existente) {
      // Cobranca ja existe no Asaas - nunca recriar. Se for Pix e a busca do
      // QR Code tiver falhado na tentativa anterior, tenta buscar de novo em
      // vez de servir pra sempre a mesma resposta incompleta (bug do
      // "Embutir na parcela" travado sem QR Code / copia-e-cola).
      const atualizado =
        paymentMethod === "pix" ? await refetchPixQrCode(supabase, existente) : existente;
      return jsonResponse(req, normalizedPaymentResponse(atualizado.raw_response, atualizado));
    }

    const customerId = await ensureAsaasCustomer(supabase, consulta);
    const dueDate = paymentMethod === "boleto" ? addBusinessDays(3) : todayDate();
    const billingType =
      paymentMethod === "pix" ? "PIX" : paymentMethod === "boleto" ? "BOLETO" : "CREDIT_CARD";

    const payload: Record<string, unknown> = {
      customer: customerId,
      billingType,
      value: expectedAmount,
      dueDate,
      description: `NOX Fianca - proposta ${String(proposalId).slice(0, 8).toUpperCase()}`,
      externalReference,
    };

    if (paymentMethod === "credit_card") {
      const cc = body.creditCard || {};
      const holder = body.creditCardHolderInfo || {};
      if (!cc.holderName || !cc.number || !cc.expiryMonth || !cc.expiryYear || !cc.ccv) {
        return jsonResponse(req, { ok: false, error: "Preencha todos os dados do cartao." }, 400);
      }
      if (
        !holder.name ||
        !holder.email ||
        !holder.cpfCnpj ||
        !holder.postalCode ||
        !holder.addressNumber ||
        !holder.phone
      ) {
        return jsonResponse(
          req,
          { ok: false, error: "Preencha os dados do titular do cartao." },
          400,
        );
      }
      payload.creditCard = {
        holderName: cc.holderName,
        number: String(cc.number).replace(/\s/g, ""),
        expiryMonth: cc.expiryMonth,
        expiryYear: cc.expiryYear,
        ccv: cc.ccv,
      };
      payload.creditCardHolderInfo = {
        name: holder.name,
        email: holder.email,
        cpfCnpj: String(holder.cpfCnpj).replace(/\D/g, ""),
        postalCode: String(holder.postalCode).replace(/\D/g, ""),
        addressNumber: holder.addressNumber,
        phone: String(holder.phone).replace(/\D/g, ""),
      };
      payload.remoteIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
    }

    let raw: any;
    try {
      raw = await asaasFetch("/payments", { method: "POST", body: JSON.stringify(payload) });
    } catch (error) {
      console.error("[asaas-create-payment] falha Asaas", {
        status: error instanceof AsaasApiError ? error.status : "unknown",
        proposalId,
        paymentMethod,
      });
      return jsonResponse(
        req,
        { ok: false, error: "Nao foi possivel gerar o pagamento agora. Tente novamente." },
        502,
      );
    }

    const sanitized = sanitizeAsaasResponse(raw);
    const internalStatus = mapAsaasStatus(raw?.status);
    let pixQrCode: string | null = null;
    let pixCopyPaste: string | null = null;
    let pixExpiresAt: string | null = null;

    if (paymentMethod === "pix" && raw?.id) {
      try {
        const pix = await asaasFetch(`/payments/${raw.id}/pixQrCode`);
        pixQrCode = pix?.encodedImage || null;
        pixCopyPaste = pix?.payload || null;
        pixExpiresAt = pix?.expirationDate || null;
      } catch (error) {
        console.error("[asaas-create-payment] falha ao buscar QR Pix", {
          proposalId,
          paymentId: raw?.id,
        });
      }
    }

    const localPayment = {
      consultation_id: proposalId,
      proposal_id: proposalId,
      plan_id: consulta.plano_id,
      user_id: user.id,
      tenant_user_id: consulta.tenant_user_id,
      asaas_customer_id: customerId,
      asaas_payment_id: raw?.id || null,
      external_reference: externalReference,
      idempotency_key: externalReference,
      payment_method: paymentMethod,
      value: expectedAmount,
      status: internalStatus,
      due_date: dueDate,
      pix_qr_code: pixQrCode,
      pix_copy_paste: pixCopyPaste,
      pix_expires_at: pixExpiresAt,
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
    };

    const [{ error: insertError }, { error: updateError }] = await Promise.all([
      supabase.from("asaas_payments").insert(localPayment),
      supabase
        .from("consultas_credito")
        .update({
          asaas_customer_id: customerId,
          asaas_payment_id: raw?.id || null,
          external_reference: externalReference,
          payment_method: paymentMethod,
          payment_status: internalStatus,
          payment_value: expectedAmount,
          payment_due_date: dueDate,
          payment_data: sanitized,
        })
        .eq("id", proposalId),
    ]);

    if (insertError)
      console.error("[asaas-create-payment] falha ao salvar pagamento", {
        proposalId,
        error: insertError.message,
      });
    if (updateError)
      console.error("[asaas-create-payment] falha ao atualizar proposta", {
        proposalId,
        error: updateError.message,
      });

    // Notifica quem foi escolhido como responsavel pelo pagamento (imobiliaria
    // OU inquilino, decidido em resolvePaymentRecipient a partir do que ja
    // esta salvo na consulta - nunca os dois, nunca jurídico/admin/financeiro/
    // outro corretor). So dispara na criacao nova (nao no cache-hit acima),
    // entao um retry com a mesma idempotency_key nunca reenvia o e-mail/SMS.
    // Se o responsavel escolhido nao tiver e-mail/telefone cadastrado, so
    // registra a falta - nunca cai pra outra pessoa como destinatario.
    const destinatarioNome = recipient.recipientName || "cliente";
    const destinatarioEmail = recipient.recipientEmail;
    const destinatarioTelefone = recipient.recipientPhone;
    if (!destinatarioEmail) {
      console.error("[asaas-create-payment] cobranca criada sem e-mail para notificar", {
        proposalId,
        paymentResponsible: recipient.paymentResponsible,
      });
    }
    if (!destinatarioTelefone) {
      console.error("[asaas-create-payment] cobranca criada sem telefone para notificar", {
        proposalId,
        paymentResponsible: recipient.paymentResponsible,
      });
    }
    // Aguarda os envios (sem deixar falha de notificacao derrubar a resposta
    // do pagamento) - Edge Functions no Deno Deploy podem encerrar tarefas em
    // background apos a resposta ser enviada, entao "fire-and-forget" aqui
    // arriscaria nunca enviar. O try/catch de cada helper ja garante que uma
    // falha de e-mail/SMS nunca derruba o restante do fluxo.
    if (destinatarioEmail) {
      await sendPaymentEmail({
        to: destinatarioEmail,
        nome: destinatarioNome,
        tipo: "criado",
        valor: expectedAmount,
        metodo: paymentMethod,
        vencimento: dueDate,
        pixCopyPaste: pixCopyPaste,
        boletoUrl: localPayment.boleto_url,
        boletoBarcode: localPayment.boleto_barcode,
        contratoRef: String(proposalId).slice(0, 8).toUpperCase(),
      }).catch((error) =>
        console.error("[asaas-create-payment] falha ao notificar por e-mail", {
          proposalId,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    if (destinatarioTelefone) {
      const valorFmt = expectedAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      const metodoLabel =
        paymentMethod === "pix" ? "Pix" : paymentMethod === "boleto" ? "boleto" : "cartão";
      await sendPaymentSms({
        to: destinatarioTelefone,
        mensagem: `NOX Fiança: seu pagamento de ${valorFmt} via ${metodoLabel} foi gerado. Acesse sua conta para concluir o pagamento.`,
      }).catch((error) =>
        console.error("[asaas-create-payment] falha ao notificar por SMS", {
          proposalId,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }

    return jsonResponse(req, normalizedPaymentResponse(raw, localPayment));
  } catch (error) {
    console.error("[asaas-create-payment] erro", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(
      req,
      { ok: false, error: "Nao foi possivel gerar o pagamento agora." },
      500,
    );
  }
});
