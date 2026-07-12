import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  formatBRL,
  formatDateBr,
  jsonResponse,
  logFinancialNotification,
  sendPaymentEmail,
  sendPaymentSms,
  sendPaymentWhatsapp,
  supabaseAdmin,
  wasNotificationSent,
} from "../_shared/asaas.ts";

// Chamada diariamente pelo pg_cron (ver migration 20260714000020) via
// net.http_post, autenticada por um segredo compartilhado (nunca por sessao
// de usuario - cron nao tem uma). Roda os 3 ciclos de lembrete (10/5/0 dias
// antes do vencimento) de cada mensalidade individual em aberto, respeitando
// o destinatario ja salvo na cobranca (nunca recalcula), idempotente via
// financial_notifications.
// "confirmed" entra aqui porque PAYMENT_CONFIRMED ja significa pago pro
// inquilino (so nao teve o valor liquidado ainda) - sem isso, o lembrete de
// vencimento continuaria disparando entre a confirmacao e o recebimento.
const STATUS_EXCLUIDOS = ["confirmed", "paid", "paid_via_consolidated", "cancelled", "refunded", "partially_refunded"];

const CICLOS: { dias: number; tipo: string; rotulo: string }[] = [
  { dias: 10, tipo: "invoice_due_10_days", rotulo: "10 dias" },
  { dias: 5, tipo: "invoice_due_5_days", rotulo: "5 dias" },
  { dias: 0, tipo: "invoice_due_today", rotulo: "hoje" },
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST")
    return jsonResponse(req, { ok: false, error: "Metodo nao permitido." }, 405);

  const expectedSecret = Deno.env.get("CRON_NOTIFICATIONS_SECRET") || "";
  const providedSecret = req.headers.get("x-cron-secret") || "";
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return jsonResponse(req, { ok: false, error: "Nao autorizado." }, 401);
  }

  const supabase = supabaseAdmin();
  const hojeSaoPaulo = dataAtualSaoPaulo();

  const resumo: Record<string, { processadas: number; emailEnviados: number; smsEnviados: number; whatsappEnviados: number }> = {};

  for (const ciclo of CICLOS) {
    resumo[ciclo.tipo] = { processadas: 0, emailEnviados: 0, smsEnviados: 0, whatsappEnviados: 0 };
    const alvo = adicionarDias(hojeSaoPaulo, ciclo.dias);

    const { data: faturas, error } = await supabase
      .from("faturas_inquilino")
      .select("*, asaas_payment:asaas_payments(recipient_type, recipient_user_id, recipient_tenant_id, recipient_name, recipient_email, recipient_phone)")
      .eq("vencimento", alvo)
      .not("status", "in", `(${STATUS_EXCLUIDOS.join(",")})`);

    if (error) {
      console.error("[process-scheduled-invoice-notifications] falha ao buscar faturas", {
        ciclo: ciclo.tipo,
        error: error.message,
      });
      continue;
    }

    for (const fatura of faturas ?? []) {
      const recipient = fatura.asaas_payment;
      if (!recipient) continue;
      resumo[ciclo.tipo].processadas += 1;

      const nome = recipient.recipient_name || "cliente";
      const valorFmt = formatBRL(Number(fatura.valor));
      const vencFmt = formatDateBr(fatura.vencimento);
      const recipientId = recipient.recipient_tenant_id || recipient.recipient_user_id;
      const recipientType = recipient.recipient_type === "user" ? "user" : "tenant";

      if (recipient.recipient_email) {
        const jaEnviado = await wasNotificationSent(supabase, {
          invoiceId: fatura.id,
          channel: "email",
          notificationType: ciclo.tipo,
        });
        if (!jaEnviado) {
          const resultado = await sendPaymentEmail({
            to: recipient.recipient_email,
            nome,
            tipo: "criado",
            valor: Number(fatura.valor),
            metodo: "boleto",
            vencimento: fatura.vencimento,
            boletoUrl: fatura.boleto_url,
            boletoBarcode: fatura.linha_digitavel,
            contratoRef: `Mensalidade ${fatura.numero_parcela}/${fatura.installment_total}`,
          });
          await logFinancialNotification(supabase, {
            invoiceId: fatura.id,
            recipientType,
            recipientId,
            channel: "email",
            notificationType: ciclo.tipo,
            result: resultado,
          });
          if (resultado.sent) resumo[ciclo.tipo].emailEnviados += 1;
        }
      }

      if (recipient.recipient_phone) {
        const jaEnviado = await wasNotificationSent(supabase, {
          invoiceId: fatura.id,
          channel: "sms",
          notificationType: ciclo.tipo,
        });
        if (!jaEnviado) {
          const mensagem = `NOX Fiança: sua mensalidade ${fatura.numero_parcela}/${fatura.installment_total} vence ${ciclo.dias === 0 ? "hoje" : `em ${ciclo.rotulo}`}. Valor: ${valorFmt}.${ciclo.dias === 0 ? "" : ` Vencimento: ${vencFmt}.`}`;
          const resultado = await sendPaymentSms({ to: recipient.recipient_phone, mensagem });
          await logFinancialNotification(supabase, {
            invoiceId: fatura.id,
            recipientType,
            recipientId,
            channel: "sms",
            notificationType: ciclo.tipo,
            result: resultado,
          });
          if (resultado.sent) resumo[ciclo.tipo].smsEnviados += 1;
        }

        const jaEnviadoWpp = await wasNotificationSent(supabase, {
          invoiceId: fatura.id,
          channel: "whatsapp",
          notificationType: ciclo.tipo,
        });
        if (!jaEnviadoWpp) {
          const mensagem = `Olá, ${nome}.\n\nA mensalidade ${fatura.numero_parcela}/${fatura.installment_total} da NOX Fiança vence ${ciclo.dias === 0 ? "hoje" : `em ${ciclo.rotulo}`}.\n\nValor: ${valorFmt}${ciclo.dias === 0 ? "" : `\nVencimento: ${vencFmt}`}`;
          const resultado = await sendPaymentWhatsapp({ to: recipient.recipient_phone, mensagem });
          await logFinancialNotification(supabase, {
            invoiceId: fatura.id,
            recipientType,
            recipientId,
            channel: "whatsapp",
            notificationType: ciclo.tipo,
            result: resultado,
          });
          if (resultado.sent) resumo[ciclo.tipo].whatsappEnviados += 1;
        }
      }
    }
  }

  return jsonResponse(req, { ok: true, data: hojeSaoPaulo, resumo });
});

function dataAtualSaoPaulo() {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
  return formatter.format(new Date()); // en-CA => yyyy-mm-dd
}

function adicionarDias(isoDate: string, dias: number) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const data = new Date(Date.UTC(y, m - 1, d));
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}
