import { supabase } from "@/integrations/supabase/client";
import { loadSessionResource, peekSessionResource } from "@/lib/session-resource-cache";

export type SinistrosRouteData = {
  sinistros: any[];
  apolices: any[];
};

const key = (profileId: string) => `dashboard-route:${profileId}:sinistros`;

export function peekSinistrosRouteData(profileId: string) {
  return peekSessionResource<SinistrosRouteData>(key(profileId));
}

export function loadSinistrosRouteData(profileId: string, force = false) {
  return loadSessionResource(
    key(profileId),
    async (): Promise<SinistrosRouteData> => {
      const [sinistrosResult, apolicesResult] = await Promise.all([
        supabase
          .from("sinistros")
          .select(`
            *,
            apolices (
              numero,
              consultas_credito (
                inquilinos (nome),
                imoveis (logradouro, numero, bairro)
              )
            )
          `)
          .order("created_at", { ascending: false }),
        supabase
          .from("apolices")
          .select(`
            id,
            numero,
            consultas_credito (
              inquilinos (nome),
              imoveis (valor_aluguel)
            )
          `)
          .eq("status", "ativa"),
      ]);
      if (sinistrosResult.error) throw sinistrosResult.error;
      if (apolicesResult.error) throw apolicesResult.error;
      return {
        sinistros: sinistrosResult.data ?? [],
        apolices: apolicesResult.data ?? [],
      };
    },
    { force, maxAgeMs: 45_000 },
  );
}
