import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { normalizeDocumento } from "@/utils/documento";
import {
  createCaktoPayment,
  normalizeCaktoPaymentResponse,
  formatarTelefoneCakto,
  CaktoApiError,
  type CaktoPaymentMethod,
} from "@/lib/cakto.service";

const customerSchema = z.object({
  name: z.string().trim().min(1, "Nome do cliente é obrigatório."),
  email: z.string().trim().email("E-mail do cliente inválido."),
  phone: z.string().trim().min(8, "Telefone do cliente é obrigatório."),
  docType: z.enum(["cpf", "cnpj"]),
  docNumber: z.string().trim().min(11, "CPF/CNPJ do cliente é obrigatório."),
});

const criarPagamentoSchema = z
  .object({
    paymentMethod: z.enum(["pix", "boleto", "credit_card"]),
    selectedFireInsuranceMode: z.enum(["avista", "embutido"]),
    amount: z.number().positive("O valor precisa ser maior que zero."),
    contractId: z.string().uuid().nullable().optional(),
    consultationId: z.string().uuid().nullable().optional(),
    customer: customerSchema,
    // Gerados pelo SDK antifraude da Cakto no navegador (ver assets/cakto-sdk.ts) —
    // obrigatórios pela própria API da Cakto em toda criação de cobrança.
    antifraudProfilingAttemptReference: z.string().min(1, "Referência antifraude ausente."),
    fingerprint: z.string().min(1, "Fingerprint do dispositivo ausente."),
  })
  .refine((d) => !!(d.contractId || d.consultationId), {
    message: "contractId ou consultationId é obrigatório.",
    path: ["consultationId"],
  });

/**
 * Chave de idempotência DETERMINÍSTICA (não um UUID aleatório por chamada): se o
 * mesmo pagamento for reenviado (clique duplo que escapou do disable do botão, retry
 * de rede), a chave é IDÊNTICA — a Cakto (e a checagem em cakto_payments abaixo)
 * reconhecem e devolvem a cobrança já criada em vez de duplicar a cobrança.
 */
function buildIdempotencyKey(params: {
  consultationId?: string | null;
  contractId?: string | null;
  paymentMethod: string;
  amount: number;
}): string {
  const ref = params.consultationId || params.contractId || "sem-ref";
  const amountCents = Math.round(params.amount * 100);
  return `nox-fianca-${ref}-${params.paymentMethod}-${amountCents}`;
}

/** Nunca repassar o erro técnico bruto da Cakto pro frontend — pode conter detalhes internos. */
function mensagemSeguraParaErro(err: unknown): string {
  if (err instanceof CaktoApiError) {
    if (err.status === 401 || err.status === 403) {
      return "Não foi possível gerar o pagamento agora. Tente novamente.";
    }
    if (err.status === 429) {
      return "Muitas tentativas em pouco tempo. Aguarde alguns segundos e tente novamente.";
    }
    if (err.status === 409) {
      return "Este pagamento já está sendo processado. Aguarde e verifique o status antes de tentar de novo.";
    }
    if (err.status >= 500) {
      return "O sistema de pagamentos está indisponível no momento. Tente novamente em instantes.";
    }
    return "Não foi possível gerar o pagamento com os dados informados.";
  }
  return "Não foi possível gerar o pagamento agora. Tente novamente.";
}

export const criarPagamentoCakto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => criarPagamentoSchema.parse(d))
  .handler(async ({ data, context }) => {
    const docNumber = normalizeDocumento(data.customer.docNumber);
    const phone = formatarTelefoneCakto(data.customer.phone);
    const idempotencyKey = buildIdempotencyKey({
      consultationId: data.consultationId,
      contractId: data.contractId,
      paymentMethod: data.paymentMethod,
      amount: data.amount,
    });

    // Defesa extra contra clique duplo/retry: se já existe uma cobrança criada com essa
    // chave, devolve o que já foi salvo em vez de chamar a Cakto de novo.
    const { data: existente } = await context.supabase
      .from("cakto_payments")
      .select(
        "cakto_payment_id, cakto_ref_id, status, payment_method, amount, checkout_url, raw_response",
      )
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existente) {
      const raw = (existente.raw_response as Record<string, unknown>) ?? {
        id: existente.cakto_payment_id,
        refId: existente.cakto_ref_id,
        status: existente.status,
        paymentMethod: existente.payment_method,
        amount: existente.amount,
        checkoutUrl: existente.checkout_url,
      };
      return normalizeCaktoPaymentResponse(raw);
    }

    let raw: Record<string, unknown>;
    try {
      const resultado = await createCaktoPayment({
        paymentMethod: data.paymentMethod as CaktoPaymentMethod,
        amount: data.amount,
        customer: {
          name: data.customer.name,
          email: data.customer.email,
          phone,
          docType: data.customer.docType,
          docNumber,
          fingerprint: data.fingerprint,
        },
        antifraudProfilingAttemptReference: data.antifraudProfilingAttemptReference,
        idempotencyKey,
        contractId: data.contractId ?? null,
        consultationId: data.consultationId ?? null,
        selectedFireInsuranceMode: data.selectedFireInsuranceMode,
      });
      raw = resultado.raw;
    } catch (err) {
      // Log seguro: CaktoApiError.message só carrega o corpo da resposta da Cakto
      // (sem client_secret/access_token, que nunca passam por aqui).
      console.error("[cakto] Falha ao criar pagamento", {
        consultationId: data.consultationId,
        contractId: data.contractId,
        paymentMethod: data.paymentMethod,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new Error(mensagemSeguraParaErro(err));
    }

    const { error: insertError } = await context.supabase.from("cakto_payments").insert({
      cakto_payment_id: (raw.id as string) ?? null,
      cakto_ref_id: (raw.refId as string) ?? null,
      status: (raw.status as string) ?? "waiting_payment",
      payment_method: data.paymentMethod,
      amount: data.amount,
      checkout_url: (raw.checkoutUrl as string) ?? null,
      contract_id: data.contractId ?? null,
      consultation_id: data.consultationId ?? null,
      customer_name: data.customer.name,
      customer_email: data.customer.email,
      customer_phone: phone,
      selected_fire_insurance_mode: data.selectedFireInsuranceMode,
      raw_response: raw as any,
      idempotency_key: idempotencyKey,
    } as any);

    if (insertError) {
      // A cobrança JÁ foi criada na Cakto nesse ponto — não falhar silenciosamente sem
      // registrar isso, mas também não bloquear o usuário: ele já tem checkoutUrl/pix/boleto.
      console.error("[cakto] Cobrança criada na Cakto mas falhou ao salvar em cakto_payments", {
        consultationId: data.consultationId,
        idempotencyKey,
        error: insertError.message,
      });
    }

    return normalizeCaktoPaymentResponse(raw);
  });
