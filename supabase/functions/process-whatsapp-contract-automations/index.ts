import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { buildCreditAnalysisPdf } from "../_shared/credit-analysis-pdf.ts";
import {
  buildAdminCreditReviewContent,
  buildRequesterDecisionMessage,
  safePdfFileName,
  type AdminCreditReviewDecision,
} from "../_shared/whatsapp-contract-automations.ts";
import {
  getZApiConnectionStatus,
  normalizeWhatsappPhone,
  sendZApiButtonActions,
  sendZApiDocument,
  sendZApiText,
  type ZApiResult,
} from "../_shared/zapi.ts";

type JobRow = {
  id: string;
  consultation_id: string;
  job_type: "admin_review" | "requester_decision";
  decision: AdminCreditReviewDecision | null;
  attempts: number;
  provider_message_id: string | null;
  score_document_provider_message_id: string | null;
  commitment_document_provider_message_id: string | null;
  action_provider_message_id: string | null;
};

type ConsultationRow = {
  id: string;
  profile_id_solicitante: string;
  tenant_name: string | null;
  rent_value: number | null;
  status: string | null;
  substatus: string | null;
};

function jsonResponse(request: Request, body: Record<string, unknown>, status = 200) {
  const origin = request.headers.get("origin");
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      Vary: "Origin",
      ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    },
  });
}

function safeEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a[index] ^ b[index];
  return result === 0;
}

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function requesterPhone(supabase: any, profileId: string) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("telefone, email")
    .eq("id", profileId)
    .maybeSingle();
  let phone = normalizeWhatsappPhone(profile?.telefone);
  if (phone) return phone;

  const { data: owner } = await supabase
    .from("proprietarios")
    .select("telefone")
    .eq("profile_id", profileId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  phone = normalizeWhatsappPhone(owner?.telefone);
  if (phone) return phone;

  const email = String(profile?.email || "")
    .trim()
    .toLowerCase();
  if (!email) return "";
  const { data: agency } = await supabase
    .from("imobiliarias")
    .select("contato_telefone")
    .ilike("contato_email", email)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return normalizeWhatsappPhone(agency?.contato_telefone);
}

function pdfDataUri(bytes: Uint8Array) {
  return `data:application/pdf;base64,${encodeBase64(bytes)}`;
}

async function persistPartialMessage(
  supabase: any,
  jobId: string,
  column:
    | "score_document_provider_message_id"
    | "commitment_document_provider_message_id"
    | "action_provider_message_id",
  providerMessageId: string,
) {
  const { error } = await supabase
    .from("whatsapp_contract_automation_jobs")
    .update({ [column]: providerMessageId, updated_at: new Date().toISOString() })
    .eq("id", jobId);
  if (error) throw new Error(`partial_message_audit_failed:${error.message}`);
}

async function sendAdminReview(
  supabase: any,
  job: JobRow,
  consultation: ConsultationRow,
  adminPhone: string,
): Promise<ZApiResult> {
  if (
    consultation.status !== "em_analise" ||
    consultation.substatus !== "documentacao_complementar_enviada"
  ) {
    return { sent: false, reason: "review_no_longer_pending" };
  }

  const { data: analysis, error: analysisError } = await supabase
    .from("directd_credit_requests")
    .select("score, score_band, commitment_payment_percentage, commitment_payment_description")
    .eq("consultation_id", consultation.id)
    .maybeSingle();
  if (analysisError || !analysis) {
    return {
      sent: false,
      reason: `internal_analysis_unavailable:${analysisError?.message || "not_found"}`,
    };
  }

  if (!job.score_document_provider_message_id) {
    const scorePdf = await buildCreditAnalysisPdf({
      kind: "score",
      tenantName: consultation.tenant_name || "Inquilino não informado",
      rentValue: consultation.rent_value,
      score: analysis?.score,
      scoreBand: analysis?.score_band,
    });
    const scoreResult = await sendZApiDocument({
      to: adminPhone,
      document: pdfDataUri(scorePdf),
      fileName: safePdfFileName(
        `Score-${consultation.tenant_name || consultation.id}`,
        `Score-${consultation.id}.pdf`,
      ),
      caption: "Relatório interno de score para avaliação.",
    });
    if (!scoreResult.sent || !scoreResult.providerMessageId) return scoreResult;
    await persistPartialMessage(
      supabase,
      job.id,
      "score_document_provider_message_id",
      scoreResult.providerMessageId,
    );
  }

  if (!job.commitment_document_provider_message_id) {
    const commitmentPdf = await buildCreditAnalysisPdf({
      kind: "commitment",
      tenantName: consultation.tenant_name || "Inquilino não informado",
      rentValue: consultation.rent_value,
      commitmentPercentage: analysis?.commitment_payment_percentage,
      commitmentDescription: analysis?.commitment_payment_description,
    });
    const commitmentResult = await sendZApiDocument({
      to: adminPhone,
      document: pdfDataUri(commitmentPdf),
      fileName: safePdfFileName(
        `Compromisso-de-pagamento-${consultation.tenant_name || consultation.id}`,
        `Compromisso-${consultation.id}.pdf`,
      ),
      caption: "Relatório interno de compromisso de pagamento.",
    });
    if (!commitmentResult.sent || !commitmentResult.providerMessageId) {
      return commitmentResult;
    }
    await persistPartialMessage(
      supabase,
      job.id,
      "commitment_document_provider_message_id",
      commitmentResult.providerMessageId,
    );
  }

  if (job.action_provider_message_id) {
    return { sent: true, providerMessageId: job.action_provider_message_id };
  }
  const content = buildAdminCreditReviewContent({
    consultationId: consultation.id,
    tenantName: consultation.tenant_name,
    rentValue: consultation.rent_value,
  });
  const actionResult = await sendZApiButtonActions({ to: adminPhone, ...content });
  if (actionResult.sent && actionResult.providerMessageId) {
    await persistPartialMessage(
      supabase,
      job.id,
      "action_provider_message_id",
      actionResult.providerMessageId,
    );
  }
  return actionResult;
}

async function markFailure(supabase: any, job: JobRow, result: ZApiResult) {
  const deliveryUncertain = result.deliveryUncertain === true;
  const terminal = Number(job.attempts || 0) >= 3;
  await supabase
    .from("whatsapp_contract_automation_jobs")
    .update({
      status: deliveryUncertain || terminal ? "skipped" : "failed",
      last_error: deliveryUncertain
        ? `delivery_uncertain_not_retried:${result.reason || "unknown"}`
        : result.reason || "send_failed",
      next_attempt_at:
        deliveryUncertain || terminal
          ? new Date().toISOString()
          : new Date(Date.now() + Math.max(1, job.attempts) * 15 * 60_000).toISOString(),
      locked_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(request, { ok: false, error: "method_not_allowed" }, 405);
  }
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > 8_192) {
    return jsonResponse(request, { ok: false, error: "payload_too_large" }, 413);
  }
  const expectedSecret = Deno.env.get("CRON_NOTIFICATIONS_SECRET")?.trim() || "";
  if (!expectedSecret || !safeEqual(request.headers.get("x-cron-secret") || "", expectedSecret)) {
    return jsonResponse(request, { ok: false, error: "unauthorized" }, 401);
  }

  const supabase = adminClient();
  const { data: settings, error: settingsError } = await supabase
    .from("whatsapp_contract_automation_settings")
    .select("enabled, dispatch_enabled, admin_phone, batch_size")
    .eq("id", true)
    .maybeSingle();
  if (settingsError || !settings) {
    return jsonResponse(request, { ok: false, error: "settings_unavailable" }, 503);
  }
  if (settings.enabled !== true) {
    return jsonResponse(request, { ok: true, skipped: "automation_disabled" });
  }
  if (settings.dispatch_enabled !== true) {
    return jsonResponse(request, { ok: true, dryRun: true });
  }
  const adminPhone = normalizeWhatsappPhone(settings.admin_phone);
  if (!adminPhone) {
    return jsonResponse(request, { ok: false, error: "invalid_admin_phone" }, 503);
  }
  const zapi = await getZApiConnectionStatus();
  if (!zapi.configured || !zapi.connected || !zapi.smartphoneConnected) {
    return jsonResponse(request, { ok: false, error: "zapi_not_connected", zapi }, 503);
  }

  const batchSize = Math.min(Math.max(Number(settings.batch_size || 20), 1), 50);
  const now = new Date().toISOString();
  const { data: jobs, error: claimError } = await supabase.rpc(
    "claim_whatsapp_contract_automation_jobs",
    { p_limit: batchSize, p_now: now },
  );
  if (claimError) {
    console.error("[whatsapp-contract-automations] claim failed", claimError.message);
    return jsonResponse(request, { ok: false, error: "claim_failed" }, 500);
  }

  const report = { claimed: (jobs || []).length, sent: 0, failed: 0, skipped: 0 };
  for (const job of (jobs || []) as JobRow[]) {
    const { data: consultation, error: consultationError } = await supabase
      .from("consultas_credito")
      .select("id, profile_id_solicitante, tenant_name, rent_value, status, substatus")
      .eq("id", job.consultation_id)
      .maybeSingle();
    if (consultationError || !consultation) {
      report.skipped += 1;
      await markFailure(
        supabase,
        { ...job, attempts: 3 },
        {
          sent: false,
          reason: "consultation_not_found",
        },
      );
      continue;
    }

    let phone = adminPhone;
    let result: ZApiResult;
    try {
      if (job.job_type === "admin_review") {
        result = await sendAdminReview(supabase, job, consultation, adminPhone);
      } else {
        phone = await requesterPhone(supabase, consultation.profile_id_solicitante);
        if (!phone) {
          result = { sent: false, reason: "requester_phone_unavailable" };
        } else if (!job.decision) {
          result = { sent: false, reason: "decision_unavailable" };
        } else {
          result = await sendZApiText({
            to: phone,
            message: buildRequesterDecisionMessage({
              tenantName: consultation.tenant_name,
              rentValue: consultation.rent_value,
              decision: job.decision,
            }),
          });
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 300) : "unexpected_error";
      result = {
        sent: false,
        reason,
        deliveryUncertain: reason.startsWith("partial_message_audit_failed:"),
      };
    }

    if (!result.sent || !result.providerMessageId) {
      if (
        [
          "review_no_longer_pending",
          "requester_phone_unavailable",
          "decision_unavailable",
        ].includes(result.reason || "")
      ) {
        report.skipped += 1;
        await markFailure(supabase, { ...job, attempts: 3 }, result);
      } else {
        report.failed += 1;
        await markFailure(supabase, job, result);
      }
      continue;
    }

    report.sent += 1;
    await supabase
      .from("whatsapp_contract_automation_jobs")
      .update({
        status: "sent",
        recipient_phone: phone,
        provider_message_id: result.providerMessageId,
        provider_status: "queued",
        last_error: null,
        locked_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
  }

  return jsonResponse(request, { ok: true, report });
});
