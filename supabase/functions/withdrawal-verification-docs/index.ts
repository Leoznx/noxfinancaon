import {
  assertAllowedOrigin,
  errorResponse,
  handlePreflight,
  HttpError,
  isUuid,
  jsonResponse,
  logSafeFailure,
  requireAuthenticatedClients,
  rpcObject,
} from "../_shared/withdrawals.ts";

const VERIFICATION_DOCS_BUCKET = "documentos-verificacao";
const VERIFICATION_SIGNED_URL_TTL_SECONDS = 5 * 60;
const MAX_JSON_BODY_BYTES = 16 * 1024;

// Paths sempre vêm de authorize_withdrawal_verification_docs (SECURITY DEFINER,
// não de input do cliente) — a checagem aqui é só uma defesa extra de formato,
// no molde de isValidStoredReceiptPath.
function isValidStoredDocPath(path: unknown): path is string {
  return typeof path === "string" && path.length > 0 && path.length <= 255 && !path.startsWith("/");
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

    const { data: authorizationData, error: authorizationError } = await userClient.rpc(
      "authorize_withdrawal_verification_docs",
      { p_withdrawal_id: withdrawalId },
    );

    if (authorizationError) {
      logSafeFailure("authorize_verification_docs", authorizationError, withdrawalId);
      throw new HttpError(
        403,
        "Voce nao tem permissao para acessar estes documentos.",
        "verification_docs_access_denied",
      );
    }

    const authorization = rpcObject(authorizationData);
    if (!authorization?.ok) {
      throw new HttpError(
        404,
        "Nenhum documento de identidade foi encontrado para este solicitante.",
        "verification_docs_not_found",
      );
    }

    const paths: Record<"front_path" | "back_path" | "holder_photo_path", unknown> = {
      front_path: authorization.front_path,
      back_path: authorization.back_path,
      holder_photo_path: authorization.holder_photo_path,
    };

    const signedUrls: Record<string, string | null> = {
      front_url: null,
      back_url: null,
      holder_photo_url: null,
    };
    const urlKeyByPathKey = {
      front_path: "front_url",
      back_path: "back_url",
      holder_photo_path: "holder_photo_url",
    } as const;

    for (const [pathKey, urlKey] of Object.entries(urlKeyByPathKey) as Array<
      [keyof typeof paths, string]
    >) {
      const path = paths[pathKey];
      if (!isValidStoredDocPath(path)) continue;
      const { data: signedData, error: signedError } = await admin.storage
        .from(VERIFICATION_DOCS_BUCKET)
        .createSignedUrl(path, VERIFICATION_SIGNED_URL_TTL_SECONDS);
      if (signedError || !signedData?.signedUrl) {
        if (signedError) logSafeFailure("create_verification_doc_signed_url", signedError, withdrawalId);
        continue;
      }
      signedUrls[urlKey] = signedData.signedUrl;
    }

    return jsonResponse(req, {
      ok: true,
      ...signedUrls,
      expires_in: VERIFICATION_SIGNED_URL_TTL_SECONDS,
    });
  } catch (error) {
    if (!(error instanceof HttpError)) {
      logSafeFailure("withdrawal_verification_docs_unhandled", error, withdrawalIdForLog);
    }
    return errorResponse(req, error);
  }
});
