import { escapeEmailHtml } from "./email-branding.ts";

export type PaymentNotificationMethod = "pix" | "boleto" | "credit_card" | string;

export type PaymentNotificationAction = {
  id: string;
  type: "URL";
  label: string;
  url: string;
};

export type PaymentRequestContentInput = {
  name?: string | null;
  method: PaymentNotificationMethod;
  amount: number;
  dueDate?: string | null;
  contractRef?: string | null;
  paymentUrl?: string | null;
  primaryActionLabel?: string;
  secondaryPaymentUrl?: string | null;
  secondaryActionLabel?: string;
  cardRegistration?: boolean;
};

function firstName(value: string | null | undefined) {
  const first =
    String(value || "")
      .trim()
      .split(/\s+/u)[0]
      .slice(0, 80) || "Cliente";
  const normalized = first.toLocaleLowerCase("pt-BR");
  return `${normalized.charAt(0).toLocaleUpperCase("pt-BR")}${normalized.slice(1)}`;
}

function formatMoney(value: number) {
  return Number(value || 0)
    .toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    .replaceAll("\u00a0", " ");
}

function formatDate(value: string | null | undefined) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || "").trim();
}

function methodLabel(method: PaymentNotificationMethod) {
  if (method === "pix") return "Pix";
  if (method === "boleto") return "Boleto";
  return "Cartão de crédito";
}

function safePaymentUrl(value: string | null | undefined) {
  try {
    const parsed = new URL(String(value || "").trim());
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function paymentNotificationActions(
  input: Pick<
    PaymentRequestContentInput,
    "paymentUrl" | "primaryActionLabel" | "secondaryPaymentUrl" | "secondaryActionLabel"
  >,
): PaymentNotificationAction[] {
  const primaryUrl = safePaymentUrl(input.paymentUrl);
  const secondaryUrl = safePaymentUrl(input.secondaryPaymentUrl);
  return [
    ...(primaryUrl
      ? [
          {
            id: "pagar-nox",
            type: "URL" as const,
            label: input.primaryActionLabel || "Pagar",
            url: primaryUrl,
          },
        ]
      : []),
    ...(secondaryUrl && secondaryUrl !== primaryUrl
      ? [
          {
            id: "ativar-mensalidades-nox",
            type: "URL" as const,
            label: input.secondaryActionLabel || "Ativar mensalidades",
            url: secondaryUrl,
          },
        ]
      : []),
  ];
}

export function buildPaymentRequestWhatsappContent(input: PaymentRequestContentInput) {
  const actions = paymentNotificationActions(input);
  const combinedCardCheckout = input.method === "credit_card" && actions.length > 1;
  const rows = [
    input.contractRef ? `• Contrato: ${String(input.contractRef).trim()}` : null,
    `• Forma: ${methodLabel(input.method)}`,
    `${combinedCardCheckout ? "• Valor inicial" : input.cardRegistration ? "• Mensalidade" : "• Valor"}: ${formatMoney(input.amount)}`,
    input.dueDate ? `• Vencimento: ${formatDate(input.dueDate)}` : null,
  ].filter(Boolean);
  const intro = combinedCardCheckout
    ? "Seu pagamento no cartão está pronto."
    : input.cardRegistration
      ? "A autorização do cartão está pronta."
      : "Seu pagamento NOX Fiança está pronto.";
  const instruction = combinedCardCheckout
    ? "Pague o valor inicial e ative as mensalidades pelos botões abaixo. 🔒"
    : actions.length
      ? `Toque em *${actions[0].label}* para continuar. 🔒`
      : "Acompanhe o pagamento na sua conta NOX Fiança.";

  return {
    title: "NOX Fiança • Pagamento",
    message: `Olá, ${firstName(input.name)}! 👋\n\n${intro}\n${rows.join("\n")}\n\n${instruction}`,
    buttonActions: actions,
  };
}

function summaryRow(label: string, value: string) {
  return `<tr>
    <td style="padding:6px 0;color:#6b6b6b">${escapeEmailHtml(label)}</td>
    <td align="right" style="padding:6px 0;color:#171717;font-weight:700">${escapeEmailHtml(value)}</td>
  </tr>`;
}

function emailButton(action: PaymentNotificationAction, primary: boolean) {
  const background = primary ? "#ffd60a" : "#171717";
  const color = primary ? "#171717" : "#ffffff";
  return `<a href="${escapeEmailHtml(action.url)}" style="display:inline-block;margin:6px 6px 0 0;padding:13px 22px;border-radius:10px;background:${background};color:${color};font-weight:800;text-decoration:none">${escapeEmailHtml(action.label === "Pagar" ? "Ir para pagamento" : action.label)}</a>`;
}

export function buildPaymentRequestEmailContent(input: PaymentRequestContentInput) {
  const actions = paymentNotificationActions(input);
  const combinedCardCheckout = input.method === "credit_card" && actions.length > 1;
  const title = combinedCardCheckout
    ? "Finalize seu pagamento no cartão"
    : input.cardRegistration
      ? "Autorize seu cartão"
      : "Pagamento disponível";
  const description = combinedCardCheckout
    ? "Conclua o pagamento inicial e, em seguida, ative as mensalidades do seu contrato."
    : input.cardRegistration
      ? "Autorize o cartão que será usado nas mensalidades do seu contrato."
      : "Sua cobrança da NOX Fiança está pronta para pagamento.";
  const rows = [
    input.contractRef ? summaryRow("Contrato", String(input.contractRef).trim()) : "",
    summaryRow("Forma de pagamento", methodLabel(input.method)),
    summaryRow(
      combinedCardCheckout ? "Valor inicial" : input.cardRegistration ? "Mensalidade" : "Valor",
      formatMoney(input.amount),
    ),
    input.dueDate ? summaryRow("Vencimento", formatDate(input.dueDate)) : "",
  ].join("");
  const buttons = actions.map((action, index) => emailButton(action, index === 0)).join("");

  return {
    subject: `${title} — NOX Fiança`,
    preheader: `${title}. Acesse o link seguro para continuar.`,
    html: `
      <p style="margin:0 0 12px">Olá, ${escapeEmailHtml(firstName(input.name))}.</p>
      <h1 style="margin:0 0 8px;font-size:24px;line-height:1.2;color:#171717">${escapeEmailHtml(title)}</h1>
      <p style="margin:0 0 20px;color:#555555">${escapeEmailHtml(description)}</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 18px;padding:14px 18px;background:#f7f7f7;border:1px solid #ececec;border-radius:12px">
        ${rows}
      </table>
      ${buttons ? `<div style="margin-top:4px">${buttons}</div>` : ""}
      <p style="margin:18px 0 0;color:#777777;font-size:13px">Link seguro processado pelo Asaas.</p>
    `,
  };
}
