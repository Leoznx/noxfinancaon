export type MenuRouteCandidate = {
  href: string;
  parentLabel?: string;
};

function normalizePathname(pathname: string) {
  if (!pathname || pathname === "/") return "/";
  return pathname.replace(/\/+$/, "") || "/";
}

export function menuRouteKey(candidate: MenuRouteCandidate) {
  return `${candidate.href}-${candidate.parentLabel ?? "principal"}`;
}

export function resolveActiveMenuRouteKey(
  candidates: MenuRouteCandidate[],
  pathname: string,
  search = "",
): string | null {
  const currentPath = normalizePathname(pathname);
  const currentParams = new URLSearchParams(search.replace(/^\?/, ""));
  let bestMatch: { key: string; score: number } | null = null;

  for (const candidate of candidates) {
    const [rawCandidatePath, candidateSearch = ""] = candidate.href.split("?");
    const candidatePath = normalizePathname(rawCandidatePath);
    const matchesPath =
      currentPath === candidatePath ||
      (candidatePath !== "/" && currentPath.startsWith(`${candidatePath}/`));
    if (!matchesPath) continue;

    const expectedParams = new URLSearchParams(candidateSearch);
    const expectedEntries = Array.from(expectedParams.entries());
    if (expectedEntries.some(([key, value]) => currentParams.get(key) !== value)) continue;
    if (!candidateSearch && candidate.parentLabel && currentParams.has("tab")) continue;

    const exactPathBonus = currentPath === candidatePath ? 1_000 : 0;
    const queryBonus = expectedEntries.length * 10_000;
    const score = candidatePath.length * 100 + exactPathBonus + queryBonus;
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { key: menuRouteKey(candidate), score };
    }
  }

  return bestMatch?.key ?? null;
}
