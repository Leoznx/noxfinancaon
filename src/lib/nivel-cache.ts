import type { NivelInfo } from "./niveis-parceria";

// DashboardLayout remonta a cada navegação de página (não é um layout persistente
// do router) — sem esse cache, o card de Nível Atual da sidebar bateria no banco
// de novo a cada clique no menu. Guarda em memória (não localStorage — reseta
// sozinho a cada reload full, o que é aceitável pra um badge secundário).
let cache: { profileId: string; info: NivelInfo | null } | null = null;
let inflight: Promise<NivelInfo | null> | null = null;

export function getCachedNivelInfo(profileId: string): NivelInfo | null | undefined {
  return cache?.profileId === profileId ? cache.info : undefined;
}

export async function loadNivelInfo(profileId: string, role: string): Promise<NivelInfo | null> {
  if (cache?.profileId === profileId) return cache.info;
  if (inflight) return inflight;

  const { fetchNivelInfo } = await import("./niveis-parceria");
  inflight = fetchNivelInfo(profileId, role)
    .then((info) => {
      cache = { profileId, info };
      inflight = null;
      return info;
    })
    .catch(() => {
      inflight = null;
      return null;
    });
  return inflight;
}
