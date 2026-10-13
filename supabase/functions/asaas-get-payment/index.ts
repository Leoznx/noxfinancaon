import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  asaasFetch,
  corsHeaders,
  jsonResponse,
  mapAsaasStatus,
  normalizedPaymentResponse,
  refetchPixQrCode,
  requireUser,
  sanitizeAsaasResponse,
} from "../_shared/asaas.ts";
import {
  normalizePaymentStatus,
  persistProviderTransition,
  reducePaymentStatus,
} from "../_shared/billing-state.ts";
import { dispatchD4SignContract, finalizeD4SignContract } from "../_shared/d4sign.ts";

async function persistConsultationPayment(
  supabase: any,
  consultationId: string,
  incomingStatus: ReturnType<typeof normalizePaymentStatus>,
  providerEventAt: string,
  paymentData: Record<string, unknown>,
) {
  const { data: consultation, error } = await supabase
    .from("consultas_credito")
    .select("*")
    .eq("id", consultationId)
    .maybeSingle();
  if (error || !consultation) throw error || new Error("consultation_not_found");
  return await persistProviderTransition({
    supabase,
    table: "consultas_credito",
    rowId: consultationId,
    current: consultation,
    incomingEventAt: providerEventAt,
    statusColumn: "payment_state",
    eventAtColumn: "payment_provider_event_at",
    reduce: (currentStatus, currentEventAt, incomingEventAt) =>
      reducePaymentStatus(currentStatus as string, incomingStatus, currentEventAt, incomingEventAt),
    buildPatch: ({ current, nextStatus, staleEvent }) => ({
      payment_status: nextStatus,
      payment_data:
        !staleEvent && normalizePaymentStatus(nextStatus) === incomingStatus
          ? paymentData
          : current.payment_data,
    }),
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST")
    return jsonResponse(req, { ok: false, error: "Metodo nao permitido." }, 405);

  try {
    const { supabase, user } = await requireUser(req);
    const body = await req.json();
    const paymentId = body?.paymentId;
    const consultationId = body?.consultationId || body?.proposalId;

    let query = supabase.from("asaas_payments").select("*");
    if (paymentId) query = query.eq("asaas_payment_id", paymentId);
    else if (consultationId)
      query = query
        .eq("consultation_id", consultationId)
        .order("created_at", { ascending: false })
        .limit(1);
    else return jsonResponse(req, { ok: false, error: "Pagamento nao encontrado." }, 400);

    const { data: foundPayment, error } = await query.maybeSingle();
    if (error) throw error;
    if (!foundPayment)
      return jsonResponse(req, { ok: false, error: "Pagamento nao encontrado." }, 404);
    let payment = foundPayment;

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    const allowed =
      payment.user_id === user.id ||
      payment.tenant_user_id === user.id ||
      payment.recipient_user_id === user.id ||
      ["admin", "admin_master", "financeiro"].includes(profile?.role);
    if (!allowed) return jsonResponse(req, { ok: false, error: "Acesso nao autorizado." }, 403);

    let raw = payment.raw_response;
    if (payment.asaas_payment_id) {
      raw = await asaasFetch(`/payments/${payment.asaas_payment_id}`);
      // Um GET ao Asaas e um snapshot observado agora. Datas como dateCreated
      // representam a criacao da cobranca e nao a versao do status retornado.
      const providerEventAt = new Date().toISOString();
      const incomingStatus = normalizePaymentStatus(mapAsaasStatus(raw?.status));
      const sanitizedRaw = sanitizeAsaasResponse(raw);
      const paymentTransition = await persistProviderTransition({
        supabase,
        table: "asaas_payments",
        rowId: payment.id,
        current: payment,
        incomingEventAt: providerEventAt,
        reduce: (currentStatus, currentEventAt, incomingEventAt) =>
          reducePaymentStatus(
            currentStatus as string,
            incomingStatus,
            currentEventAt,
            incomingEventAt,
          ),
        buildPatch: ({ current, nextStatus, staleEvent }) => ({
          raw_response:
            !staleEvent && normalizePaymentStatus(nextStatus) === incomingStatus
              ? sanitizedRaw
              : current.raw_response,
        }),
      });
      payment = paymentTransition.row;
      const internalStatus = normalizePaymentStatus(payment.status);
      // "Atualizar status" e o fallback manual (botao) pro mesmo caminho que
      // o webhook faz sozinho - se essa cobranca for uma das mensalidades,
      // sincroniza a faturas_inquilino vinculada tambem, senao o botao
      // atualizaria asaas_payments mas a tela continuaria mostrando o status
      // antigo.
      const { data: faturaVinculada } = await supabase
        .from("faturas_inquilino")
        .select("id, pago_em, charge_kind, status, confirmed_at, provider_event_at")
        .eq("asaas_payment_id", payment.id)
        .maybeSingle();
      if (faturaVinculada) {
        const invoiceTransition = await persistProviderTransition({
          supabase,
          table: "faturas_inquilino",
          rowId: faturaVinculada.id,
          current: faturaVinculada,
          incomingEventAt: providerEventAt,
          reduce: (currentStatus, currentEventAt, incomingEventAt) =>
            reducePaymentStatus(
              currentStatus as string,
              internalStatus,
              currentEventAt,
              incomingEventAt,
            ),
          buildPatch: ({ current, nextStatus, staleEvent }) => {
            const updateFatura: Record<string, unknown> = {};
            const incomingAccepted =
              !staleEvent && normalizePaymentStatus(nextStatus) === internalStatus;
            if (
              incomingAccepted &&
              ["confirmed", "paid"].includes(nextStatus) &&
              !current.confirmed_at
            ) {
              updateFatura.confirmed_at = new Date().toISOString();
            }
            if (incomingAccepted && nextStatus === "paid" && !current.pago_em) {
              updateFatura.pago_em =
                raw?.paymentDate || raw?.clientPaymentDate || new Date().toISOString();
            }
            return updateFatura;
          },
        });
        const invoiceStatus = normalizePaymentStatus(invoiceTransition.nextStatus);

        if (invoiceStatus === "paid" && faturaVinculada.charge_kind === "initial") {
          const { error: releaseError } = await supabase.rpc("release_commissions_for_invoice", {
            p_invoice_id: faturaVinculada.id,
            p_event_id: `invoice:${faturaVinculada.id}:first-paid`,
          });
          if (releaseError) throw releaseError;
        }

        if (payment.consultation_id && faturaVinculada.charge_kind === "initial") {
          const consultationTransition = await persistConsultationPayment(
            supabase,
            payment.consultation_id,
            internalStatus,
            providerEventAt,
            sanitizedRaw,
          );
          const consultationStatus = normalizePaymentStatus(consultationTransition.nextStatus);
          if (
            ["confirmed", "paid"].includes(invoiceStatus) &&
            ["confirmed", "paid"].includes(consultationStatus)
          ) {
            const { data: signature } = await supabase
              .from("contract_signatures")
              .select("*")
              .eq("consultation_id", payment.consultation_id)
              .maybeSingle();
            if (
              signature?.signature_status === "signed" ||
              ["signed", "active"].includes(signature?.status)
            ) {
              await finalizeD4SignContract(supabase, signature);
            } else {
              await dispatchD4SignContract(supabase, payment.consultation_id, {
                allowPendingPayment: true,
              });
            }
          }
        }
      } else if (payment.consultation_id && payment.charge_kind !== "monthly") {
        // Compatibilidade com cobrancas criadas antes de toda cobranca possuir
        // uma fatura materializada.
        await persistConsultationPayment(
          supabase,
          payment.consultation_id,
          internalStatus,
          providerEventAt,
          sanitizedRaw,
        );
      }
    }

    // "Atualizar status" nunca cria outra cobranca - so consulta a existente.
    // Se for Pix e o QR Code/copia-e-cola ainda nao foram salvos (falha
    // transitoria anterior), tenta buscar de novo aqui tambem.
    const finalPayment =
      payment.payment_method === "pix" ? await refetchPixQrCode(supabase, payment) : payment;

    return jsonResponse(req, normalizedPaymentResponse(raw, finalPayment));
  } catch (error) {
    console.error("[asaas-get-payment] erro", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(
      req,
      { ok: false, error: "Nao foi possivel consultar o pagamento agora." },
      500,
    );
  }
});
