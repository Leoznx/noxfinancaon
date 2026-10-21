import { supabase } from "@/integrations/supabase/client";
import {
  invalidateSessionResource,
  loadSessionResource,
  peekSessionResource,
} from "@/lib/session-resource-cache";

export type AgencyScopeUser = {
  id: string;
  email?: string | null;
};

export type AgencyScope = {
  agencyId: string | null;
  agencyName: string;
  profileIds: string[];
};

const MAX_AGE_MS = 5 * 60_000;
const scopeKey = (profileId: string) => `identity:${profileId}:agency-scope`;

async function fallbackAgencyId(email: string | null | undefined) {
  let resolvedEmail = email?.trim() || "";
  if (!resolvedEmail) {
    const profile = await supabase.auth.getUser();
    resolvedEmail = profile.data.user?.email?.trim() || "";
  }
  if (!resolvedEmail) return null;

  // O caminho exato permite índice simples. O ilike fica apenas como fallback
  // para registros legados que tenham sido salvos com capitalização diferente.
  const exact = await supabase
    .from("imobiliarias")
    .select("id")
    .eq("contato_email", resolvedEmail)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (exact.error) throw exact.error;
  if (exact.data?.id) return exact.data.id;

  const insensitive = await supabase
    .from("imobiliarias")
    .select("id")
    .ilike("contato_email", resolvedEmail)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (insensitive.error) throw insensitive.error;
  return insensitive.data?.id ?? null;
}

async function fetchAgencyScope(user: AgencyScopeUser): Promise<AgencyScope> {
  // A função já existente resolve auth.uid() no servidor e não aceita identidade
  // do cliente. Além de preservar a autorização, evita repetir o filtro de e-mail
  // em cada tela do dashboard.
  const currentAgency = await supabase.rpc("current_imobiliaria_id");
  const agencyId = currentAgency.error
    ? await fallbackAgencyId(user.email)
    : currentAgency.data;

  if (!agencyId) {
    return { agencyId: null, agencyName: "Sua imobiliária", profileIds: [user.id] };
  }

  const [agencyResult, brokersResult] = await Promise.all([
    supabase
      .from("imobiliarias")
      .select("razao_social, nome_fantasia")
      .eq("id", agencyId)
      .maybeSingle(),
    supabase.from("corretores").select("profile_id").eq("imobiliaria_id", agencyId),
  ]);
  if (brokersResult.error) throw brokersResult.error;

  const agency = agencyResult.error ? null : agencyResult.data;
  const profileIds = Array.from(
    new Set([
      user.id,
      ...(brokersResult.data ?? []).flatMap((broker) =>
        broker.profile_id ? [broker.profile_id] : [],
      ),
    ]),
  );

  return {
    agencyId,
    agencyName: agency?.nome_fantasia || agency?.razao_social || "Sua imobiliária",
    profileIds,
  };
}

export function peekAgencyScope(profileId: string) {
  return peekSessionResource<AgencyScope>(scopeKey(profileId));
}

export function loadAgencyScope(user: AgencyScopeUser, force = false) {
  return loadSessionResource(scopeKey(user.id), () => fetchAgencyScope(user), {
    force,
    maxAgeMs: MAX_AGE_MS,
  });
}

export function invalidateAgencyScope(profileId: string) {
  invalidateSessionResource(scopeKey(profileId));
}
