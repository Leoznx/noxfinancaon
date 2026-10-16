const OPERATION_WINDOW_MS = 15 * 60 * 1000;
const OPERATION_RETENTION_MS = 30 * 60 * 1000;
const STORAGE_PREFIX = "nox:credit-simulation-operation:v1:";

export interface CreditSimulationOperationInput {
  tenantType: string;
  tenantName: string;
  tenantDocument: string;
  propertyType: string;
  propertyZip: string;
  propertyCity: string;
  propertyState: string;
  propertyAddress: string;
  rentValue: number;
  condominiumValue: number;
  feeValue: number;
}

function canonicalPayload(input: CreditSimulationOperationInput): string {
  const money = (value: number) => (Number.isFinite(value) ? Number(value).toFixed(2) : "0.00");
  return JSON.stringify([
    input.tenantType.trim().toUpperCase(),
    input.tenantName.trim().toLocaleLowerCase("pt-BR"),
    input.tenantDocument.replace(/\D/g, ""),
    input.propertyType.trim().toLocaleLowerCase("pt-BR"),
    input.propertyZip.replace(/\D/g, ""),
    input.propertyCity.trim().toLocaleLowerCase("pt-BR"),
    input.propertyState.trim().toUpperCase(),
    input.propertyAddress.trim().toLocaleLowerCase("pt-BR"),
    money(input.rentValue),
    money(input.condominiumValue),
    money(input.feeValue),
  ]);
}

/** Small deterministic 128-bit hash used only to build an account-scoped UUID. */
function hash128(value: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  let h3 = 0xc0decafe;
  let h4 = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
    h3 = Math.imul(h3 ^ code, 2246822507);
    h4 = Math.imul(h4 ^ code, 3266489909);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h3 ^ (h3 >>> 13), 3266489909);
  h3 = Math.imul(h3 ^ (h3 >>> 16), 2246822507) ^ Math.imul(h4 ^ (h4 >>> 13), 3266489909);
  h4 = Math.imul(h4 ^ (h4 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return [h1, h2, h3, h4].map((part) => (part >>> 0).toString(16).padStart(8, "0")).join("");
}

function uuidFromHash(hash: string): string {
  const chars = hash.padEnd(32, "0").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const normalized = chars.join("");
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20)}`;
}

export function createCreditSimulationOperationKey(
  input: CreditSimulationOperationInput,
  now = Date.now(),
): { fingerprint: string; idempotencyKey: string } {
  const payload = canonicalPayload(input);
  const fingerprint = hash128(payload);
  const timeWindow = Math.floor(now / OPERATION_WINDOW_MS);
  return {
    fingerprint,
    idempotencyKey: uuidFromHash(hash128(`${payload}|${timeWindow}`)),
  };
}

export function getCreditSimulationOperationKey(
  input: CreditSimulationOperationInput,
  now = Date.now(),
): string {
  const generated = createCreditSimulationOperationKey(input, now);
  if (typeof window === "undefined") return generated.idempotencyKey;

  const storageKey = `${STORAGE_PREFIX}${generated.fingerprint}`;
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (saved) {
      const parsed = JSON.parse(saved) as { idempotencyKey?: string; expiresAt?: number };
      if (
        typeof parsed.idempotencyKey === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          parsed.idempotencyKey,
        ) &&
        Number(parsed.expiresAt) > now
      ) {
        return parsed.idempotencyKey;
      }
    }
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        idempotencyKey: generated.idempotencyKey,
        expiresAt: now + OPERATION_RETENTION_MS,
      }),
    );
  } catch {
    // Private browsing/storage denial does not remove idempotency: the time-window
    // key is deterministic across tabs and reloads for the same payload.
  }
  return generated.idempotencyKey;
}
