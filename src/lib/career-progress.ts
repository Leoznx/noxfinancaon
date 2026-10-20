import { supabase } from "@/integrations/supabase/client";
import { loadSessionResource, peekSessionResource } from "@/lib/session-resource-cache";

const keyFor = (userId: string, role: string) => `dashboard-route:${userId}:career:${role}`;

export function peekCareerContractCount(userId: string, role: string) {
  return peekSessionResource<number>(keyFor(userId, role));
}

export function loadCareerContractCount(userId: string, role: string, force = false) {
  const field = {
    corretor: "corretor_profile_id",
    imobiliaria: "imobiliaria_profile_id",
    proprietario: "proprietario_profile_id",
  }[role];
  if (!field) return Promise.resolve(0);
  return loadSessionResource(
    keyFor(userId, role),
    async () => {
      const { count, error } = await supabase
        .from("apolices")
        .select("id", { count: "exact", head: true })
        .eq("status", "ativa")
        .eq(field as any, userId);
      if (error) throw error;
      return count ?? 0;
    },
    { force, maxAgeMs: 60_000 },
  );
}
