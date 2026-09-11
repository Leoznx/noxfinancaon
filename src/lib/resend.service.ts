import { Resend } from "resend";
import { escapeEmailHtml, renderNoxEmail } from "@/lib/email-branding";

let _resend: Resend | undefined;

function getResend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

// Server-only — nunca importar a partir de código de cliente (RESEND_API_KEY não é público).
export async function sendVerificationEmail({
  email,
  nome,
  verificationLink,
}: {
  email: string;
  nome: string;
  verificationLink: string;
}) {
  const { data, error } = await getResend().emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: [email],
    subject: "Verifique seu e-mail | NOX Fiança",
    reply_to: process.env.RESEND_REPLY_TO,
    html: renderNoxEmail(
      `
        <h1 style="font-size:24px;line-height:1.25;margin:0 0 18px">Confirme seu e-mail</h1>
        <p>Olá, ${escapeEmailHtml(nome || "cliente")}.</p>
        <p>Confirme seu e-mail para concluir a criação do seu acesso à NOX Fiança.</p>
        <p style="font-size:13px;color:#666666">Este link de verificação é válido por 5 dias.</p>
        <p style="margin:26px 0">
          <a href="${escapeEmailHtml(verificationLink)}" style="display:inline-block;background:#ffd60a;color:#171717;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:10px">Verificar meu e-mail</a>
        </p>
        <p style="font-size:13px;color:#666666">Se você não criou este acesso, ignore esta mensagem.</p>
      `,
      "Confirme seu e-mail para acessar a NOX Fiança.",
    ),
  } as any);

  if (error) {
    console.error("[Resend] Falha ao enviar e-mail de verificação:", error);
    return { sent: false as const };
  }

  return { sent: true as const, id: data?.id };
}

// Server-only — avisa o responsável comercial depois que o cadastro já foi
// atribuído no ranking. Em vínculos compartilhados, o chamador envia uma
// mensagem independente ao SDR e ao Closer retornados pela RPC transacional.
export async function sendSellerSignupNotificationEmail({
  email,
  nome,
  clientName,
  profileRole,
  rankingUrl,
}: {
  email: string;
  nome: string;
  clientName: string;
  profileRole: "proprietario" | "imobiliaria" | "corretor";
  rankingUrl: string;
}) {
  const roleLabel =
    profileRole === "proprietario"
      ? "proprietário"
      : profileRole === "imobiliaria"
        ? "imobiliária"
        : "corretor";
  const { data, error } = await getResend().emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: [email],
    subject: "Novo cadastro pelo seu link | NOX Fiança",
    reply_to: process.env.RESEND_REPLY_TO,
    html: renderNoxEmail(
      `
        <h1 style="font-size:24px;line-height:1.25;margin:0 0 18px">Seu link gerou um novo cadastro</h1>
        <p>Olá, ${escapeEmailHtml(nome || "consultor")}.</p>
        <p><strong>${escapeEmailHtml(clientName || "Um novo cliente")}</strong> concluiu o cadastro como ${roleLabel} usando um link vinculado a você.</p>
        <p>O cadastro já foi contabilizado no ranking comercial.</p>
        <p style="margin:26px 0">
          <a href="${escapeEmailHtml(rankingUrl)}" style="display:inline-block;background:#ffd60a;color:#171717;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:10px">Ver meu ranking</a>
        </p>
      `,
      "Um novo cadastro foi contabilizado no seu ranking NOX.",
    ),
  } as any);

  if (error) {
    console.error("[Resend] Falha ao avisar cadastro do link:", error);
    return { sent: false as const };
  }
  return { sent: true as const, id: data?.id };
}

// Server-only — nunca importar a partir de código de cliente (RESEND_API_KEY não é público).
export async function sendPasswordResetEmail({
  email,
  nome,
  resetLink,
}: {
  email: string;
  nome: string;
  resetLink: string;
}) {
  const { data, error } = await getResend().emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: [email],
    subject: "Redefina sua senha | NOX Fiança",
    reply_to: process.env.RESEND_REPLY_TO,
    html: renderNoxEmail(
      `
        <h1 style="font-size:24px;line-height:1.25;margin:0 0 18px">Redefina sua senha</h1>
        <p>Olá, ${escapeEmailHtml(nome || "cliente")}.</p>
        <p>Recebemos uma solicitação para redefinir a senha do seu acesso à NOX Fiança.</p>
        <p style="margin:26px 0">
          <a href="${escapeEmailHtml(resetLink)}" style="display:inline-block;background:#ffd60a;color:#171717;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:10px">Criar nova senha</a>
        </p>
        <p style="font-size:13px;color:#666666">Se você não solicitou a redefinição, ignore esta mensagem.</p>
      `,
      "Use este link seguro para criar uma nova senha.",
    ),
  } as any);

  if (error) {
    console.error("[Resend] Falha ao enviar e-mail de redefinição de senha:", error);
    return { sent: false as const };
  }

  return { sent: true as const, id: data?.id };
}
