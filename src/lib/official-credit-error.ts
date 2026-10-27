const DEFAULT_OFFICIAL_CREDIT_ERROR =
  "Não foi possível concluir a consulta oficial agora. Tente novamente em instantes.";

type JsonResponseLike = {
  clone?: () => JsonResponseLike;
  json?: () => Promise<unknown>;
};

function nonEmptyMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const message = value.trim();
  return message ? message : null;
}

function messageFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as { error?: unknown; message?: unknown };
  return nonEmptyMessage(record.error) ?? nonEmptyMessage(record.message);
}

function isGenericEdgeFunctionMessage(message: string): boolean {
  return /edge function|non-2xx|failed to (send|fetch)|network request failed/i.test(message);
}

/** Converts Supabase function failures into a safe, actionable message for the UI. */
export async function officialCreditErrorMessage(error: unknown): Promise<string> {
  if (error && typeof error === "object") {
    const context = (error as { context?: JsonResponseLike }).context;
    try {
      const response = context?.clone?.() ?? context;
      if (typeof response?.json === "function") {
        const backendMessage = messageFromPayload(await response.json());
        if (backendMessage) return backendMessage;
      }
    } catch {
      // Fall through to the local message without exposing transport details.
    }

    const localMessage = nonEmptyMessage((error as { message?: unknown }).message);
    if (localMessage && !isGenericEdgeFunctionMessage(localMessage)) return localMessage;
  }

  return DEFAULT_OFFICIAL_CREDIT_ERROR;
}
