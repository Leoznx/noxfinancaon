/**
 * Cliente da API da Cakto (gateway de pagamento) — OAuth2 client-credentials +
 * criação de cobrança (pix/boleto/credit_card). Usado por src/lib/pagamentoCakto.functions.ts.
 *
 * Nunca importar este arquivo do lado do cliente — ele lê CAKTO_CLIENT_SECRET via
 * process.env, que só existe no runtime server (Vercel/Node), igual ao padrão já
 * usado em auth-middleware.ts e client.server.ts para os segredos do Supabase.
 */

export type CaktoPaymentMethod = "pix" | "boleto" | "credit_card";

export interface CaktoCustomerInput {
  name: string;
  email: string;
  phone: string;
  docType: "cpf" | "cnpj";
  docNumber: string;
  fingerprint: string;
}

export interface CreateCaktoPaymentInput {
  paymentMethod: CaktoPaymentMethod;
  amount: number;
  customer: CaktoCustomerInput;
  antifraudProfilingAttemptReference: string;
  idempotencyKey: string;
  contractId?: string | null;
  consultationId?: string | null;
  selectedFireInsuranceMode?: string | null;
}

export interface NormalizedCaktoPayment {
  success: true;
  paymentId: string | null;
  refId: string | null;
  status: string;
  paymentMethod: CaktoPaymentMethod;
  amount: number;
  checkoutUrl: string | null;
  pix: { qrCode: string; qrCodeBase64: string; expiresAt: string } | null;
  boleto: { barcode: string; pdfUrl: string; dueDate: string } | null;
}

export class CaktoApiError extends Error {
  status: number;
  constructor(status: number, detail: string) {
    super(`Cakto API respondeu ${status}: ${detail}`);
    this.name = "CaktoApiError";
    this.status = status;
  }
}

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`Variável de ambiente ausente: ${name}. Configure o .env (veja .env.example).`);
  return value;
}

function baseUrl(): string {
  return process.env.CAKTO_BASE_URL || "https://api.cakto.com.br";
}

/** Nunca loga client_secret/access_token — só o suficiente para diagnosticar em produção. */
async function safeReadError(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return JSON.stringify(json).slice(0, 500);
  } catch {
    return res.statusText;
  }
}

// ---------------------------------------------------------------------------
// 1. Token OAuth2 (client-credentials), com cache em memória do processo.
//
// Em serverless (Vercel), esse cache só vive enquanto a instância da função ficar
// "quente" entre invocações — em um cold start ele começa vazio e busca um token
// novo, o que é aceitável (evita só as chamadas repetidas dentro da mesma instância).
// ---------------------------------------------------------------------------

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function fetchCaktoToken(): Promise<{ accessToken: string; expiresIn: number }> {
  const clientId = getEnv("CAKTO_CLIENT_ID");
  const clientSecret = getEnv("CAKTO_CLIENT_SECRET");

  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret });
  const res = await fetch(`${baseUrl()}/public_api/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const detail = await safeReadError(res);
    throw new CaktoApiError(res.status, `Falha ao autenticar na Cakto: ${detail}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: json.access_token, expiresIn: json.expires_in };
}

/** Retorna um access_token válido, buscando um novo automaticamente perto de expirar. */
export async function getCaktoAccessToken(): Promise<string> {
  const now = Date.now();
  // Margem de 60s para não usar um token que expira no meio de uma requisição em voo.
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) {
    return cachedToken.accessToken;
  }
  const { accessToken, expiresIn } = await fetchCaktoToken();
  cachedToken = { accessToken, expiresAt: now + expiresIn * 1000 };
  return accessToken;
}

// ---------------------------------------------------------------------------
// 2. Criar cobrança
// ---------------------------------------------------------------------------

/** Próximo dia útil N dias à frente (pula sábado/domingo) — vencimento padrão do boleto. */
function computeDefaultDueDate(businessDaysAhead: number): string {
  const date = new Date();
  let added = 0;
  while (added < businessDaysAhead) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return date.toISOString().slice(0, 10);
}

/**
 * Cria a cobrança na Cakto. Para `credit_card`, como este projeto ainda não integra o
 * SDK de tokenização de cartão da Cakto (obrigatório para /public_api/payments/ com
 * paymentMethod=credit_card — a API exige `card.token` e retorna 400 sem ele), não
 * chamamos o endpoint de pagamento: usamos direto o link de checkout hospedado do
 * produto/oferta (https://pay.cakto.com.br/{offerId}), que a própria Cakto documenta
 * como o link público de venda, sem precisar de nenhuma chamada de API antes.
 */
export async function createCaktoPayment(
  input: CreateCaktoPaymentInput,
): Promise<{ raw: Record<string, unknown>; calledApi: boolean }> {
  const offerId = getEnv("CAKTO_OFFER_ID");

  if (input.paymentMethod === "credit_card") {
    return {
      calledApi: false,
      raw: {
        id: null,
        refId: null,
        status: "redirected_to_checkout",
        paymentMethod: "credit_card",
        amount: input.amount.toFixed(2),
        checkoutUrl: `https://pay.cakto.com.br/${offerId}`,
      },
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
      contractId: input.contractId ?? null,
      consultationId: input.consultationId ?? null,
      selectedPaymentMethod: input.paymentMethod,
      selectedFireInsuranceMode: input.selectedFireInsuranceMode ?? null,
      totalAmount: input.amount,
    },
  };

  if (input.paymentMethod === "pix") {
    payload.pixExpiresIn = 3600;
  }
  if (input.paymentMethod === "boleto") {
    payload.dueDate = computeDefaultDueDate(3);
  }

  const res = await fetch(`${baseUrl()}/public_api/payments/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": input.idempotencyKey,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await safeReadError(res);
    throw new CaktoApiError(res.status, detail);
  }

  const json = (await res.json()) as Record<string, unknown>;
  return { calledApi: true, raw: json };
}

// ---------------------------------------------------------------------------
// 3. Normalização da resposta para o frontend
// ---------------------------------------------------------------------------

export function normalizeCaktoPaymentResponse(
  raw: Record<string, unknown>,
): NormalizedCaktoPayment {
  return {
    success: true,
    paymentId: (raw.id as string) ?? null,
    refId: (raw.refId as string) ?? null,
    status: (raw.status as string) ?? "unknown",
    paymentMethod: raw.paymentMethod as CaktoPaymentMethod,
    amount: Number(raw.amount) || 0,
    checkoutUrl: (raw.checkoutUrl as string) ?? null,
    pix: (raw.pix as NormalizedCaktoPayment["pix"]) ?? null,
    boleto: (raw.boleto as NormalizedCaktoPayment["boleto"]) ?? null,
  };
}

// ---------------------------------------------------------------------------
// 4. Formatação de dados do cliente exigida pela Cakto
// ---------------------------------------------------------------------------

/** Telefone brasileiro no padrão esperado pela Cakto: DDI+DDD+número, só dígitos (ex.: 5547999999999). */
export function formatarTelefoneCakto(telefone: string): string {
  const digitos = telefone.replace(/\D/g, "");
  if (digitos.startsWith("55") && digitos.length >= 12) return digitos;
  return `55${digitos}`;
}
