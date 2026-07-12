import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type PaymentMethod = "pix" | "boleto" | "credit_card";
type FireMode = "avista" | "embutido";

type RequestBody = {
  proposalId?: string;
  consultationId?: string;
  paymentMethod?: PaymentMethod;
  amount?: number;
  selectedFireInsuranceMode?: FireMode;
  antifraudProfilingAttemptReference?: string;
  fingerprint?: string;
  customer?: {
    name?: string;
    email?: string;
    phone?: string;
    document?: string;
    docNumber?: string;
    docType?: "cpf" | "cnpj";
  };
};

class CaktoApiError extends Error {
  status: number;
  response: string;

  constructor(status: number, response: string) {
    super(`Cakto API respondeu ${status}`);
    this.status = status;
    this.response = response;
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Variável de ambiente ausente: ${name}`);
  return value;
}

function caktoBaseUrl() {
  return Deno.env.get("CAKTO_API_BASE_URL") || Deno.env.get("CAKTO_BASE_URL") || "https://api.cakto.com.br";
}

function normalizeDocumento(value: string | null | undefined) {
  return (value || "").replace(/\D/g, "");
}

function formatarTelefoneCakto(value: string | null | undefined) {
  const digits = (value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  return `55${digits}`;
}

function calcularPercentualIncendio(tipo: "residencial" | "comercial", aluguel: number) {
  if (tipo === "comercial") {
    if (aluguel <= 3000) return 5;
    if (aluguel <= 8000) return 8;
    return 10;
  }
  if (aluguel > 12000) return 10;
  if (aluguel > 5000) return 5;
  return 3;
}

function calcularProximoDiaUtil(diasUteis: number) {
  const date = new Date();
  let added = 0;
  while (added < diasUteis) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return date.toISOString().slice(0, 10);
}

async function safeReadError(res: Response) {
  try {
    return JSON.stringify(await res.json()).slice(0, 1200);
  } catch {
    return res.statusText;
  }
}

async function getCaktoAccessToken() {
  const body = new URLSearchParams({
    client_id: env("CAKTO_CLIENT_ID"),
    client_secret: env("CAKTO_CLIENT_SECRET"),
  });

  const res = await fetch(`${caktoBaseUrl()}/public_api/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) throw new CaktoApiError(res.status, await safeReadError(res));
  const json = await res.json();
  return String(json.access_token || "");
}

function buildIdempotencyKey(params: { proposalId: string; paymentMethod: PaymentMethod; amount: number; fireMode: FireMode }) {
  return `nox-fianca-${params.proposalId}-${params.paymentMethod}-${params.fireMode}-${Math.round(params.amount * 100)}`;
}

function extract(raw: any, paths: string[][]) {
  for (const path of paths) {
    let value = raw;
    for (const key of path) value = value?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function normalizePayment(raw: any, fallback: { paymentMethod: PaymentMethod; amount: number }) {
  const paymentMethod = (extract(raw, [["paymentMethod"], ["payment_method"], ["method"]]) || fallback.paymentMethod) as PaymentMethod;
  const amount = Number(extract(raw, [["amount"], ["total"], ["value"]]) || fallback.amount) || fallback.amount;
  const qrCodeBase64 = extract(raw, [
    ["pix", "qrCodeBase64"],
    ["pix", "qr_code_base64"],
    ["pix", "encodedImage"],
    ["pixQrCodeBase64"],
    ["pix_qr_code_base64"],
  ]);
  const qrCode = extract(raw, [
    ["pix", "qrCode"],
    ["pix", "qr_code"],
    ["pix", "copyPaste"],
    ["pix", "copy_paste"],
    ["pixCopyPaste"],
    ["pix_copy_paste"],
  ]);
  const boletoUrl = extract(raw, [
    ["boleto", "pdfUrl"],
    ["boleto", "pdf_url"],
    ["boleto", "url"],
    ["boletoUrl"],
    ["boleto_url"],
  ]);
  const boletoBarcode = extract(raw, [
    ["boleto", "barcode"],
    ["boleto", "barCode"],
    ["boleto", "digitableLine"],
    ["boleto", "linha_digitavel"],
    ["boletoBarcode"],
    ["boleto_barcode"],
  ]);

  return {
    success: true,
    paymentId: extract(raw, [["id"], ["paymentId"], ["payment_id"]]),
    refId: extract(raw, [["refId"], ["ref_id"]]),
    status: extract(raw, [["status"]]) || "waiting_payment",
    paymentMethod,
    amount,
    checkoutUrl: extract(raw, [["checkoutUrl"], ["checkout_url"], ["url"]]),
    pix: qrCode || qrCodeBase64
      ? {
          qrCode: qrCode || "",
          qrCodeBase64: qrCodeBase64 || "",
          expiresAt: extract(raw, [["pix", "expiresAt"], ["pix", "expires_at"], ["pixExpiresAt"], ["pix_expires_at"]]) || "",
        }
      : null,
    boleto: boletoUrl || boletoBarcode
      ? {
          barcode: boletoBarcode || "",
          pdfUrl: boletoUrl || "",
          dueDate: extract(raw, [["boleto", "dueDate"], ["boleto", "due_date"], ["dueDate"], ["due_date"]]) || "",
        }
      : null,
  };
}

async function createCaktoPayment(input: {
  paymentMethod: PaymentMethod;
  amount: number;
  idempotencyKey: string;
  proposalId: string;
  fireMode: FireMode;
  customer: { name: string; email: string; phone: string; docType: "cpf" | "cnpj"; docNumber: string; fingerprint: string };
  antifraudProfilingAttemptReference: string;
}) {
  const offerId = env("CAKTO_OFFER_ID");

  if (input.paymentMethod === "credit_card") {
    return {
      id: null,
      refId: input.idempotencyKey,
      status: "waiting_payment",
      paymentMethod: "credit_card",
      amount: input.amount.toFixed(2),
      checkoutUrl: `https://pay.cakto.com.br/${offerId}`,
    };
  }

  const accessToken = await getCaktoAccessToken();
  const payload: Record<string, unknown> = {
    paymentMethod: input.paymentMethod,
    customer: {
      name: input.customer.name,
      email: input.customer.email,
      phone: input.customer.phone,
      fingerprint: input.customer.fingerprint,
      docType: input.customer.docType,
      docNumber: input.customer.docNumber,
    },
    items: [{ offerId, quantity: 1, offerType: "main" }],
    antifraudProfilingAttemptReference: input.antifraudProfilingAttemptReference,
    metadata: {
      source: "nox-fianca",
      proposalId: input.proposalId,
      consultationId: input.proposalId,
      selectedPaymentMethod: input.paymentMethod,
      selectedFireInsuranceMode: input.fireMode,
      totalAmount: input.amount,
    },
  };

  if (input.paymentMethod === "pix") payload.pixExpiresIn = 3600;
  if (input.paymentMethod === "boleto") payload.dueDate = calcularProximoDiaUtil(3);

  const res = await fetch(`${caktoBaseUrl()}/public_api/payments/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": input.idempotencyKey,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new CaktoApiError(res.status, await safeReadError(res));
  return await res.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Método não permitido." }, 405);

  try {
    const supabaseUrl = env("SUPABASE_URL");
    const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
    const authorization = req.headers.get("Authorization") || "";

    const supabaseAuth = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: authError } = await supabaseAuth.auth.getUser(
      authorization.replace(/^Bearer\s+/i, ""),
    );
    if (authError || !userData.user) return jsonResponse({ ok: false, error: "Sessão inválida." }, 401);

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = (await req.json()) as RequestBody;
    const proposalId = body.proposalId || body.consultationId;
    const paymentMethod = body.paymentMethod;
    const fireMode = body.selectedFireInsuranceMode || "embutido";

    if (!proposalId) return jsonResponse({ ok: false, error: "Proposta não encontrada." }, 400);
    if (!paymentMethod || !["pix", "boleto", "credit_card"].includes(paymentMethod)) {
      return jsonResponse({ ok: false, error: "Selecione uma forma de pagamento." }, 400);
    }

    const { data: consulta, error: consultaError } = await supabaseAdmin
      .from("consultas_credito")
      .select("*, inquilinos(*), imoveis(*)")
      .eq("id", proposalId)
      .maybeSingle();
    if (consultaError) throw consultaError;
    if (!consulta) return jsonResponse({ ok: false, error: "Proposta não encontrada." }, 404);

    const imovel = (consulta as any).imoveis || {};
    const inquilino = (consulta as any).inquilinos || {};
    const docs = typeof (consulta as any).documentos === "object" && (consulta as any).documentos ? (consulta as any).documentos : {};
    const extras = docs.extras || {};
    const aluguel = Number(imovel.valor_aluguel || (consulta as any).rent_value || 0);
    const premioMensal = Number((consulta as any).valor_premio_mensal || 0);
    const taxaAtivacao = ((consulta as any).activation_fee_enabled ?? extras.activation_fee_enabled)
      ? Number((consulta as any).activation_fee_amount ?? extras.activation_fee_amount ?? 0)
      : 0;
    const pinturaTotal = ((consulta as any).external_painting_enabled ?? extras.external_painting_enabled)
      ? Number((consulta as any).external_painting_total ?? extras.external_painting_total ?? 0)
      : 0;
    const pinturaMensal = ((consulta as any).external_painting_enabled ?? extras.external_painting_enabled)
      ? Number((consulta as any).external_painting_installment ?? extras.external_painting_installment ?? 0) || (pinturaTotal > 0 ? +(pinturaTotal / 3).toFixed(2) : 0)
      : 0;
    const subtipo = String((consulta as any).imovel_subtipo || imovel.tipo || "").toLowerCase();
    const tipoImovel: "residencial" | "comercial" = /comercial|consult|cl[ií]nica|ind[uú]stria|servi[cç]o|armaz[eé]m/.test(subtipo)
      ? "comercial"
      : "residencial";
    const premioIncendioAnual = aluguel * (calcularPercentualIncendio(tipoImovel, aluguel) / 100);
    const premioIncendioMensal = premioIncendioAnual / 12;
    const mensalidadeFinal = premioMensal + pinturaMensal + (fireMode === "embutido" ? premioIncendioMensal : 0);
    const expectedAmount = +(mensalidadeFinal + taxaAtivacao + (fireMode === "avista" ? premioIncendioAnual : 0)).toFixed(2);
    const requestedAmount = Number(body.amount || expectedAmount);

    if (Math.abs(requestedAmount - expectedAmount) > 0.02) {
      return jsonResponse({
        ok: false,
        error: "O valor do pagamento mudou. Atualize a página e tente novamente.",
        expectedAmount,
      }, 409);
    }

    const name = body.customer?.name || (consulta as any).tenant_name || inquilino.nome || "";
    const email = body.customer?.email || (consulta as any).tenant_email || inquilino.email || "";
    const phone = formatarTelefoneCakto(body.customer?.phone || (consulta as any).tenant_telefone || inquilino.telefone);
    const docNumber = normalizeDocumento(body.customer?.document || body.customer?.docNumber || (consulta as any).tenant_document || inquilino.cpf || inquilino.cnpj);
    const docType = body.customer?.docType || ((consulta as any).tenant_type === "PJ" || docNumber.length > 11 ? "cnpj" : "cpf");

    if (!name || !email || !phone || !docNumber) {
      return jsonResponse({ ok: false, error: "Complete nome, e-mail, telefone e CPF/CNPJ antes de pagar." }, 400);
    }

    const idempotencyKey = buildIdempotencyKey({ proposalId, paymentMethod, amount: expectedAmount, fireMode });
    const { data: existente } = await supabaseAdmin
      .from("cakto_payments")
      .select("*")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existente) {
      const raw = (existente as any).raw_response || {
        id: (existente as any).cakto_payment_id,
        refId: (existente as any).cakto_ref_id,
        status: (existente as any).status,
        paymentMethod: (existente as any).payment_method,
        amount: (existente as any).amount,
        checkoutUrl: (existente as any).checkout_url,
      };
      return jsonResponse(normalizePayment(raw, { paymentMethod, amount: expectedAmount }));
    }

    console.log("Criando pagamento Cakto", { proposalId, paymentMethod, amount: expectedAmount });

    let raw: any;
    try {
      raw = await createCaktoPayment({
        paymentMethod,
        amount: expectedAmount,
        idempotencyKey,
        proposalId,
        fireMode,
        customer: {
          name,
          email,
          phone,
          docType,
          docNumber,
          fingerprint: body.fingerprint || "sem-fingerprint",
        },
        antifraudProfilingAttemptReference: body.antifraudProfilingAttemptReference || "sem-antifraude",
      });
    } catch (error) {
      console.error("Erro Cakto:", {
        status: error instanceof CaktoApiError ? error.status : "unknown",
        response: error instanceof CaktoApiError ? error.response : error instanceof Error ? error.message : String(error),
      });
      return jsonResponse({ ok: false, error: "Não foi possível gerar o pagamento agora. Tente novamente." }, 502);
    }

    const normalized = normalizePayment(raw, { paymentMethod, amount: expectedAmount });
    const updateConsulta = supabaseAdmin
      .from("consultas_credito")
      .update({
        payment_status: "aguardando_pagamento",
      } as any)
      .eq("id", proposalId);

    const insertPayment = supabaseAdmin.from("cakto_payments").insert({
      cakto_payment_id: normalized.paymentId,
      cakto_ref_id: normalized.refId,
      status: normalized.status || "waiting_payment",
      payment_method: paymentMethod,
      amount: expectedAmount,
      checkout_url: normalized.checkoutUrl,
      payment_url: normalized.checkoutUrl,
      pix_qr_code: normalized.pix?.qrCodeBase64 || null,
      pix_copy_paste: normalized.pix?.qrCode || null,
      boleto_url: normalized.boleto?.pdfUrl || null,
      boleto_barcode: normalized.boleto?.barcode || null,
      contract_id: null,
      consultation_id: proposalId,
      customer_name: name,
      customer_email: email,
      customer_phone: phone,
      selected_fire_insurance_mode: fireMode,
      raw_response: raw,
      idempotency_key: idempotencyKey,
    } as any);

    const [{ error: updateError }, { error: insertError }] = await Promise.all([updateConsulta, insertPayment]);
    if (updateError) console.error("[create-cakto-payment] Falha ao atualizar proposta", { error: updateError.message });
    if (insertError) console.error("[create-cakto-payment] Falha ao salvar pagamento", { error: insertError.message });

    return jsonResponse(normalized);
  } catch (error) {
    console.error("[create-cakto-payment] erro inesperado", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse({ ok: false, error: "Não foi possível gerar o pagamento agora." }, 500);
  }
});
