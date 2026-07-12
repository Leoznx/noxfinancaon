// deno-lint-ignore no-import-prefix
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

export const WITHDRAWAL_RECEIPTS_BUCKET = "withdrawal-receipts";
export const RECEIPT_SIGNED_URL_TTL_SECONDS = 5 * 60;
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
export const MAX_MULTIPART_BODY_BYTES = MAX_RECEIPT_BYTES + 512 * 1024;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RECEIPT_MIME_BY_EXTENSION = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

export type ReceiptExtension = keyof typeof RECEIPT_MIME_BY_EXTENSION;
export type ReceiptAccessType = "view" | "download";

export type RpcObject = Record<string, unknown>;

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly publicMessage: string,
    public readonly code: string,
  ) {
    super(publicMessage);
  }
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function normalizeOrigin(value: string) {
  return value.trim().replace(/\/$/, "");
}

function allowedOrigins() {
  const configured =
    Deno.env.get("ALLOWED_ORIGINS") || Deno.env.get("FRONTEND_URL") || "https://noxfianca.com";
  const origins = configured.split(",").map(normalizeOrigin).filter(Boolean);
  return origins.length > 0 ? origins : ["https://noxfianca.com"];
}

export function isAllowedOrigin(req: Request) {
  const origin = req.headers.get("origin");
  return !origin || allowedOrigins().includes(normalizeOrigin(origin));
}

export function corsHeaders(req: Request) {
  const origin = req.headers.get("origin");
  const normalizedOrigin = origin ? normalizeOrigin(origin) : "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, apikey, x-client-info, x-supabase-api-version, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };

  if (normalizedOrigin && allowedOrigins().includes(normalizedOrigin)) {
    headers["Access-Control-Allow-Origin"] = normalizedOrigin;
  }

  return headers;
}

export function handlePreflight(req: Request) {
  if (req.method !== "OPTIONS") return null;
  if (!isAllowedOrigin(req)) {
    return new Response(null, { status: 403, headers: { Vary: "Origin" } });
  }
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export function assertAllowedOrigin(req: Request) {
  if (!isAllowedOrigin(req)) {
    throw new HttpError(403, "Origem nao permitida.", "origin_not_allowed");
  }
}

export function jsonResponse(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function errorResponse(req: Request, error: unknown) {
  if (error instanceof HttpError) {
    return jsonResponse(
      req,
      { ok: false, error: error.publicMessage, code: error.code },
      error.status,
    );
  }

  return jsonResponse(
    req,
    {
      ok: false,
      error: "Nao foi possivel concluir a operacao. Tente novamente.",
      code: "internal_error",
    },
    500,
  );
}

export function safeErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return "unknown";
  const code = String((error as { code?: unknown }).code || "");
  return /^[a-z0-9_-]{1,64}$/i.test(code) ? code : "unknown";
}

export function logSafeFailure(operation: string, error: unknown, withdrawalId?: string) {
  console.error("[withdrawals] operation failed", {
    operation,
    errorCode: safeErrorCode(error),
    ...(withdrawalId && isUuid(withdrawalId) ? { withdrawalId } : {}),
  });
}

export function adminClient() {
  return createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function requireAuthenticatedClients(req: Request) {
  const authorization = req.headers.get("authorization")?.trim() || "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  if (!match) {
    throw new HttpError(401, "Sessao invalida.", "invalid_session");
  }

  const token = match[1];
  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    throw new HttpError(401, "Sessao invalida.", "invalid_session");
  }

  const userClient = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return { admin, userClient, user: data.user };
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function rpcObject(value: unknown): RpcObject | null {
  const candidate = Array.isArray(value) && value.length === 1 ? value[0] : value;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  return candidate as RpcObject;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return (
    bytes.length >= signature.length &&
    signature.every((expected, index) => bytes[index] === expected)
  );
}

function hasReceiptMagic(bytes: Uint8Array, extension: ReceiptExtension) {
  if (extension === "pdf") {
    return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
  }
  if (extension === "jpg" || extension === "jpeg") {
    return startsWith(bytes, [0xff, 0xd8, 0xff]);
  }
  if (extension === "png") {
    return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  return (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

function extensionFromFileName(fileName: string): ReceiptExtension {
  const hasControlCharacter = Array.from(fileName).some((character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (!fileName || fileName.length > 255 || hasControlCharacter) {
    throw new HttpError(400, "O nome do arquivo e invalido.", "invalid_file_name");
  }

  const leafName = fileName.replace(/\\/g, "/").split("/").pop() || "";
  const match = /\.([a-z0-9]+)$/i.exec(leafName);
  const extension = match?.[1]?.toLowerCase() || "";
  if (!(extension in RECEIPT_MIME_BY_EXTENSION)) {
    throw new HttpError(
      415,
      "O arquivo enviado nao e permitido. Use PDF, JPG, JPEG, PNG ou WEBP.",
      "unsupported_file_extension",
    );
  }
  return extension as ReceiptExtension;
}

function sanitizeOriginalFileName(fileName: string, extension: ReceiptExtension) {
  const leafName = fileName.replace(/\\/g, "/").split("/").pop() || "";
  const stemWithoutExtension = leafName.slice(0, -(extension.length + 1));
  const safeStem = stemWithoutExtension
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 100);
  return `${safeStem || "comprovante"}.${extension}`;
}

function normalizeMimeType(value: string) {
  return value.split(";", 1)[0].trim().toLowerCase();
}

async function sha256Hex(bytes: Uint8Array) {
  // validateReceiptFile sempre cria esta view a partir de File.arrayBuffer(),
  // portanto o backing buffer e um ArrayBuffer (nunca SharedArrayBuffer).
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function validateReceiptFile(file: File) {
  if (file.size < 1) {
    throw new HttpError(400, "O comprovante esta vazio.", "empty_receipt");
  }
  if (file.size > MAX_RECEIPT_BYTES) {
    throw new HttpError(413, "O comprovante deve ter no maximo 10 MB.", "receipt_too_large");
  }

  const extension = extensionFromFileName(file.name);
  const mimeType = normalizeMimeType(file.type);
  if (mimeType !== RECEIPT_MIME_BY_EXTENSION[extension]) {
    throw new HttpError(
      415,
      "O tipo do arquivo nao corresponde a extensao informada.",
      "receipt_mime_mismatch",
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size || !hasReceiptMagic(bytes, extension)) {
    throw new HttpError(
      415,
      "O conteudo do arquivo nao corresponde a um comprovante permitido.",
      "invalid_receipt_signature",
    );
  }

  return {
    bytes,
    extension,
    mimeType,
    originalFileName: sanitizeOriginalFileName(file.name, extension),
    sizeBytes: bytes.byteLength,
    sha256: await sha256Hex(bytes),
  };
}

export function buildReceiptPath(
  withdrawalOwnerId: string,
  withdrawalId: string,
  extension: ReceiptExtension,
) {
  if (!isUuid(withdrawalOwnerId) || !isUuid(withdrawalId)) {
    throw new Error("Invalid receipt path identifiers");
  }
  return `${withdrawalOwnerId.toLowerCase()}/${withdrawalId.toLowerCase()}/${crypto.randomUUID()}.${extension}`;
}

export function isValidStoredReceiptPath(path: unknown, withdrawalId: string): path is string {
  if (typeof path !== "string" || path.length > 255 || !isUuid(withdrawalId)) return false;
  const parts = path.split("/");
  if (parts.length !== 3) return false;
  const [ownerId, storedWithdrawalId, fileName] = parts;
  if (!isUuid(ownerId) || storedWithdrawalId.toLowerCase() !== withdrawalId.toLowerCase()) {
    return false;
  }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpe?g|png|webp)$/i.test(
    fileName,
  );
}
