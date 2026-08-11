export type ZApiResult = {
  sent: boolean;
  reason?: string;
  providerMessageId?: string;
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
}

export async function updateZApiReceivedWebhook(value: string) {
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
      `https://api.z-api.io/instances/${auth.instanceId}/token/${auth.instanceToken}/update-webhook-received`,
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
      return { sent: false, reason: `provider_http_${response.status}` };
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
