export type CachedHeaderProfile = {
  email: string;
  nome: string | null;
  avatarUrl: string | null;
};

const PROFILE_CACHE_PREFIX = "nox_profile_header:";

function cacheKey(email: string) {
  return `${PROFILE_CACHE_PREFIX}${email.toLowerCase()}`;
}

export function getCachedHeaderProfile(email: string | null | undefined): CachedHeaderProfile | null {
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
    };
  } catch {
    return null;
  }
}

export function setCachedHeaderProfile(profile: CachedHeaderProfile) {
  if (!profile.email || typeof window === "undefined") return;

  try {
    window.localStorage.setItem(cacheKey(profile.email), JSON.stringify(profile));
  } catch {}
}
