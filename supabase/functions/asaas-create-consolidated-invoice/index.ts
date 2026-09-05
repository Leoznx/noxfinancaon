import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  AsaasApiError,
  asaasFetch,
  cancelAsaasPayment,
  corsHeaders,
  jsonResponse,
  normalizeDocumento,
  normalizePhone,
  requireUser,
  supabaseAdmin,
  toMoney,
} from "../_shared/asaas.ts";
import {
  asaasLateFeePayload,
  monthlyDueDate,
  saoPauloClock,
} from "../_shared/billing-automation.ts";
import { hasOversizedBody, safeEqualSecret } from "../_shared/http-security.ts";

type Body = {
  invoiceIds?: string[];
  referenceMonth?: number;
  referenceYear?: number;
  agencyUserId?: string;
};

const OPEN_STATUSES = [
  "pending",
  "overdue",
  "risk_analysis",
  "approved",
  "created",
  "waiting_payment",
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonResponse(req, { ok: false, error: "Método não permitido." }, 405);
  }
  if (hasOversizedBody(req, 64_000))
    return jsonResponse(req, { ok: false, error: "Payload muito grande." }, 413);

  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const cronSecret = Deno.env.get("CRON_NOTIFICATIONS_SECRET") || "";
    const receivedCronSecret = req.headers.get("x-cron-secret") || "";
    const internal = !!cronSecret && safeEqualSecret(receivedCronSecret, cronSecret);
    let actorId: string | null = null;
    let agencyUserId = body.agencyUserId || null;
    if (!internal) {
      const { user } = await requireUser(req);
      actorId = user.id;
      agencyUserId = user.id;
    }
    if (!agencyUserId) {
      return jsonResponse(
        req,
        {
          ok: false,
          error: "Responsável não informado.",
        },
        400,
      );
    }

    const admin = supabaseAdmin();
    const clock = saoPauloClock();
    const [currentYear, currentMonth] = clock.date.split("-").map(Number);
    const referenceMonth = body.referenceMonth || currentMonth;
    const referenceYear = body.referenceYear || currentYear;
    if (referenceMonth < 1 || referenceMonth > 12 || referenceYear < 2020 || referenceYear > 2200) {
      return jsonResponse(
        req,
        {
          ok: false,
          error: "Mês de referência inválido.",
        },
        400,
      );
    }

    let candidateQuery = admin
      .from("faturas_inquilino")
      .select(
        "id, consulta_id, tenant_user_id, asaas_payment_id, valor, vencimento, status, consolidated_item_id",
      )
      .eq("recipient_user_id", agencyUserId)
      .eq("payment_responsible", "agency")
      .in("status", OPEN_STATUSES);
    const invoiceIds = Array.isArray(body.invoiceIds)
      ? [...new Set(body.invoiceIds.filter(Boolean))]
      : [];
    if (invoiceIds.length) candidateQuery = candidateQuery.in("id", invoiceIds);
    const { data: candidates, error: candidateError } = await candidateQuery;
    if (candidateError) throw candidateError;

    const eligible = (candidates ?? []).filter((invoice: any) => {
      const [year, month] = String(invoice.vencimento).split("-").map(Number);
      return year === referenceYear && month === referenceMonth;
    });

    const { data: existingBatch } = await admin
      .from("consolidated_invoice_batches")
      .select("*")
      .eq("agency_user_id", agencyUserId)
      .eq("reference_month", referenceMonth)
      .eq("reference_year", referenceYear)
      .in("status", ["active", "partial"])
      .maybeSingle();

    if (!eligible.length) {
      if (existingBatch?.asaas_payment_id && existingBatch.status === "active") {
        await cancelAsaasPayment(existingBatch.asaas_payment_id);
        await releaseBatch(admin, existingBatch.id);
      }
      return jsonResponse(
        req,
        {
          ok: false,
          error: "Nenhuma fatura elegível para este mês.",
        },
        400,
      );
    }
    if (existingBatch?.status === "partial") {
      return jsonResponse(
        req,
        {
          ok: false,
          error: "O lote possui pagamento parcial e requer revisão financeira.",
        },
        409,
      );
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("id, nome, email, telefone, cnpj, role")
      .eq("id", agencyUserId)
      .maybeSingle();
    if (!profile?.email || !profile?.telefone) {
      return jsonResponse(
        req,
        {
          ok: false,
          error: "Complete e-mail e telefone do responsável antes de gerar a cobrança.",
        },
        400,
      );
    }
    const cpfCnpj = await resolveProfileDocument(admin, profile);
    if (!cpfCnpj) {
      return jsonResponse(
        req,
        {
          ok: false,
          error: "Cadastre o CPF ou CNPJ do responsável antes de gerar a cobrança.",
        },
        400,
      );
    }

    const totalValue = toMoney(
      eligible.reduce((sum: number, invoice: any) => sum + Number(invoice.valor || 0), 0),
    );
    const dueDate = monthlyDueDate(referenceYear, referenceMonth);
    let customerId = existingBatch?.asaas_customer_id || null;
    if (!customerId) {
      const found = await asaasFetch(`/customers?cpfCnpj=${encodeURIComponent(cpfCnpj)}`);
      customerId = Array.isArray(found?.data) && found.data.length ? found.data[0].id : null;
    }
    if (!customerId) {
      const created = await asaasFetch("/customers", {
        method: "POST",
        body: JSON.stringify({
          name: profile.nome,
          cpfCnpj,
          email: profile.email,
          mobilePhone: normalizePhone(profile.telefone),
          phone: normalizePhone(profile.telefone),
        }),
      });
      customerId = created?.id || null;
    }
    if (!customerId) throw new Error("asaas_customer_missing");

    const externalReference =
      existingBatch?.external_reference ||
      `nox:lote:${agencyUserId}:${referenceYear}:${String(referenceMonth).padStart(2, "0")}`;
    const paymentPayload = {
      customer: customerId,
      billingType: "BOLETO",
      value: totalValue,
      dueDate,
      description: `NOX Fiança — cobrança mensal consolidada ${String(referenceMonth).padStart(
        2,
        "0",
      )}/${referenceYear} (${eligible.length} contratos)`,
      externalReference,
      ...asaasLateFeePayload(),
    };

    let raw: any;
    try {
      raw = existingBatch?.asaas_payment_id
        ? await asaasFetch(`/payments/${existingBatch.asaas_payment_id}`, {
            method: "PUT",
            body: JSON.stringify(paymentPayload),
          })
        : await asaasFetch("/payments", {
            method: "POST",
            body: JSON.stringify(paymentPayload),
          });
    } catch (error) {
      console.error("[asaas-create-consolidated-invoice] provider_error", {
        status: error instanceof AsaasApiError ? error.status : "unknown",
      });
      return jsonResponse(
        req,
        {
          ok: false,
          error: "Não foi possível gerar a cobrança consolidada agora.",
        },
        502,
      );
    }

    let batch = existingBatch;
    if (batch) {
      const { data, error } = await admin
        .from("consolidated_invoice_batches")
        .update({
          total_value: totalValue,
          due_date: dueDate,
          invoice_count: eligible.length,
          billing_method: "boleto",
          asaas_customer_id: customerId,
          asaas_payment_id: raw?.id || batch.asaas_payment_id,
          invoice_url: raw?.invoiceUrl || null,
          bank_slip_url: raw?.bankSlipUrl || raw?.invoiceUrl || null,
          identification_field: raw?.identificationField || raw?.nossoNumero || null,
          last_synced_at: new Date().toISOString(),
        })
        .eq("id", batch.id)
        .select()
        .maybeSingle();
      if (error) throw error;
      batch = data;
    } else {
      const { data, error } = await admin
        .from("consolidated_invoice_batches")
        .insert({
          agency_user_id: agencyUserId,
          created_by: actorId,
          reference_month: referenceMonth,
          reference_year: referenceYear,
          total_value: totalValue,
          due_date: dueDate,
          status: "active",
          invoice_count: eligible.length,
          billing_method: "boleto",
          asaas_customer_id: customerId,
          asaas_payment_id: raw?.id || null,
          external_reference: externalReference,
          invoice_url: raw?.invoiceUrl || null,
          bank_slip_url: raw?.bankSlipUrl || raw?.invoiceUrl || null,
          identification_field: raw?.identificationField || raw?.nossoNumero || null,
          last_synced_at: new Date().toISOString(),
        })
        .select()
        .maybeSingle();
      if (error) throw error;
      batch = data;
    }

    const { data: currentItems } = await admin
      .from("consolidated_invoice_items")
      .select("id, fatura_id, status")
      .eq("batch_id", batch.id)
      .eq("status", "active");
    const eligibleIds = new Set(eligible.map((invoice: any) => invoice.id));
    const itemByInvoice = new Map((currentItems ?? []).map((item: any) => [item.fatura_id, item]));

    for (const item of currentItems ?? []) {
      if (eligibleIds.has(item.fatura_id)) continue;
      await admin
        .from("faturas_inquilino")
        .update({
          consolidated_item_id: null,
        })
        .eq("id", item.fatura_id);
      await admin
        .from("consolidated_invoice_items")
        .update({
          status: "cancelled_after_consolidation",
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.id);
    }

    for (const invoice of eligible) {
      let item = itemByInvoice.get(invoice.id);
      if (!item) {
        const { data, error } = await admin
          .from("consolidated_invoice_items")
          .insert({
            batch_id: batch.id,
            fatura_id: invoice.id,
            tenant_user_id: invoice.tenant_user_id,
            consulta_id: invoice.consulta_id,
            original_value: invoice.valor,
            status: "active",
          })
          .select("id, fatura_id")
          .maybeSingle();
        if (error) throw error;
        item = data;
      }
      await admin
        .from("faturas_inquilino")
        .update({
          consolidated_item_id: item.id,
          boleto_url: null,
          linha_digitavel: null,
        })
        .eq("id", invoice.id);
    }

    // Uma cobrança individual aberta nunca pode coexistir com o lote. Se o
    // cancelamento de qualquer item falhar, o lote novo é cancelado e os
    // vínculos são liberados para evitar cobrança duplicada.
    for (const invoice of eligible) {
      if (!invoice.asaas_payment_id) continue;
      const { data: payment } = await admin
        .from("asaas_payments")
        .select("id, asaas_payment_id, status")
        .eq("id", invoice.asaas_payment_id)
        .maybeSingle();
      if (!payment?.asaas_payment_id || !OPEN_STATUSES.includes(String(payment.status))) continue;
      const cancelled = await cancelAsaasPayment(payment.asaas_payment_id);
      if (!cancelled.cancelled) {
        await cancelAsaasPayment(batch.asaas_payment_id);
        await releaseBatch(admin, batch.id);
        return jsonResponse(
          req,
          {
            ok: false,
            error: "A consolidação foi interrompida para evitar uma cobrança duplicada.",
          },
          502,
        );
      }
      await admin.from("asaas_payments").update({ status: "cancelled" }).eq("id", payment.id);
    }

    return jsonResponse(req, {
      success: true,
      batchId: batch.id,
      totalValue,
      dueDate,
      invoiceCount: eligible.length,
      status: batch.status,
      invoiceUrl: raw?.invoiceUrl || null,
      bankSlipUrl: raw?.bankSlipUrl || raw?.invoiceUrl || null,
      identificationField: raw?.identificationField || raw?.nossoNumero || null,
    });
  } catch (error) {
    console.error("[asaas-create-consolidated-invoice] unexpected_error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(
      req,
      {
        ok: false,
        error: "Não foi possível sincronizar a cobrança consolidada.",
      },
      500,
    );
  }
});

async function resolveProfileDocument(admin: any, profile: any) {
  if (normalizeDocumento(profile.cnpj)) return normalizeDocumento(profile.cnpj);
  const role = String(profile.role || "");
  if (role === "corretor") {
    const { data } = await admin
      .from("corretores")
      .select("cpf")
      .eq("profile_id", profile.id)
      .maybeSingle();
    return normalizeDocumento(data?.cpf);
  }
  if (role === "proprietario") {
    const { data } = await admin
      .from("proprietarios")
      .select("cpf_cnpj")
      .eq("profile_id", profile.id)
      .maybeSingle();
    return normalizeDocumento(data?.cpf_cnpj);
  }
  if (role === "inquilino") {
    const { data } = await admin
      .from("inquilinos")
      .select("cpf, cnpj")
      .eq("profile_id", profile.id)
      .maybeSingle();
    return normalizeDocumento(data?.cpf || data?.cnpj);
  }
  return "";
}

async function releaseBatch(admin: any, batchId: string) {
  const { data: items } = await admin
    .from("consolidated_invoice_items")
    .select("id, fatura_id")
    .eq("batch_id", batchId)
    .eq("status", "active");
  for (const item of items ?? []) {
    await admin
      .from("faturas_inquilino")
      .update({ consolidated_item_id: null })
      .eq("id", item.fatura_id);
    await admin
      .from("consolidated_invoice_items")
      .update({
        status: "cancelled_after_consolidation",
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);
  }
  await admin
    .from("consolidated_invoice_batches")
    .update({
      status: "cancelled",
      invoice_url: null,
      bank_slip_url: null,
      identification_field: null,
      pix_qr_code: null,
      pix_copy_paste: null,
      pix_expires_at: null,
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", batchId);
}
