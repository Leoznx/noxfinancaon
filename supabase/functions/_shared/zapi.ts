export type ZApiResult = {
  sent: boolean;
  reason?: string;
  providerMessageId?: string;
};

export type ZApiDeliveryStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

type ZApiWebhookKind = "received" | "delivery" | "message_status";

const WEBHOOK_ENDPOINTS: Record<ZApiWebhookKind, string> = {
  received: "update-webhook-received",
  delivery: "update-webhook-delivery",
  message_status: "update-webhook-message-status",
};

export function normalizeWhatsappPhone(value: string | null | undefined) {
  let digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (!digits.startsWith("55")) digits = `55${digits}`;
  return digits.length >= 12 && digits.length <= 13 ? digits : "";
}

function credentials() {
  const instanceId = Deno.env.get("ZAPI_INSTANCE_ID")?.trim() || "";
  const instanceToken = Deno.env.get("ZAPI_INSTANCE_TOKEN")?.trim() || "";
  const clientToken = Deno.env.get("ZAPI_CLIENT_TOKEN")?.trim() || "";
  const valid = /^[A-Za-z0-9_-]+$/;
  if (!valid.test(instanceId) || !valid.test(instanceToken)) return null;
  return { instanceId, instanceToken, clientToken };
}

export async function getZApiConnectionStatus() {
  const auth = credentials();
  if (!auth) {
    return { configured: false, connected: false, smartphoneConnected: false };
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (auth.clientToken) headers["Client-Token"] = auth.clientToken;
  try {
    const response = await fetch(
      `https://api.z-api.io/instances/${auth.instanceId}/token/${auth.instanceToken}/status`,
      { method: "GET", headers },
    );
    if (!response.ok) {
      return {
        configured: true,
        connected: false,
        smartphoneConnected: false,
        status: response.status,
      };
    }
    const data = await response.json();
    return {
      configured: true,
      connected: data?.connected === true,
      smartphoneConnected: data?.smartphoneConnected === true,
    };
  } catch {
    return {
      configured: true,
      connected: false,
      smartphoneConnected: false,
      reason: "provider_unavailable",
    };
  }
}

async function updateZApiWebhook(kind: ZApiWebhookKind, value: string) {
  const auth = credentials();
  if (!auth) {
    return { configured: false, updated: false, reason: "not_configured" };
  }
  if (!/^https:\/\//i.test(value)) {
    return { configured: true, updated: false, reason: "invalid_https_url" };
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (auth.clientToken) headers["Client-Token"] = auth.clientToken;
  try {
    const response = await fetch(
      `https://api.z-api.io/instances/${auth.instanceId}/token/${auth.instanceToken}/${
        WEBHOOK_ENDPOINTS[kind]
      }`,
      { method: "PUT", headers, body: JSON.stringify({ value }) },
    );
    if (!response.ok) {
      return {
        configured: true,
        updated: false,
        reason: `provider_http_${response.status}`,
      };
    }
    const data = await response.json().catch(() => ({}));
    return { configured: true, updated: data?.value === true };
  } catch {
    return { configured: true, updated: false, reason: "provider_unavailable" };
  }
}

export async function updateZApiReceivedWebhook(value: string) {
  return updateZApiWebhook("received", value);
}

export async function updateZApiContractWebhooks(value: string) {
  const entries = await Promise.all(
    (Object.keys(WEBHOOK_ENDPOINTS) as ZApiWebhookKind[]).map(
      async (kind) => [kind, await updateZApiWebhook(kind, value)] as const,
    ),
  );
  const webhooks = Object.fromEntries(entries);
  const failed = entries.find(([, result]) => !result.updated)?.[1];
  return {
    configured: Object.values(webhooks).every((result) => result.configured),
    updated: Object.values(webhooks).every((result) => result.updated),
    reason: failed?.reason,
    webhooks,
  };
}

function providerReason(body: unknown, status: number) {
  const record = body && typeof body === "object"
    ? (body as Record<string, unknown>)
    : {};
  const code = String(
    record.error || record.message || record.code || `http_${status}`,
  )
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80);
  return `provider_http_${status}${code ? `_${code}` : ""}`;
}

export function resolveZApiDeliveryStatus(payload: Record<string, unknown>): {
  status: ZApiDeliveryStatus;
  error: string | null;
} {
  const rawStatus = String(payload.status || "")
    .trim()
    .toUpperCase();
  const rawError = String(
    payload.error || payload.errorMessage || payload.error_code || "",
  ).trim();
  if (
    rawError ||
    ["ERROR", "FAILED", "FAILURE", "CANCELED", "CANCELLED"].includes(rawStatus)
  ) {
    return {
      status: "failed",
      error: (rawError || rawStatus || "provider_delivery_failed").slice(
        0,
        500,
      ),
    };
  }
  if (["READ", "READ_BY_ME", "PLAYED"].includes(rawStatus)) {
    return { status: "read", error: null };
  }
  if (["RECEIVED", "DELIVERED"].includes(rawStatus)) {
    return { status: "delivered", error: null };
  }
  if (
    rawStatus === "SENT" ||
    String(payload.type || "") === "DeliveryCallback"
  ) {
    return { status: "sent", error: null };
  }
  return { status: "queued", error: null };
}

export async function sendZApiText(params: {
  to: string;
  message: string;
}): Promise<ZApiResult> {
  const auth = credentials();
  if (!auth) return { sent: false, reason: "not_configured" };
  const phone = normalizeWhatsappPhone(params.to);
  if (!phone) return { sent: false, reason: "invalid_phone" };
  if (!params.message.trim()) return { sent: false, reason: "empty_message" };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (auth.clientToken) headers["Client-Token"] = auth.clientToken;

  try {
    const response = await fetch(
      `https://api.z-api.io/instances/${auth.instanceId}/token/${auth.instanceToken}/send-text`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ phone, message: params.message }),
      },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return { sent: false, reason: providerReason(body, response.status) };
    }
    const data = await response.json();
    const providerMessageId = data?.messageId || data?.zaapId || data?.id;
    if (!providerMessageId) {
      return { sent: false, reason: "provider_invalid_response" };
    }
    return { sent: true, providerMessageId: String(providerMessageId) };
  } catch {
    return { sent: false, reason: "provider_unavailable" };
  }
}
