import { Resend } from "resend";

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
    template: {
      id: process.env.RESEND_VERIFY_TEMPLATE_ID!,
      variables: {
        nome: nome || "cliente",
        verification_link: verificationLink,
      },
    },
  } as any);

  if (error) {
    console.error("[Resend] Falha ao enviar e-mail de verificação:", error);
    return { sent: false as const };
  }

  return { sent: true as const, id: data?.id };
}
