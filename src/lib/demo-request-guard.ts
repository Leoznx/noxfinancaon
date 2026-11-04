import { isDemoSimulationEmail } from "./demo-simulation";

// Financial/contract lookups can continue after a real-to-demo session switch.
// Deny them at dispatch as well as at the route/loader boundary.
const demoBlockedReadTables = new Set([
  "niveis_perfil",
  "consultas_credito",
  "proprietarios",
  "imoveis",
  "imobiliarias",
  "apolices",
  "faturas_inquilino",
  "asaas_payments",
]);

export const DEMO_OPERATION_BLOCKED =
  "Operação real bloqueada para conta demonstrativa. Use o simulador local.";

// Used only to DENY operations, never to authenticate or grant access. Auth remains
// responsible for signature/expiry validation. No storage marker participates.
export function demoEmailFromBearer(authorization: string | null): string | undefined {
  if (!authorization?.match(/^Bearer /i)) return undefined;
  try {
    const payload = authorization.slice(7).split(".")[1];
    if (!payload || !/^[A-Za-z0-9_-]+$/.test(payload)) return undefined;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bits = 0,
      value = 0,
      decoded = "";
    for (const character of payload.replace(/-/g, "+").replace(/_/g, "/")) {
      value = (value << 6) | alphabet.indexOf(character);
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        decoded += String.fromCharCode((value >> bits) & 255);
      }
    }
    const email: unknown = JSON.parse(decoded).email;
    return typeof email === "string" && isDemoSimulationEmail(email) ? email : undefined;
  } catch {
    return undefined;
  }
}

export function assertNonDemoOperation(email: string | undefined): void {
  if (isDemoSimulationEmail(email)) throw new Error(DEMO_OPERATION_BLOCKED);
}

export function createDemoRequestGuard(upstream: typeof fetch) {
  let sessionEmail: string | undefined;
  const guardedFetch: typeof fetch = async (input, init) => {
    const request = typeof input === "object" && "url" in input ? input : undefined;
    const headers = new Headers(init?.headers ?? request?.headers);
    const demo =
      isDemoSimulationEmail(sessionEmail) || !!demoEmailFromBearer(headers.get("authorization"));
    if (demo) {
      const url = new URL(request?.url ?? String(input));
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      // Only identity/auth lifecycle and table reads are permitted. RPC may write
      // even with GET; Edge Functions/storage are deliberately not allowlisted.
      const authRead =
        method === "GET" && ["/auth/v1/user", "/auth/v1/settings"].includes(url.pathname);
      const authLifecycle =
        method === "POST" && ["/auth/v1/token", "/auth/v1/logout"].includes(url.pathname);
      const tableRead =
        ["GET", "HEAD"].includes(method) &&
        /^\/rest\/v1\/[^/]+$/.test(url.pathname) &&
        !url.pathname.endsWith("/rpc") &&
        !demoBlockedReadTables.has(url.pathname.split("/").pop() ?? "");
      if (!authRead && !authLifecycle && !tableRead) {
        return new Response(
          JSON.stringify({ message: DEMO_OPERATION_BLOCKED, code: "DEMO_OPERATION_BLOCKED" }),
          {
            status: 403,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    }
    return upstream(input, init);
  };
  return {
    fetch: guardedFetch,
    // Bind to the SDK session event, not a visual profile cache or demo flag.
    setSessionEmail(email: string | undefined) {
      sessionEmail = email;
    },
  };
}
