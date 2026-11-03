export function resendProviderMessageId(payload: unknown) {
  if (!payload || typeof payload !== "object") return undefined;
  const id = (payload as { id?: unknown }).id;
  if (typeof id !== "string") return undefined;
  const normalized = id.trim();
  return normalized || undefined;
}
