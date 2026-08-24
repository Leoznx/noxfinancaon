import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  AsaasApiError,
  asaasFetch,
  corsHeaders,
  jsonResponse,
  mapAsaasStatus,
  requireUser,
  sanitizeAsaasResponse,
  supabaseAdmin,
} from "../_shared/asaas.ts";
import {
  asaasLateFeePayload,
  isCollectableStatus,
} from "../_shared/billing-automation.ts";

type Body = {
  invoiceId?: string;
  batchId?: string;
  method?: "boleto" | "pix";
  requestedBy?: string;
};

function safeEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a[index] ^ b[index];
  }
  return result === 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonResponse(
      req,
      { ok: false, error: "Método não permitido." },
      405,
    );
  }

  let auditId: string | null = null;
  try {
    const admin = supabaseAdmin();
    const body = (await req.json()) as Body;
    const expectedWebhookSecret = Deno.env.get("ZAPI_WEBHOOK_SECRET")?.trim() ||
      "";
    const receivedWebhookSecret =
      req.headers.get("x-zapi-webhook-secret")?.trim() || "";
    const internalWhatsappRequest = !!expectedWebhookSecret &&
      safeEqual(receivedWebhookSecret, expectedWebhookSecret);
    let supabase: ReturnType<typeof supabaseAdmin>;
    let user: { id: string };
    if (internalWhatsappRequest) {
      if (!body.requestedBy) {
        return jsonResponse(req, {
          ok: false,
          error: "DestinatÃ¡rio nÃ£o informado.",
        }, 400);
      }
      const { data: actor } = await admin
        .from("profiles")
        .select("id")
        .eq("id", body.requestedBy)
        .maybeSingle();
      if (!actor) {
        return jsonResponse(req, {
          ok: false,
          error: "DestinatÃ¡rio nÃ£o encontrado.",
        }, 404);
      }
      supabase = admin;
      user = { id: actor.id };
    } else {
      const authenticated = await requireUser(req);
      supabase = authenticated.supabase;
      user = authenticated.user;
    }
    const method = body.method === "pix" ? "pix" : "boleto";
    if (!!body.invoiceId === !!body.batchId) {
      return jsonResponse(req, {
        ok: false,
        error: "Informe uma única cobrança.",
      }, 400);
    }

    let target: {
      invoiceId: string | null;
      batchId: string | null;
      localPaymentId: string | null;
      providerPaymentId: string;
      amount: number;
      dueDate: string;
      status: string;
    };

    if (body.invoiceId) {
      // A consulta com a sessão do usuário é a barreira de autorização: RLS
      // libera apenas inquilino/destinatário da fatura ou equipe financeira.
      const { data: invoice, error } = await supabase
        .from("faturas_inquilino")
        .select(
          "id, asaas_payment_id, consolidated_item_id, valor, vencimento, status, recipient_user_id, tenant_user_id",
        )
        .eq("id", body.invoiceId)
        .maybeSingle();
      if (error || !invoice) {
        return jsonResponse(req, {
          ok: false,
          error: "Cobrança não encontrada.",
        }, 404);
      }
      if (
        internalWhatsappRequest &&
        invoice.recipient_user_id !== user.id &&
        invoice.tenant_user_id !== user.id
      ) {
        return jsonResponse(req, {
          ok: false,
          error: "CobranÃ§a nÃ£o pertence ao destinatÃ¡rio.",
        }, 403);
      }
      if (invoice.consolidated_item_id) {
        return jsonResponse(
          req,
          {
            ok: false,
            error:
              "Esta mensalidade faz parte de uma cobrança consolidada. Gere a segunda via no lote mensal.",
          },
          409,
        );
      }
      if (!invoice.asaas_payment_id) {
        return jsonResponse(req, {
          ok: false,
          error: "Esta cobrança ainda não possui pagamento no Asaas.",
        }, 409);
      }
      const { data: payment } = await admin
        .from("asaas_payments")
        .select("id, asaas_payment_id, value, due_date, status")
        .eq("id", invoice.asaas_payment_id)
        .maybeSingle();
      if (!payment?.asaas_payment_id) {
        return jsonResponse(req, {
          ok: false,
          error: "Pagamento não localizado no Asaas.",
        }, 404);
      }
      target = {
        invoiceId: invoice.id,
        batchId: null,
        localPaymentId: payment.id,
        providerPaymentId: payment.asaas_payment_id,
        amount: Number(invoice.valor || payment.value || 0),
        dueDate: invoice.vencimento || payment.due_date,
        status: payment.status || invoice.status,
      };
    } else {
      const { data: batch, error } = await supabase
        .from("consolidated_invoice_batches")
        .select(
          "id, agency_user_id, asaas_payment_id, total_value, due_date, status",
        )
        .eq("id", body.batchId!)
        .maybeSingle();
      if (error || !batch) {
        return jsonResponse(req, {
          ok: false,
          error: "Cobrança consolidada não encontrada.",
        }, 404);
      }
      if (internalWhatsappRequest && batch.agency_user_id !== user.id) {
        return jsonResponse(req, {
          ok: false,
          error: "CobranÃ§a nÃ£o pertence ao destinatÃ¡rio.",
        }, 403);
      }
      if (!batch.asaas_payment_id) {
        return jsonResponse(req, {
          ok: false,
          error: "O lote ainda não possui pagamento no Asaas.",
        }, 409);
      }
      target = {
        invoiceId: null,
        batchId: batch.id,
        localPaymentId: null,
        providerPaymentId: batch.asaas_payment_id,
        amount: Number(batch.total_value || 0),
        dueDate: batch.due_date,
        status: batch.status,
      };
    }

    const { data: audit } = await admin
      .from("payment_reissue_requests")
      .insert({
        requested_by: user.id,
        invoice_id: target.invoiceId,
        batch_id: target.batchId,
        asaas_payment_id: target.providerPaymentId,
        requested_method: method,
        amount: target.amount,
        due_date: target.dueDate,
      })
      .select("id")
      .maybeSingle();
    auditId = audit?.id || null;

    if (
      !isCollectableStatus(target.status) && target.status !== "active"
    ) {
      if (auditId) {
        await admin
          .from("payment_reissue_requests")
          .update({
            status: "not_payable",
            provider_status: target.status,
            completed_at: new Date().toISOString(),
          })
          .eq("id", auditId);
      }
      return jsonResponse(req, {
        ok: false,
        error: "Esta cobrança não está disponível para pagamento.",
      }, 409);
    }

    const billingType = method === "pix" ? "PIX" : "BOLETO";
    const raw = await asaasFetch(`/payments/${target.providerPaymentId}`, {
      method: "PUT",
      body: JSON.stringify({
        billingType,
        value: target.amount,
        dueDate: target.dueDate,
        ...asaasLateFeePayload(),
      }),
    });
    const internalStatus = mapAsaasStatus(raw?.status);
    let boletoBarcode = raw?.identificationField || raw?.nossoNumero || null;
    const boletoUrl = raw?.bankSlipUrl || raw?.invoiceUrl || null;
    let pixQrCode: string | null = null;
    let pixCopyPaste: string | null = null;
    let pixExpiresAt: string | null = null;

    if (method === "boleto") {
      try {
        const line = await asaasFetch(
          `/payments/${target.providerPaymentId}/identificationField`,
        );
        boletoBarcode = line?.identificationField || line?.barCode ||
          boletoBarcode;
      } catch {
        // O link retornado no PUT continua válido; a linha pode ser consultada
        // novamente em uma próxima tentativa sem criar outra cobrança.
      }
    } else {
      const pix = await asaasFetch(
        `/payments/${target.providerPaymentId}/pixQrCode`,
      );
      pixQrCode = pix?.encodedImage || null;
      pixCopyPaste = pix?.payload || null;
      pixExpiresAt = pix?.expirationDate || null;
    }

    if (target.localPaymentId) {
      await admin
        .from("asaas_payments")
        .update({
          payment_method: method,
          status: internalStatus,
          boleto_url: method === "boleto" ? boletoUrl : null,
          boleto_barcode: method === "boleto" ? boletoBarcode : null,
          pix_qr_code: method === "pix" ? pixQrCode : null,
          pix_copy_paste: method === "pix" ? pixCopyPaste : null,
          pix_expires_at: method === "pix" ? pixExpiresAt : null,
          raw_response: sanitizeAsaasResponse(raw),
        })
        .eq("id", target.localPaymentId);
      await admin
        .from("faturas_inquilino")
        .update({
          status: internalStatus,
          boleto_url: method === "boleto" ? boletoUrl : null,
          linha_digitavel: method === "boleto" ? boletoBarcode : null,
        })
        .eq("id", target.invoiceId!);
    } else {
      await admin
        .from("consolidated_invoice_batches")
        .update({
          billing_method: method,
          invoice_url: raw?.invoiceUrl || null,
          bank_slip_url: method === "boleto" ? boletoUrl : null,
          identification_field: method === "boleto" ? boletoBarcode : null,
          pix_qr_code: method === "pix" ? pixQrCode : null,
          pix_copy_paste: method === "pix" ? pixCopyPaste : null,
          pix_expires_at: method === "pix" ? pixExpiresAt : null,
          last_synced_at: new Date().toISOString(),
        })
        .eq("id", target.batchId!);
    }

    if (auditId) {
      await admin
        .from("payment_reissue_requests")
        .update({
          status: "completed",
          provider_status: internalStatus,
          completed_at: new Date().toISOString(),
        })
        .eq("id", auditId);
    }

    return jsonResponse(req, {
      success: true,
      method,
      status: internalStatus,
      amount: target.amount,
      dueDate: target.dueDate,
      boleto: method === "boleto"
        ? { pdfUrl: boletoUrl, barcode: boletoBarcode }
        : null,
      pix: method === "pix"
        ? {
          qrCodeBase64: pixQrCode,
          copyPaste: pixCopyPaste,
          expiresAt: pixExpiresAt,
        }
        : null,
    });
  } catch (error) {
    if (auditId) {
      await supabaseAdmin()
        .from("payment_reissue_requests")
        .update({
          status: "failed",
          error_code: error instanceof AsaasApiError
            ? `asaas_http_${error.status}`
            : "unexpected_error",
          completed_at: new Date().toISOString(),
        })
        .eq("id", auditId);
    }
    console.error("[asaas-reissue-payment] falha", {
      reason: error instanceof AsaasApiError
        ? `asaas_http_${error.status}`
        : "unexpected_error",
    });
    return jsonResponse(req, {
      ok: false,
      error: "Não foi possível atualizar a cobrança agora.",
    }, 502);
  }
});
