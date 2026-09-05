import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  jsonResponse,
  logFinancialNotification,
  sendCollectionEmail,
  sendPaymentWhatsapp,
  supabaseAdmin,
  wasNotificationSent,
} from "../_shared/asaas.ts";
import {
  buildCollectionMessage,
  collectionCadence,
  monthlyDueDate,
  notificationKey,
  saoPauloClock,
} from "../_shared/billing-automation.ts";
import { getZApiConnectionStatus } from "../_shared/zapi.ts";
import { hasOversizedBody, safeEqualSecret } from "../_shared/http-security.ts";

type RunBody = {
  dryRun?: boolean;
  simulationNow?: string;
};

type Recipient = {
  type: "user" | "tenant";
  id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
};

type DispatchTarget = {
  invoiceId?: string;
  batchId?: string;
  amount: number;
  dueDate: string;
  paymentUrl: string | null;
  recipient: Recipient;
  consolidated: boolean;
  invoiceCount?: number;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonResponse(req, { ok: false, error: "Método não permitido." }, 405);
  }
  if (hasOversizedBody(req, 16_384))
    return jsonResponse(req, { ok: false, error: "Payload muito grande." }, 413);

  const expectedSecret = Deno.env.get("CRON_NOTIFICATIONS_SECRET") || "";
  if (!expectedSecret || !safeEqualSecret(req.headers.get("x-cron-secret") || "", expectedSecret)) {
    return jsonResponse(req, { ok: false, error: "Não autorizado." }, 401);
  }

  const body = (await req.json().catch(() => ({}))) as RunBody;
  const simulationAllowed = Deno.env.get("BILLING_SIMULATION_ENABLED") === "true";
  if (body.simulationNow && !simulationAllowed) {
    return jsonResponse(
      req,
      {
        ok: false,
        error: "Relógio de simulação desabilitado.",
      },
      400,
    );
  }
  const now = body.simulationNow ? new Date(body.simulationNow) : new Date();
  if (Number.isNaN(now.getTime())) {
    return jsonResponse(req, { ok: false, error: "Data inválida." }, 400);
  }

  const admin = supabaseAdmin();
  const { data: settings } = await admin
    .from("billing_automation_settings")
    .select("enabled, dispatch_enabled")
    .eq("id", true)
    .maybeSingle();
  if (settings?.enabled === false) {
    return jsonResponse(req, { ok: true, skipped: "automation_disabled" });
  }
  // Safe by default. Production delivery needs both the database flag and
  // an explicit non-dry-run invocation; simulations never consume the
  // idempotency key or contact a provider.
  const dryRun = body.dryRun === true || settings?.dispatch_enabled !== true;
  const clock = saoPauloClock(now);
  const fromDate = addDays(clock.date, -14);
  const toDate = addDays(clock.date, 1);
  const consolidation = { planned: 0, synchronized: 0, failed: 0 };

  // Na primeira janela de cada dia, mantém o lote do mês sincronizado com os
  // contratos ativos. Entradas e saídas alteram a cobrança já existente.
  if (clock.hour === 9) {
    const [targetYear, targetMonth] = clock.date.split("-").map(Number);
    const targetDueDate = monthlyDueDate(targetYear, targetMonth);
    const [{ data: agencyInvoices }, { data: activeBatches }] = await Promise.all([
      admin
        .from("faturas_inquilino")
        .select("recipient_user_id")
        .eq("payment_responsible", "agency")
        .eq("vencimento", targetDueDate)
        .in("status", ["pending", "overdue", "risk_analysis", "approved"])
        .not("recipient_user_id", "is", null),
      admin
        .from("consolidated_invoice_batches")
        .select("agency_user_id")
        .eq("reference_month", targetMonth)
        .eq("reference_year", targetYear)
        .eq("status", "active"),
    ]);
    const responsibleIds = [
      ...new Set(
        [
          ...(agencyInvoices ?? []).map((row: any) => row.recipient_user_id),
          ...(activeBatches ?? []).map((row: any) => row.agency_user_id),
        ].filter(Boolean),
      ),
    ];
    consolidation.planned = responsibleIds.length;
    if (!dryRun) {
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
      const baseUrl = Deno.env.get("SUPABASE_URL") || "";
      for (const agencyUserId of responsibleIds) {
        try {
          const response = await fetch(
            `${baseUrl}/functions/v1/asaas-create-consolidated-invoice`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${serviceKey}`,
                "Content-Type": "application/json",
                "x-cron-secret": expectedSecret,
              },
              body: JSON.stringify({
                agencyUserId,
                referenceMonth: targetMonth,
                referenceYear: targetYear,
              }),
            },
          );
          if (response.ok) consolidation.synchronized += 1;
          else consolidation.failed += 1;
        } catch {
          consolidation.failed += 1;
        }
      }
    }
  }

  const [{ data: invoices, error: invoiceError }, { data: batches, error: batchError }] =
    await Promise.all([
      admin
        .from("faturas_inquilino")
        .select(
          "id, valor, vencimento, status, boleto_url, consolidated_item_id, recipient_user_id, tenant_user_id, asaas_payment:asaas_payments(recipient_type, recipient_user_id, recipient_tenant_id, recipient_name, recipient_email, recipient_phone, boleto_url)",
        )
        .gte("vencimento", fromDate)
        .lte("vencimento", toDate)
        .in("status", ["pending", "overdue", "risk_analysis", "approved"])
        .is("consolidated_item_id", null),
      admin
        .from("consolidated_invoice_batches")
        .select(
          "id, agency_user_id, total_value, due_date, status, invoice_count, invoice_url, bank_slip_url, profile:profiles!consolidated_invoice_batches_agency_user_id_fkey(nome, email, telefone)",
        )
        .gte("due_date", fromDate)
        .lte("due_date", toDate)
        .eq("status", "active"),
    ]);

  if (invoiceError || batchError) {
    console.error("[billing-automation] falha ao carregar alvos", {
      invoices: invoiceError?.message || null,
      batches: batchError?.message || null,
    });
    return jsonResponse(
      req,
      {
        ok: false,
        error: "Falha ao carregar cobranças.",
      },
      500,
    );
  }

  const targets: DispatchTarget[] = [];
  for (const invoice of invoices ?? []) {
    const payment = Array.isArray(invoice.asaas_payment)
      ? invoice.asaas_payment[0]
      : invoice.asaas_payment;
    if (!payment) continue;
    targets.push({
      invoiceId: invoice.id,
      amount: Number(invoice.valor || 0),
      dueDate: invoice.vencimento,
      paymentUrl: invoice.boleto_url || payment.boleto_url || null,
      recipient: {
        type: payment.recipient_type === "user" ? "user" : "tenant",
        id: payment.recipient_tenant_id || payment.recipient_user_id || null,
        name: payment.recipient_name || "cliente",
        email: payment.recipient_email || null,
        phone: payment.recipient_phone || null,
      },
      consolidated: false,
    });
  }
  for (const batch of batches ?? []) {
    const profile = Array.isArray(batch.profile) ? batch.profile[0] : batch.profile;
    targets.push({
      batchId: batch.id,
      amount: Number(batch.total_value || 0),
      dueDate: batch.due_date,
      paymentUrl: batch.bank_slip_url || batch.invoice_url || null,
      recipient: {
        type: "user",
        id: batch.agency_user_id,
        name: profile?.nome || "cliente",
        email: profile?.email || null,
        phone: profile?.telefone || null,
      },
      consolidated: true,
      invoiceCount: batch.invoice_count || 0,
    });
  }

  const report = {
    dryRun,
    date: clock.date,
    localHour: clock.hour,
    candidates: targets.length,
    planned: 0,
    emailSent: 0,
    whatsappSent: 0,
    skippedDuplicate: 0,
    failures: 0,
    consolidation,
    plans: [] as Array<{ scope: string; cadence: string; slot: number; channels: string[] }>,
  };

  for (const target of targets) {
    const cadence = collectionCadence({ dueDate: target.dueDate, now });
    if (!cadence) continue;
    report.planned += 1;
    const type = notificationKey(cadence, clock.date);
    const scope = target.invoiceId ? `invoice:${target.invoiceId}` : `batch:${target.batchId}`;
    const channels = [
      target.recipient.email ? "email" : null,
      target.recipient.phone ? "whatsapp" : null,
    ].filter(Boolean) as string[];
    report.plans.push({
      scope,
      cadence: cadence.kind,
      slot: cadence.slot,
      channels,
    });
    if (dryRun) continue;

    const message = buildCollectionMessage({
      name: target.recipient.name,
      amount: target.amount,
      dueDate: target.dueDate,
      cadence,
      consolidated: target.consolidated,
      invoiceCount: target.invoiceCount,
    });
    const notificationScope = target.invoiceId
      ? { invoiceId: target.invoiceId }
      : { batchId: target.batchId! };

    if (target.recipient.email) {
      const sent = await wasNotificationSent(admin, {
        ...notificationScope,
        channel: "email",
        notificationType: type,
      });
      if (sent) report.skippedDuplicate += 1;
      else {
        const result = await sendCollectionEmail({
          to: target.recipient.email,
          name: target.recipient.name,
          subject:
            cadence.kind === "pre_due"
              ? "Sua cobrança vence amanhã — NOX Fiança"
              : "Cobrança em aberto — NOX Fiança",
          message,
          paymentUrl: target.paymentUrl,
        });
        await logFinancialNotification(admin, {
          ...notificationScope,
          recipientType: target.recipient.type,
          recipientId: target.recipient.id,
          channel: "email",
          notificationType: type,
          result,
        });
        if (result.sent) report.emailSent += 1;
        else report.failures += 1;
      }
    }

    if (target.recipient.phone) {
      const sent = await wasNotificationSent(admin, {
        ...notificationScope,
        channel: "whatsapp",
        notificationType: type,
      });
      if (sent) report.skippedDuplicate += 1;
      else {
        const result = await sendPaymentWhatsapp({
          to: target.recipient.phone,
          mensagem: message,
        });
        await logFinancialNotification(admin, {
          ...notificationScope,
          recipientType: target.recipient.type,
          recipientId: target.recipient.id,
          channel: "whatsapp",
          notificationType: type,
          result,
        });
        if (result.sent) report.whatsappSent += 1;
        else report.failures += 1;
      }
    }
  }

  const zapi = dryRun
    ? { checked: false }
    : {
        checked: true,
        ...(await getZApiConnectionStatus().catch(() => ({ connected: false }))),
      };
  return jsonResponse(req, { ok: true, report, zapi });
});

function addDays(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
