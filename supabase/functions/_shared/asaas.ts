import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

export type PaymentMethod = "pix" | "boleto" | "credit_card";
export type FireMode = "avista" | "embutido";

export type JsonBody = Record<string, unknown>;

export function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = (
    Deno.env.get("ALLOWED_ORIGINS") ||
    Deno.env.get("FRONTEND_URL") ||
    "https://noxfianca.com"
  )
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, asaas-access-token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
}

export function jsonResponse(req: Request, body: JsonBody, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

export function supabaseAdmin() {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireUser(req: Request) {
  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Sessao invalida.");
  const supabase = supabaseAdmin();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Sessao invalida.");
  return { supabase, user: data.user };
}

export class HttpError extends Error {
  status: number;
  publicMessage: string;

  constructor(status: number, publicMessage: string) {
    super(publicMessage);
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

export class AsaasApiError extends Error {
  status: number;
  response: unknown;

  constructor(status: number, response: unknown) {
    super(`Asaas API responded ${status}`);
    this.status = status;
    this.response = response;
  }
}

export function normalizeDocumento(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

export function normalizePhone(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

export function toMoney(value: unknown) {
  const parsed = Number(value || 0);
  return Math.round((Number.isFinite(parsed) ? parsed : 0) * 100) / 100;
}

export function addBusinessDays(days: number) {
  const date = new Date();
  let added = 0;
  while (added < days) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return date.toISOString().slice(0, 10);
}

export function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export function calcularPercentualIncendio(tipo: "residencial" | "comercial", aluguel: number) {
  if (tipo === "comercial") {
    if (aluguel <= 3000) return 5;
    if (aluguel <= 8000) return 8;
    return 10;
  }
  if (aluguel > 12000) return 10;
  if (aluguel > 5000) return 5;
  return 3;
}

export function calculateExpectedPayment(consulta: any, fireMode: FireMode) {
  const imovel = consulta?.imoveis || {};
  const docs =
    typeof consulta?.documentos === "object" && consulta?.documentos ? consulta.documentos : {};
  const extras = docs.extras || {};
  const aluguel = toMoney(imovel.valor_aluguel || consulta?.rent_value || consulta?.valor_aluguel);
  const premioMensal = toMoney(consulta?.valor_premio_mensal);
  const taxaAtivacao =
    (consulta?.activation_fee_enabled ?? extras.activation_fee_enabled)
      ? toMoney(consulta?.activation_fee_amount ?? extras.activation_fee_amount)
      : 0;
  const pinturaTotal =
    (consulta?.external_painting_enabled ?? extras.external_painting_enabled)
      ? toMoney(consulta?.external_painting_total ?? extras.external_painting_total)
      : 0;
  const pinturaMensal =
    (consulta?.external_painting_enabled ?? extras.external_painting_enabled)
      ? toMoney(consulta?.external_painting_installment ?? extras.external_painting_installment) ||
        (pinturaTotal > 0 ? toMoney(pinturaTotal / 3) : 0)
      : 0;
  const subtipo = String(consulta?.imovel_subtipo || imovel.tipo || "").toLowerCase();
  const tipoImovel: "residencial" | "comercial" =
    /comercial|consult|clinica|cl[ií]nica|industria|ind[uú]stria|servico|servi[cç]o|armazem|armaz[eé]m/.test(
      subtipo,
    )
      ? "comercial"
      : "residencial";
  const incendioAnual = toMoney(aluguel * (calcularPercentualIncendio(tipoImovel, aluguel) / 100));
  const incendioMensal = toMoney(incendioAnual / 12);
  const mensalidadeFinal =
    premioMensal + pinturaMensal + (fireMode === "embutido" ? incendioMensal : 0);
  const pagamentoInicial = taxaAtivacao + (fireMode === "avista" ? incendioAnual : 0);
  return toMoney(mensalidadeFinal + pagamentoInicial);
}

export function buildExternalReference(params: {
  consultationId: string;
  paymentMethod: PaymentMethod;
  fireMode: FireMode;
  amount: number;
}) {
  return `nox:consulta:${params.consultationId}:${params.paymentMethod}:${params.fireMode}:${Math.round(params.amount * 100)}`;
}

export async function asaasFetch(path: string, init: RequestInit = {}) {
  const base = Deno.env.get("ASAAS_API_BASE_URL") || "https://api.asaas.com/v3";
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      access_token: env("ASAAS_API_KEY"),
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text.slice(0, 500) };
    }
  }
  if (!res.ok) throw new AsaasApiError(res.status, body);
  return body as any;
}

export function sanitizeAsaasResponse(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw.map(sanitizeAsaasResponse);
  if (!raw || typeof raw !== "object") return raw;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (
      lower.includes("creditcard") ||
      lower.includes("card") ||
      lower.includes("ccv") ||
      lower.includes("cvv")
    ) {
      out[key] = "[redacted]";
    } else {
      out[key] = sanitizeAsaasResponse(value);
    }
  }
  return out;
}

export function mapAsaasStatus(status: unknown) {
  const s = String(status || "").toUpperCase();
  const map: Record<string, string> = {
    PENDING: "pending",
    AWAITING_RISK_ANALYSIS: "risk_analysis",
    APPROVED_BY_RISK_ANALYSIS: "approved",
    REPROVED_BY_RISK_ANALYSIS: "refused",
    CONFIRMED: "confirmed",
    RECEIVED: "paid",
    RECEIVED_IN_CASH: "paid",
    OVERDUE: "overdue",
    DELETED: "cancelled",
    RESTORED: "pending",
    REFUNDED: "refunded",
    PARTIALLY_REFUNDED: "partially_refunded",
    REFUND_IN_PROGRESS: "refund_processing",
    REFUND_REQUESTED: "refund_processing",
    REFUND_DENIED: "refund_denied",
    CHARGEBACK_REQUESTED: "chargeback",
    CHARGEBACK_DISPUTE: "chargeback_dispute",
    AWAITING_CHARGEBACK_REVERSAL: "chargeback",
    BANK_SLIP_CANCELLED: "cancelled",
    CREDIT_CARD_CAPTURE_REFUSED: "refused",
  };
  return map[s] || "pending";
}

export function mapAsaasEvent(event: unknown) {
  const e = String(event || "").toUpperCase();
  const map: Record<string, string> = {
    PAYMENT_CREATED: "pending",
    PAYMENT_UPDATED: "pending",
    PAYMENT_AWAITING_RISK_ANALYSIS: "risk_analysis",
    PAYMENT_APPROVED_BY_RISK_ANALYSIS: "approved",
    PAYMENT_REPROVED_BY_RISK_ANALYSIS: "refused",
    PAYMENT_CONFIRMED: "confirmed",
    PAYMENT_RECEIVED: "paid",
    PAYMENT_OVERDUE: "overdue",
    PAYMENT_DELETED: "cancelled",
    PAYMENT_RESTORED: "pending",
    PAYMENT_REFUNDED: "refunded",
    PAYMENT_PARTIALLY_REFUNDED: "partially_refunded",
    PAYMENT_REFUND_IN_PROGRESS: "refund_processing",
    PAYMENT_REFUND_DENIED: "refund_denied",
    PAYMENT_CHARGEBACK_REQUESTED: "chargeback",
    PAYMENT_CHARGEBACK_DISPUTE: "chargeback_dispute",
    PAYMENT_AWAITING_CHARGEBACK_REVERSAL: "chargeback",
    PAYMENT_BANK_SLIP_CANCELLED: "cancelled",
    PAYMENT_CREDIT_CARD_CAPTURE_REFUSED: "refused",
  };
  return map[e] || mapAsaasStatus((event as string)?.replace(/^PAYMENT_/, ""));
}

export async function hashPayload(payload: unknown) {
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Decide quem recebe boleto/e-mail/SMS com base no seletor "Imobiliaria/
// Inquilino" ja existente e preenchido em consultas.$id.dados-complementares
// (payment_type/billing_responsible_role) - nunca confia em e-mail/telefone
// vindos do frontend, so no que ja esta salvo na consulta. Sem fallback pra
// outra pessoa: se o responsavel escolhido nao tiver contato cadastrado, o
// campo correspondente volta null e quem chama decide o que fazer (nao
// inventa destinatario).
export type PaymentResponsible = "agency" | "tenant";
export type PaymentRecipient = {
  paymentResponsible: PaymentResponsible;
  recipientType: "user" | "tenant";
  recipientUserId: string | null;
  recipientTenantId: string | null;
  recipientName: string | null;
  recipientEmail: string | null;
  recipientPhone: string | null;
};

export function resolvePaymentRecipient(consulta: any): PaymentRecipient {
  const isAgency = consulta?.payment_type === "imobiliaria" || consulta?.billing_responsible_role === "imobiliaria";

  if (isAgency) {
    const responsavel = consulta?.responsavel_profile;
    return {
      paymentResponsible: "agency",
      recipientType: "user",
      recipientUserId: consulta?.profile_id_solicitante || null,
      recipientTenantId: null,
      recipientName: responsavel?.nome || null,
      recipientEmail: responsavel?.email || null,
      recipientPhone: responsavel?.telefone || null,
    };
  }

  return {
    paymentResponsible: "tenant",
    recipientType: "tenant",
    recipientUserId: null,
    recipientTenantId: consulta?.tenant_user_id || null,
    recipientName: consulta?.tenant_name || null,
    recipientEmail: consulta?.tenant_email || null,
    recipientPhone: consulta?.tenant_telefone || null,
  };
}

// Busca o QR Code Pix de uma cobranca ja criada no Asaas e persiste no banco.
// So e chamada quando o pagamento local existe mas ficou sem pix_qr_code/
// pix_copy_paste (falha transitoria na primeira tentativa) - nunca cria uma
// cobranca nova, so tenta buscar de novo os dados que faltaram.
export async function refetchPixQrCode(supabase: any, localPayment: any) {
  if (!localPayment?.asaas_payment_id) return localPayment;
  if (localPayment.pix_qr_code || localPayment.pix_copy_paste) return localPayment;
  try {
    const pix = await asaasFetch(`/payments/${localPayment.asaas_payment_id}/pixQrCode`);
    const pixQrCode = pix?.encodedImage || null;
    const pixCopyPaste = pix?.payload || null;
    const pixExpiresAt = pix?.expirationDate || null;
    if (!pixQrCode && !pixCopyPaste) return localPayment;

    const { data: atualizado } = await supabase
      .from("asaas_payments")
      .update({ pix_qr_code: pixQrCode, pix_copy_paste: pixCopyPaste, pix_expires_at: pixExpiresAt })
      .eq("id", localPayment.id)
      .select()
      .maybeSingle();
    return atualizado || { ...localPayment, pix_qr_code: pixQrCode, pix_copy_paste: pixCopyPaste, pix_expires_at: pixExpiresAt };
  } catch (error) {
    console.error("[asaas] retry QR Pix falhou", {
      paymentId: localPayment.asaas_payment_id,
      message: error instanceof Error ? error.message : String(error),
    });
    return localPayment;
  }
}

// E-mail transacional de pagamento, reaproveitando o mesmo Resend ja usado
// em notificar-time-comercial - nao cria uma segunda integracao de e-mail.
export async function sendPaymentEmail(params: {
  to: string;
  nome: string;
  tipo: "criado" | "confirmado";
  valor: number;
  metodo: string;
  vencimento?: string | null;
  pixCopyPaste?: string | null;
  boletoUrl?: string | null;
  boletoBarcode?: string | null;
  contratoRef?: string | null;
}) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey || !params.to) {
    console.error("[asaas] e-mail de pagamento nao enviado", {
      reason: !apiKey ? "RESEND_API_KEY ausente" : "destinatario ausente",
      tipo: params.tipo,
    });
    return { sent: false, reason: !apiKey ? "not_configured" : "missing_recipient" };
  }

  const from = Deno.env.get("RESEND_FROM_EMAIL") || "NOX FIANÇA <financeiro@noxfianca.com.br>";
  const valorFmt = params.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const metodoLabel =
    params.metodo === "pix" ? "Pix" : params.metodo === "boleto" ? "Boleto" : "Cartão de crédito";

  const assunto =
    params.tipo === "criado" ? "Pagamento gerado — NOX Fiança" : "Pagamento confirmado — NOX Fiança";

  const corpo =
    params.tipo === "criado"
      ? `
        <p>Olá, ${params.nome}.</p>
        <p>Seu pagamento da NOX Fiança foi gerado com sucesso.</p>
        <p>
          ${params.contratoRef ? `<strong>Contrato:</strong> ${params.contratoRef}<br/>` : ""}
          <strong>Forma de pagamento:</strong> ${metodoLabel}<br/>
          <strong>Valor:</strong> ${valorFmt}<br/>
          ${params.vencimento ? `<strong>Vencimento:</strong> ${params.vencimento}<br/>` : ""}
          <strong>Status:</strong> Aguardando pagamento
        </p>
        ${params.pixCopyPaste ? `<p><strong>Código Pix copia e cola:</strong><br/><code>${params.pixCopyPaste}</code></p>` : ""}
        ${params.boletoBarcode ? `<p><strong>Linha digitável:</strong><br/><code>${params.boletoBarcode}</code></p>` : ""}
        ${params.boletoUrl ? `<p><a href="${params.boletoUrl}">Visualizar boleto</a></p>` : ""}
        <p>Para acompanhar o pagamento, acesse sua conta na NOX Fiança.</p>
      `
      : `
        <p>Olá, ${params.nome}.</p>
        <p>Recebemos o pagamento${params.contratoRef ? ` da ${params.contratoRef}` : ""} do seu contrato da NOX Fiança.</p>
        <p>
          ${params.vencimento ? `<strong>Mês de referência:</strong> ${mesReferenciaLabel(params.vencimento)}<br/>` : ""}
          <strong>Valor:</strong> ${valorFmt}<br/>
          <strong>Forma de pagamento:</strong> ${metodoLabel}<br/>
          <strong>Status:</strong> Pago
        </p>
        <p>A atualização já está disponível na aba Minhas Faturas da sua conta.</p>
      `;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [params.to], subject: assunto, html: corpo }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("[asaas] falha ao enviar e-mail de pagamento", { status: res.status, text: text.slice(0, 300) });
      return { sent: false, reason: "provider_error" };
    }
    return { sent: true };
  } catch (error) {
    console.error("[asaas] erro ao enviar e-mail de pagamento", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { sent: false, reason: "exception" };
  }
}

// Nenhum provedor de SMS esta integrado neste projeto ainda. Esta funcao
// existe pra ja deixar o ponto de chamada pronto (create-payment/webhook) -
// quando SMS_API_KEY/SMS_PROVIDER_URL forem configurados no ambiente das
// Edge Functions, o envio passa a acontecer de verdade. Ate la, nunca simula
// envio nem marca como enviado - so registra que falta credencial.
export async function sendPaymentSms(params: { to: string; mensagem: string }) {
  const apiKey = Deno.env.get("SMS_API_KEY");
  const providerUrl = Deno.env.get("SMS_PROVIDER_URL");
  const digits = String(params.to || "").replace(/\D/g, "");
  const normalizedPhone = digits
    ? digits.startsWith("55")
      ? `+${digits}`
      : `+55${digits}`
    : "";

  if (!apiKey || !providerUrl) {
    console.error("[asaas] SMS nao enviado: provedor de SMS nao configurado (SMS_API_KEY/SMS_PROVIDER_URL ausentes)");
    return { sent: false, reason: "not_configured" };
  }
  if (!normalizedPhone || digits.length < 10) {
    console.error("[asaas] SMS nao enviado: telefone ausente ou invalido");
    return { sent: false, reason: "invalid_phone" };
  }

  try {
    const res = await fetch(providerUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: normalizedPhone, message: params.mensagem }),
    });
    if (!res.ok) {
      console.error("[asaas] falha ao enviar SMS", { status: res.status });
      return { sent: false, reason: "provider_error" };
    }
    return { sent: true };
  } catch (error) {
    console.error("[asaas] erro ao enviar SMS", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { sent: false, reason: "exception" };
  }
}

function maskEmail(email?: string | null) {
  if (!email) return null;
  const [user, domain] = email.split("@");
  if (!domain) return email;
  const visible = user.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(user.length - 2, 2))}@${domain}`;
}

function maskPhone(phone?: string | null) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length < 4) return phone;
  const last4 = digits.slice(-4);
  return `+55 (***) *****-${last4}`;
}

export const MESES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

// "2026-07-15" -> "Julho de 2026" - usado em e-mails de confirmacao de
// pagamento pra mostrar o mes de referencia da mensalidade, nao a data crua.
export function mesReferenciaLabel(isoDate: string) {
  const [ano, mes] = isoDate.split("-").map(Number);
  if (!ano || !mes) return isoDate;
  return `${MESES_PT[mes - 1]} de ${ano}`;
}

export function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatDateBr(isoDate: string) {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

// Parcela mensal recorrente (usada nas 12 mensalidades quando o responsavel
// e o inquilino) - sempre premioMensal + pinturaMensal + incendioMensal,
// sem a distincao a-vista/embutido de calculateExpectedPayment (que e so pra
// cobranca inicial de ativacao). Nao inclui taxa de ativacao: essa e um
// valor avulso, nao deve ser diluida nas parcelas recorrentes.
export function calculateMonthlyInstallmentValue(consulta: any) {
  const imovel = consulta?.imoveis || {};
  const docs =
    typeof consulta?.documentos === "object" && consulta?.documentos ? consulta.documentos : {};
  const extras = docs.extras || {};
  const aluguel = toMoney(imovel.valor_aluguel || consulta?.rent_value || consulta?.valor_aluguel);
  const premioMensal = toMoney(consulta?.valor_premio_mensal);
  const pinturaTotal =
    (consulta?.external_painting_enabled ?? extras.external_painting_enabled)
      ? toMoney(consulta?.external_painting_total ?? extras.external_painting_total)
      : 0;
  const pinturaMensal =
    (consulta?.external_painting_enabled ?? extras.external_painting_enabled)
      ? toMoney(consulta?.external_painting_installment ?? extras.external_painting_installment) ||
        (pinturaTotal > 0 ? toMoney(pinturaTotal / 3) : 0)
      : 0;
  const subtipo = String(consulta?.imovel_subtipo || imovel.tipo || "").toLowerCase();
  const tipoImovel: "residencial" | "comercial" =
    /comercial|consult|clinica|cl[ií]nica|industria|ind[uú]stria|servico|servi[cç]o|armazem|armaz[eé]m/.test(
      subtipo,
    )
      ? "comercial"
      : "residencial";
  const incendioAnual = toMoney(aluguel * (calcularPercentualIncendio(tipoImovel, aluguel) / 100));
  const incendioMensal = toMoney(incendioAnual / 12);
  return toMoney(premioMensal + pinturaMensal + incendioMensal);
}

export type InstallmentScheduleItem = {
  installmentNumber: number;
  dueDate: string;
  referenceMonth: number;
  referenceYear: number;
};

// Gera N datas mensais a partir de firstDueDate, tratando corretamente virada
// de ano e dia que nao existe no mes de destino (ex.: dia 31 em fevereiro ->
// ultimo dia valido daquele mes). Nunca usa nomes/anos fixos.
export function generateInstallmentSchedule(params: {
  firstDueDate: string; // yyyy-mm-dd
  count: number;
}): InstallmentScheduleItem[] {
  const [y0, m0, d0] = params.firstDueDate.split("-").map(Number);
  const items: InstallmentScheduleItem[] = [];
  for (let i = 0; i < params.count; i++) {
    const offsetIndex = m0 - 1 + i; // 0-based
    const year = y0 + Math.floor(offsetIndex / 12);
    const month = (offsetIndex % 12) + 1; // 1-based
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const day = Math.min(d0, lastDay);
    items.push({
      installmentNumber: i + 1,
      dueDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      referenceMonth: month,
      referenceYear: year,
    });
  }
  return items;
}

// E-mail consolidado com o cronograma completo das 12 mensalidades -
// disparado uma unica vez na criacao do plano (nunca 12 e-mails separados
// nesse momento; os lembretes individuais ficam por conta de
// process-scheduled-invoice-notifications).
export async function sendInstallmentScheduleEmail(params: {
  to: string;
  nome: string;
  installments: (InstallmentScheduleItem & { value: number })[];
}) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey || !params.to) {
    console.error("[asaas] e-mail de cronograma nao enviado", {
      reason: !apiKey ? "RESEND_API_KEY ausente" : "destinatario ausente",
    });
    return { sent: false, reason: !apiKey ? "not_configured" : "missing_recipient" };
  }
  const from = Deno.env.get("RESEND_FROM_EMAIL") || "NOX FIANÇA <financeiro@noxfianca.com.br>";
  const primeira = params.installments[0];
  const ultima = params.installments[params.installments.length - 1];
  const linhas = params.installments
    .map(
      (p) =>
        `<li>Mês ${p.installmentNumber} — ${MESES_PT[p.referenceMonth - 1]} de ${p.referenceYear} — Vencimento ${formatDateBr(p.dueDate)} — ${formatBRL(p.value)}</li>`,
    )
    .join("");
  const corpo = `
    <p>Olá, ${params.nome}.</p>
    <p>Os ${params.installments.length} boletos mensais referentes ao seu contrato da NOX Fiança foram gerados.</p>
    <p>
      Quantidade de mensalidades: ${params.installments.length}<br/>
      Valor de cada mensalidade: ${formatBRL(primeira.value)}<br/>
      Primeiro vencimento: ${formatDateBr(primeira.dueDate)}<br/>
      Último vencimento: ${formatDateBr(ultima.dueDate)}
    </p>
    <ul>${linhas}</ul>
    <p>Todos os boletos estão disponíveis na aba Minhas Faturas da sua conta.</p>
  `;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: `Seus ${params.installments.length} boletos foram gerados — NOX Fiança`,
        html: corpo,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("[asaas] falha ao enviar e-mail de cronograma", { status: res.status, text: text.slice(0, 300) });
      return { sent: false, reason: "provider_error" };
    }
    return { sent: true };
  } catch (error) {
    console.error("[asaas] erro ao enviar e-mail de cronograma", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { sent: false, reason: "exception" };
  }
}

export async function sendInstallmentScheduleSms(params: {
  to: string;
  installments: (InstallmentScheduleItem & { value: number })[];
}) {
  const primeira = params.installments[0];
  return sendPaymentSms({
    to: params.to,
    mensagem: `NOX Fiança: seus ${params.installments.length} boletos foram gerados. A 1ª mensalidade de ${formatBRL(primeira.value)} vence em ${formatDateBr(primeira.dueDate)}. Consulte todos os meses na aba Minhas Faturas.`,
  });
}

// Nenhum provedor de WhatsApp esta integrado neste projeto ainda. Mesmo
// padrao do SMS: nunca simula envio nem marca como enviado - so registra que
// falta credencial ate WHATSAPP_API_KEY/WHATSAPP_PROVIDER_URL existirem.
export async function sendPaymentWhatsapp(params: { to: string; mensagem: string }) {
  const apiKey = Deno.env.get("WHATSAPP_API_KEY");
  const providerUrl = Deno.env.get("WHATSAPP_PROVIDER_URL");
  const digits = String(params.to || "").replace(/\D/g, "");
  const normalizedPhone = digits ? (digits.startsWith("55") ? `+${digits}` : `+55${digits}`) : "";

  if (!apiKey || !providerUrl) {
    console.error("[asaas] WhatsApp nao enviado: provedor nao configurado (WHATSAPP_API_KEY/WHATSAPP_PROVIDER_URL ausentes)");
    return { sent: false, reason: "not_configured" };
  }
  if (!normalizedPhone || digits.length < 10) {
    console.error("[asaas] WhatsApp nao enviado: telefone ausente ou invalido");
    return { sent: false, reason: "invalid_phone" };
  }

  try {
    const res = await fetch(providerUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: normalizedPhone, message: params.mensagem }),
    });
    if (!res.ok) {
      console.error("[asaas] falha ao enviar WhatsApp", { status: res.status });
      return { sent: false, reason: "provider_error" };
    }
    return { sent: true };
  } catch (error) {
    console.error("[asaas] erro ao enviar WhatsApp", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { sent: false, reason: "exception" };
  }
}

// Idempotencia de notificacoes financeiras - evita reenviar e-mail/SMS/
// WhatsApp quando o Asaas reentrega o mesmo webhook ou o cron roda de novo
// sobre a mesma janela ja processada.
export async function wasNotificationSent(
  supabase: any,
  params: { invoiceId?: string | null; batchId?: string | null; channel: "email" | "sms" | "whatsapp"; notificationType: string },
) {
  let query = supabase
    .from("financial_notifications")
    .select("id")
    .eq("channel", params.channel)
    .eq("notification_type", params.notificationType)
    .eq("status", "sent");
  query = params.invoiceId ? query.eq("invoice_id", params.invoiceId) : query.eq("batch_id", params.batchId);
  const { data } = await query.maybeSingle();
  return !!data;
}

export async function logFinancialNotification(
  supabase: any,
  params: {
    invoiceId?: string | null;
    batchId?: string | null;
    recipientType: "user" | "tenant";
    recipientId?: string | null;
    channel: "email" | "sms" | "whatsapp";
    notificationType: string;
    result: { sent: boolean; reason?: string };
  },
) {
  let existingQuery = supabase
    .from("financial_notifications")
    .select("id, attempts")
    .eq("channel", params.channel)
    .eq("notification_type", params.notificationType);
  existingQuery = params.invoiceId
    ? existingQuery.eq("invoice_id", params.invoiceId)
    : existingQuery.eq("batch_id", params.batchId);
  const { data: existing } = await existingQuery.maybeSingle();

  const status = params.result.sent ? "sent" : params.result.reason === "not_configured" ? "not_configured" : "failed";
  const { error } = await supabase.from("financial_notifications").upsert(
    {
      invoice_id: params.invoiceId || null,
      batch_id: params.batchId || null,
      recipient_type: params.recipientType,
      recipient_id: params.recipientId || null,
      channel: params.channel,
      notification_type: params.notificationType,
      status,
      attempts: (existing?.attempts || 0) + 1,
      last_error: params.result.sent ? null : params.result.reason || null,
      sent_at: params.result.sent ? new Date().toISOString() : null,
    },
    { onConflict: params.invoiceId ? "invoice_id,channel,notification_type" : "batch_id,channel,notification_type" },
  );
  if (error) {
    console.error("[asaas] falha ao registrar financial_notifications (idempotencia pode nao ter sido salva)", {
      invoiceId: params.invoiceId,
      batchId: params.batchId,
      channel: params.channel,
      notificationType: params.notificationType,
      error: error.message,
    });
  }
}

// Cancela uma cobranca ja criada no Asaas - usado na reconciliacao do lote
// consolidado (as cobrancas individuais que ainda estavam abertas sao
// canceladas depois que o boleto consolidado e pago, pra impedir pagamento
// duplicado).
export async function cancelAsaasPayment(paymentId: string) {
  try {
    await asaasFetch(`/payments/${paymentId}`, { method: "DELETE" });
    return { cancelled: true };
  } catch (error) {
    console.error("[asaas] falha ao cancelar cobranca", {
      paymentId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { cancelled: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function normalizedPaymentResponse(payment: any, local: any = {}) {
  const method = local.payment_method || local.paymentMethod || payment?.billingType;
  return {
    success: true,
    paymentId: local.asaas_payment_id || payment?.id || null,
    externalReference: local.external_reference || payment?.externalReference || null,
    status: local.status || mapAsaasStatus(payment?.status),
    paymentMethod: String(method || "").toLowerCase(),
    amount: toMoney(local.value ?? payment?.value),
    dueDate: local.due_date || payment?.dueDate || null,
    invoiceUrl: payment?.invoiceUrl || payment?.bankSlipUrl || local.boleto_url || null,
    pix:
      local.pix_copy_paste || local.pix_qr_code
        ? {
            qrCode: local.pix_copy_paste || "",
            qrCodeBase64: local.pix_qr_code || "",
            expiresAt: local.pix_expires_at || null,
          }
        : null,
    boleto:
      local.boleto_barcode ||
      local.boleto_url ||
      payment?.identificationField ||
      payment?.bankSlipUrl
        ? {
            barcode: local.boleto_barcode || payment?.identificationField || "",
            pdfUrl: local.boleto_url || payment?.bankSlipUrl || payment?.invoiceUrl || "",
            dueDate: local.due_date || payment?.dueDate || null,
          }
        : null,
    recipient:
      local.payment_responsible || local.recipient_type
        ? {
            responsible: local.payment_responsible || null,
            type: local.recipient_type || null,
            emailMasked: maskEmail(local.recipient_email),
            phoneMasked: maskPhone(local.recipient_phone),
          }
        : null,
  };
}
