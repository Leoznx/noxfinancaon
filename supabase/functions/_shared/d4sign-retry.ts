export const D4SIGN_PROVIDER_LIMIT_ERROR_CODE = "d4sign_provider_limit";

const PROVIDER_LIMIT_MARKERS = [
  "this account has no more limits to send documents",
  "no more limits to send documents",
  "limite de envios de documentos",
  "limite de envio de documentos",
];

const RETRY_DELAYS_MINUTES = [15, 30, 60, 120, 240, 360] as const;

export function isD4SignProviderLimitError(error: unknown) {
  const message = (error instanceof Error ? error.message : String(error || ""))
    .trim()
    .toLowerCase();
  return PROVIDER_LIMIT_MARKERS.some((marker) => message.includes(marker));
}

export function d4SignRetryDelayMinutes(retryCount: number) {
  const normalizedCount = Number.isFinite(retryCount) ? Math.max(1, Math.trunc(retryCount)) : 1;
  return RETRY_DELAYS_MINUTES[Math.min(normalizedCount - 1, RETRY_DELAYS_MINUTES.length - 1)];
}

export function nextD4SignRetryAt(retryCount: number, now = new Date()) {
  return new Date(now.getTime() + d4SignRetryDelayMinutes(retryCount) * 60_000).toISOString();
}
