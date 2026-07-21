import { supabase } from "@/integrations/supabase/client";

// DashboardLayout remonta a cada navegação — sem cache, cada clique no menu
// bateria em role_permissions de novo (mesmo problema já resolvido pro
// card de Nível Atual, ver nivel-cache.ts). Guarda em memória por cargo.
export type PermissoesPorModulo = Record<string, boolean>;

let cache: { role: string; permissoes: PermissoesPorModulo } | null = null;
let inflight: { role: string; promise: Promise<PermissoesPorModulo> } | null = null;

export function getCachedPermissoesCargo(role: string): PermissoesPorModulo | undefined {
  return cache?.role === role ? cache.permissoes : undefined;
}

export async function loadPermissoesCargo(role: string): Promise<PermissoesPorModulo> {
  if (cache?.role === role) return cache.permissoes;
  if (inflight?.role === role) return inflight.promise;

  const promise = (async () => {
    try {
      const { data } = await supabase
        .from("role_permissions" as any)
        .select("module, can_view")
        .eq("role", role);
      const permissoes: PermissoesPorModulo = {};
      for (const row of (data as any[]) ?? []) {
        permissoes[row.module] = !!row.can_view;
      }
      cache = { role, permissoes };
      return permissoes;
    } catch {
      return {};
    } finally {
      if (inflight?.role === role) inflight = null;
    }
  })();
  inflight = { role, promise };
  return promise;
}

/** module: '*' libera tudo pro cargo (mesmo padrão já usado pro admin_master). */
export function podeVerModulo(permissoes: PermissoesPorModulo | undefined, module?: string): boolean {
  if (!module) return true; // itens sem module (Meu Perfil, Configurações) sempre visíveis
  if (!permissoes) return false; // ainda carregando — esconde até resolver, evita flash
  if (permissoes["*"]) return true;
  return !!permissoes[module];
}
