export type CachedHeaderProfile = {
  email: string;
  nome: string | null;
  avatarUrl: string | null;
  cachedAt?: number;
  agencyNameResolved?: boolean;
};

const PROFILE_CACHE_PREFIX = "nox_profile_header:";
export const PROFILE_CACHE_MAX_AGE_MS = 5 * 60_000;

function cacheKey(email: string) {
  return `${PROFILE_CACHE_PREFIX}${email.toLowerCase()}`;
}

export function getCachedHeaderProfile(
  email: string | null | undefined,
): CachedHeaderProfile | null {
  if (!email || typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(cacheKey(email));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.email !== email) return null;
    return {
      email,
      nome: parsed.nome || null,
      avatarUrl: parsed.avatarUrl || null,
      cachedAt: typeof parsed.cachedAt === "number" ? parsed.cachedAt : undefined,
      agencyNameResolved: parsed.agencyNameResolved === true,
    };
  } catch {
    return null;
  }
}

export function isCachedHeaderProfileFresh(
  profile: CachedHeaderProfile | null,
  now = Date.now(),
): boolean {
  return !!profile?.cachedAt && now - profile.cachedAt < PROFILE_CACHE_MAX_AGE_MS;
}

export function setCachedHeaderProfile(profile: CachedHeaderProfile) {
  if (!profile.email || typeof window === "undefined") return;

  try {
    const previous = getCachedHeaderProfile(profile.email);
    window.localStorage.setItem(
      cacheKey(profile.email),
      JSON.stringify({
        ...profile,
        cachedAt: Date.now(),
        agencyNameResolved: profile.agencyNameResolved ?? previous?.agencyNameResolved ?? false,
      }),
    );
  } catch {}
}
