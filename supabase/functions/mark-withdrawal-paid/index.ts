import {
  assertAllowedOrigin,
  buildReceiptPath,
  errorResponse,
  handlePreflight,
  HttpError,
  isUuid,
  jsonResponse,
  logSafeFailure,
  MAX_MULTIPART_BODY_BYTES,
  requireAuthenticatedClients,
  rpcObject,
  validateReceiptFile,
  WITHDRAWAL_RECEIPTS_BUCKET,
} from "../_shared/withdrawals.ts";

const MAX_PAYMENT_NOTES_LENGTH = 2_000;

function singleFormValue(form: FormData, name: string, required = true) {
  const values = form.getAll(name);
  if (values.length > 1 || (required && values.length !== 1)) {
    throw new HttpError(400, "Formulario de pagamento invalido.", "invalid_form_data");
  }
  return values[0] ?? null;
}

function requiredFormText(form: FormData, name: string) {
  const value = singleFormValue(form, name);
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "Formulario de pagamento invalido.", "invalid_form_data");
  }
  return value.trim();
}

function parseContentLength(req: Request) {
  const raw = req.headers.get("content-length");
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) {
    throw new HttpError(400, "Requisicao invalida.", "invalid_content_length");
  }
  return Number(raw);
}

function rpcFailureStatus(errorCode: string) {
  if (errorCode === "42501") return 403;
  if (errorCode === "P0001" || errorCode === "23505") return 409;
  return 500;
}

async function removeUploadedReceipt(
  admin: ReturnType<typeof import("../_shared/withdrawals.ts").adminClient>,
  path: string,
  withdrawalId: string,
) {
  try {
    const { error } = await admin.storage.from(WITHDRAWAL_RECEIPTS_BUCKET).remove([path]);
    if (error) logSafeFailure("receipt_cleanup", error, withdrawalId);
  } catch (error) {
    logSafeFailure("receipt_cleanup_request", error, withdrawalId);
  }
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  let withdrawalIdForLog: string | undefined;

  try {
    assertAllowedOrigin(req);
    if (req.method !== "POST") {
      throw new HttpError(405, "Metodo nao permitido.", "method_not_allowed");
    }

    const contentType = req.headers.get("content-type") || "";
    if (!/^multipart\/form-data(?:\s*;|$)/i.test(contentType)) {
      throw new HttpError(
        415,
        "Envie o comprovante usando um formulario multipart.",
        "multipart_required",
      );
    }

    const contentLength = parseContentLength(req);
    if (contentLength !== null && contentLength > MAX_MULTIPART_BODY_BYTES) {
      throw new HttpError(413, "O comprovante deve ter no maximo 10 MB.", "receipt_too_large");
    }

    // Valida o JWT no Auth antes de carregar o arquivo inteiro em memoria.
    const { admin, userClient } = await requireAuthenticatedClients(req);

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new HttpError(400, "Formulario de pagamento invalido.", "invalid_form_data");
    }

    const withdrawalId = requiredFormText(form, "withdrawal_id");
    if (!isUuid(withdrawalId)) {
      throw new HttpError(400, "Solicitacao de saque invalida.", "invalid_withdrawal_id");
    }
    withdrawalIdForLog = withdrawalId;

    if (requiredFormText(form, "confirmed") !== "true") {
      throw new HttpError(
        400,
        "Confirme que o pagamento foi realizado antes de continuar.",
        "payment_not_confirmed",
      );
    }

    const notesValue = singleFormValue(form, "payment_notes", false);
    if (notesValue !== null && typeof notesValue !== "string") {
      throw new HttpError(400, "A observacao do pagamento e invalida.", "invalid_payment_notes");
    }
    const paymentNotes = typeof notesValue === "string" ? notesValue.trim() : "";
    if (paymentNotes.length > MAX_PAYMENT_NOTES_LENGTH) {
      throw new HttpError(
        400,
        "A observacao do pagamento deve ter no maximo 2000 caracteres.",
        "payment_notes_too_long",
      );
    }

    const receiptValue = singleFormValue(form, "receipt");
    if (!(receiptValue instanceof File)) {
      throw new HttpError(400, "Anexe o comprovante de pagamento.", "receipt_required");
    }

    const { data: contextData, error: contextError } = await userClient.rpc(
      "get_withdrawal_upload_context",
      { p_withdrawal_id: withdrawalId },
    );
    if (contextError) {
      logSafeFailure("get_upload_context", contextError, withdrawalId);
      const status = rpcFailureStatus(String(contextError.code || ""));
      throw new HttpError(
        status,
        status === 403
          ? "Voce nao tem permissao para finalizar este saque."
          : "Nao foi possivel validar esta solicitacao de saque.",
        status === 403 ? "forbidden" : "withdrawal_validation_failed",
      );
    }

    const context = rpcObject(contextData);
    if (!context || context.allowed !== true) {
      throw new HttpError(403, "Voce nao tem permissao para finalizar este saque.", "forbidden");
    }
    if (!isUuid(context.user_id)) {
      throw new HttpError(
        500,
        "Nao foi possivel validar esta solicitacao de saque.",
        "invalid_upload_context",
      );
    }
    if (String(context.status || "").toUpperCase() !== "AWAITING_PAYMENT") {
      throw new HttpError(
        409,
        "O status atual nao permite confirmar este pagamento.",
        "invalid_withdrawal_status",
      );
    }
    const amountCents = Number(context.amount_cents);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      throw new HttpError(
        500,
        "Nao foi possivel validar esta solicitacao de saque.",
        "invalid_upload_context",
      );
    }

    const receipt = await validateReceiptFile(receiptValue);
    const receiptPath = buildReceiptPath(context.user_id, withdrawalId, receipt.extension);
    const { error: uploadError } = await admin.storage
      .from(WITHDRAWAL_RECEIPTS_BUCKET)
      .upload(receiptPath, receipt.bytes, {
        cacheControl: "0",
        contentType: receipt.mimeType,
        upsert: false,
      });

    if (uploadError) {
      logSafeFailure("receipt_upload", uploadError, withdrawalId);
      throw new HttpError(
        500,
        "O comprovante nao pode ser salvo. O saque nao foi marcado como pago.",
        "receipt_upload_failed",
      );
    }

    let markData: unknown = null;
    let markError: { code?: string } | null = null;
    try {
      const result = await userClient.rpc("mark_withdrawal_as_paid", {
        p_withdrawal_id: withdrawalId,
        p_receipt_path: receiptPath,
        p_receipt_file_name: receipt.originalFileName,
        p_receipt_mime_type: receipt.mimeType,
        p_receipt_size_bytes: receipt.sizeBytes,
        p_receipt_sha256: receipt.sha256,
        p_payment_notes: paymentNotes || null,
      });
      markData = result.data;
      markError = result.error;
    } catch (error) {
      logSafeFailure("mark_paid_request", error, withdrawalId);
      await removeUploadedReceipt(admin, receiptPath, withdrawalId);
      throw new HttpError(
        500,
        "O pagamento nao pode ser confirmado. O comprovante enviado foi descartado.",
        "mark_paid_failed",
      );
    }

    const markResult = rpcObject(markData);
    if (markError || !markResult || markResult.ok !== true) {
      if (markError) logSafeFailure("mark_paid_rpc", markError, withdrawalId);
      await removeUploadedReceipt(admin, receiptPath, withdrawalId);

      const status = markError ? rpcFailureStatus(String(markError.code || "")) : 409;
      throw new HttpError(
        status,
        status === 403
          ? "Voce nao tem permissao para finalizar este saque."
          : status === 409
            ? "Esta solicitacao ja foi atualizada ou nao permite mais o pagamento."
            : "O pagamento nao pode ser confirmado. O comprovante enviado foi descartado.",
        status === 403 ? "forbidden" : status === 409 ? "withdrawal_conflict" : "mark_paid_failed",
      );
    }

    return jsonResponse(req, {
      ok: true,
      withdrawal_id: withdrawalId,
      status: "PAID",
    });
  } catch (error) {
    if (!(error instanceof HttpError)) {
      logSafeFailure("mark_withdrawal_paid_unhandled", error, withdrawalIdForLog);
    }
    return errorResponse(req, error);
  }
});
