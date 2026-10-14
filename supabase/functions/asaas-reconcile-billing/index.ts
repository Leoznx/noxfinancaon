import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  asaasFetch,
  corsHeaders,
  HttpError,
  jsonResponse,
  requireUser,
  supabaseAdmin,
} from "../_shared/asaas.ts";
import {
  hasOversizedBody,
  rejectDisallowedOrigin,
  safeEqualSecret,
} from "../_shared/http-security.ts";

type RunBody = {
  consultationId?: string;
  limit?: number;
};

type ProviderResource = {
  kind: "payment" | "subscription";
  id: string;
};

const OPEN_PAYMENT_STATUSES = [
  "pending",
  "created",
  "waiting_payment",
  "processing",
  "risk_analysis",
  "approved",
  "confirmed",
  "overdue",
];

function validUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || ""),
  );
}

async function canManageBilling(userId: string) {
  const { data, error } = await supabaseAdmin().rpc("can_manage_withdrawals", {
    _uid: userId,
    _action: "view",
  });
  if (error) throw error;
  return data === true;
}

async function postSnapshotToWebhook(resource: ProviderResource, snapshot: any) {
  const providerStatus = String(snapshot?.status || "UNKNOWN").toUpperCase();
  const dayBucket = new Date().toISOString().slice(0, 10);
  const payload =
    resource.kind === "subscription"
      ? {
          id: `reconcile:subscription:${resource.id}:${providerStatus}:${dayBucket}`,
          event: "SUBSCRIPTION_UPDATED",
          dateCreated: new Date().toISOString(),
          subscription: snapshot,
        }
      : {
          id: `reconcile:payment:${resource.id}:${providerStatus}:${dayBucket}`,
          event: "PAYMENT_UPDATED",
          dateCreated: new Date().toISOString(),
          payment: snapshot,
        };

  const response = await fetch(
    `${Deno.env.get("SUPABASE_URL")}/functions/v1/asaas-webhook`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "asaas-access-token": Deno.env.get("ASAAS_WEBHOOK_TOKEN") || "",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(result?.error || `webhook_${response.status}`));
  }
  return result;
}

async function runPool<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        await task(item);
      }
    }),
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST")
    return jsonResponse(req, { ok: false, error: "Metodo nao permitido." }, 405);
  const originError = rejectDisallowedOrigin(req);
  if (originError) return originError;
  if (hasOversizedBody(req, 16_384))
    return jsonResponse(req, { ok: false, error: "Payload muito grande." }, 413);

  try {
    const cronSecret = Deno.env.get("CRON_NOTIFICATIONS_SECRET") || "";
    const isCron =
      !!cronSecret && safeEqualSecret(req.headers.get("x-cron-secret") || "", cronSecret);
    let requestedBy: string | null = null;
    if (!isCron) {
      const { user } = await requireUser(req);
      if (!(await canManageBilling(user.id))) {
        return jsonResponse(req, { ok: false, error: "Acesso nao autorizado." }, 403);
      }
      requestedBy = user.id;
    }

    const body = (await req.json().catch(() => ({}))) as RunBody;
    const consultationId = body.consultationId?.trim() || null;
    if (consultationId && !validUuid(consultationId)) {
      return jsonResponse(req, { ok: false, error: "Contrato invalido." }, 400);
    }
    const limit = Math.max(1, Math.min(Number(body.limit) || 60, 100));
    const admin = supabaseAdmin();

    let paymentQuery = admin
      .from("asaas_payments")
      .select("asaas_payment_id,consultation_id")
      .not("asaas_payment_id", "is", null)
      .in("status", OPEN_PAYMENT_STATUSES)
      .order("updated_at", { ascending: true })
      .limit(limit);
    let subscriptionQuery = admin
      .from("asaas_subscriptions")
      .select("asaas_subscription_id,consultation_id")
      .not("asaas_subscription_id", "is", null)
      .in("status", ["pending", "active", "suspended", "error"])
      .order("updated_at", { ascending: true })
      .limit(limit);
    const batchQuery = admin
      .from("consolidated_invoice_batches")
      .select("asaas_payment_id")
      .not("asaas_payment_id", "is", null)
      .in("status", ["active", "partial"])
      .order("updated_at", { ascending: true })
      .limit(limit);
    if (consultationId) {
      paymentQuery = paymentQuery.eq("consultation_id", consultationId);
      subscriptionQuery = subscriptionQuery.eq("consultation_id", consultationId);
    }

    const [payments, subscriptions, batches] = await Promise.all([
      paymentQuery,
      subscriptionQuery,
      // Lotes agrupam varios contratos; a conciliacao individual nao deve
      // atualizar um lote inteiro sem uma ligacao direta verificavel.
      consultationId ? Promise.resolve({ data: [], error: null }) : batchQuery,
    ]);
    if (payments.error) throw payments.error;
    if (subscriptions.error) throw subscriptions.error;
    if (batches.error) throw batches.error;

    const providerPayments = new Set<string>();
    for (const row of [...(payments.data || []), ...(batches.data || [])]) {
      if (row.asaas_payment_id) providerPayments.add(row.asaas_payment_id);
    }
    const providerSubscriptions = Array.from(
      new Set(
        (subscriptions.data || [])
          .map((row) => row.asaas_subscription_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    const report = {
      ok: true,
      requestedBy,
      consultationId,
      checkedPayments: 0,
      checkedSubscriptions: 0,
      synchronized: 0,
      duplicated: 0,
      failures: [] as Array<{ type: string; id: string; error: string }>,
    };

    // Descobre tambem mensalidades geradas pelo Asaas para assinaturas. O
    // webhook compartilhado materializa cada cobranca de forma idempotente.
    await runPool(providerSubscriptions, 4, async (subscriptionId) => {
      try {
        const subscription = await asaasFetch(`/subscriptions/${subscriptionId}`);
        const subscriptionResult = await postSnapshotToWebhook(
          { kind: "subscription", id: subscriptionId },
          subscription,
        );
        report.checkedSubscriptions += 1;
        if (subscriptionResult?.duplicated) report.duplicated += 1;
        else report.synchronized += 1;

        const generated = await asaasFetch(
          `/payments?subscription=${encodeURIComponent(subscriptionId)}&limit=100`,
        );
        for (const payment of generated?.data || []) {
          if (payment?.id) providerPayments.add(payment.id);
        }
      } catch (error) {
        report.failures.push({
          type: "subscription",
          id: subscriptionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    await runPool(Array.from(providerPayments), 5, async (paymentId) => {
      try {
        const payment = await asaasFetch(`/payments/${paymentId}`);
        const paymentResult = await postSnapshotToWebhook(
          { kind: "payment", id: paymentId },
          payment,
        );
        report.checkedPayments += 1;
        if (paymentResult?.duplicated) report.duplicated += 1;
        else report.synchronized += 1;
      } catch (error) {
        report.failures.push({
          type: "payment",
          id: paymentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    return jsonResponse(req, report, report.failures.length ? 207 : 200);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    console.error("[asaas-reconcile-billing] erro", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(
      req,
      { ok: false, error: status === 401 ? "Sessao invalida." : "Falha na conciliacao Asaas." },
      status,
    );
  }
});
