import {
  assertAllowedOrigin,
  errorResponse,
  handlePreflight,
  HttpError,
  isUuid,
  isValidStoredReceiptPath,
  jsonResponse,
  logSafeFailure,
  RECEIPT_SIGNED_URL_TTL_SECONDS,
  type ReceiptAccessType,
  requireAuthenticatedClients,
  rpcObject,
  WITHDRAWAL_RECEIPTS_BUCKET,
} from "../_shared/withdrawals.ts";

const MAX_JSON_BODY_BYTES = 16 * 1024;

function parseAccessType(value: unknown): ReceiptAccessType {
  const accessType = String(value || "view")
    .trim()
    .toLowerCase();
  if (accessType !== "view" && accessType !== "download") {
    throw new HttpError(400, "Tipo de acesso invalido.", "invalid_access_type");
  }
  return accessType;
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

    const rawContentLength = req.headers.get("content-length");
    if (rawContentLength && /^\d+$/.test(rawContentLength)) {
      if (Number(rawContentLength) > MAX_JSON_BODY_BYTES) {
        throw new HttpError(413, "Requisicao muito grande.", "request_too_large");
      }
    }

    const { admin, userClient } = await requireAuthenticatedClients(req);

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      body = parsed as Record<string, unknown>;
    } catch {
      throw new HttpError(400, "Requisicao invalida.", "invalid_json");
    }

    const withdrawalId = typeof body.withdrawal_id === "string" ? body.withdrawal_id.trim() : "";
    if (!isUuid(withdrawalId)) {
      throw new HttpError(400, "Solicitacao de saque invalida.", "invalid_withdrawal_id");
    }
    withdrawalIdForLog = withdrawalId;
    const accessType = parseAccessType(body.access_type);

    const { data: authorizationData, error: authorizationError } = await userClient.rpc(
      "authorize_withdrawal_receipt",
      {
        p_withdrawal_id: withdrawalId,
        p_access_type: accessType,
      },
    );

    if (authorizationError) {
      logSafeFailure("authorize_receipt", authorizationError, withdrawalId);
      throw new HttpError(
        403,
        "Voce nao tem permissao para acessar este comprovante.",
        "receipt_access_denied",
      );
    }

    const authorization = rpcObject(authorizationData);
    const receiptPath = authorization?.path;
    if (!isValidStoredReceiptPath(receiptPath, withdrawalId)) {
      throw new HttpError(
        404,
        "Nenhum comprovante foi encontrado para este saque.",
        "receipt_not_found",
      );
    }

    const signedUrlOptions = accessType === "download" ? { download: true } : undefined;
    const { data: signedData, error: signedError } = await admin.storage
      .from(WITHDRAWAL_RECEIPTS_BUCKET)
      .createSignedUrl(receiptPath, RECEIPT_SIGNED_URL_TTL_SECONDS, signedUrlOptions);

    if (signedError || !signedData?.signedUrl) {
      if (signedError) logSafeFailure("create_receipt_signed_url", signedError, withdrawalId);
      throw new HttpError(
        500,
        "Nao foi possivel abrir o comprovante. Tente novamente.",
        "signed_url_failed",
      );
    }

    return jsonResponse(req, {
      ok: true,
      url: signedData.signedUrl,
      expires_in: RECEIPT_SIGNED_URL_TTL_SECONDS,
      access_type: accessType,
    });
  } catch (error) {
    if (!(error instanceof HttpError)) {
      logSafeFailure("withdrawal_receipt_url_unhandled", error, withdrawalIdForLog);
    }
    return errorResponse(req, error);
  }
});
