const TV_APP_USER_AGENT = /\bNOX-TV\/\d+(?:\.\d+)?\b/i;
const OFFICIAL_TV_ORIGINS = new Set(["https://noxfianca.com", "https://www.noxfianca.com"]);

export function isTrustedTvDisplayRequest(request: Request) {
  const origin = request.headers.get("origin") || "";
  const userAgent = request.headers.get("user-agent") || "";
  return OFFICIAL_TV_ORIGINS.has(origin) && TV_APP_USER_AGENT.test(userAgent);
}

export function saoPauloMonthYear(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    month: "numeric",
    year: "numeric",
  }).formatToParts(now);
  return {
    month: Number(parts.find((part) => part.type === "month")?.value),
    year: Number(parts.find((part) => part.type === "year")?.value),
  };
}

export function boundedCelebrationSince(value: unknown, now = new Date()) {
  const parsed = new Date(typeof value === "string" ? value : "");
  const oldestAllowed = new Date(now.getTime() - 10 * 60_000);
  if (Number.isNaN(parsed.getTime()) || parsed < oldestAllowed || parsed > now) {
    return oldestAllowed.toISOString();
  }
  return parsed.toISOString();
}
