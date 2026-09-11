import { supabase } from "@/integrations/supabase/client";

export type SellerSignupRole = "proprietario" | "imobiliaria" | "corretor";

export type SellerSignupLink = {
  profileRole: SellerSignupRole;
  token: string;
  sourceSdrId: string | null;
  sourceSdrName: string | null;
};

export type SignupLinkSdr = { id: string; name: string };

export async function fetchSellerSignupLinks(sourceSdrId: string | null) {
  const { data, error } = await (supabase as any).rpc("get_my_seller_signup_links", {
    p_source_sdr_id: sourceSdrId,
  });
  if (error) throw error;
  return ((data as Record<string, unknown>[] | null) ?? []).map((row) => ({
    profileRole: String(row.profile_role) as SellerSignupRole,
    token: String(row.token),
    sourceSdrId: row.source_sdr_id ? String(row.source_sdr_id) : null,
    sourceSdrName: row.source_sdr_name ? String(row.source_sdr_name) : null,
  })) satisfies SellerSignupLink[];
}

export async function fetchSignupLinkSdrs() {
  const { data, error } = await (supabase as any).rpc("get_my_signup_link_sdrs");
  if (error) throw error;
  return ((data as Record<string, unknown>[] | null) ?? []).map((row) => ({
    id: String(row.sdr_id),
    name: String(row.sdr_name || "SDR"),
  })) satisfies SignupLinkSdr[];
}

export function buildSellerSignupUrl(role: SellerSignupRole, token: string) {
  const origin = typeof window === "undefined" ? "https://noxfianca.com" : window.location.origin;
  return `${origin}/cadastro-${role}?sl=${encodeURIComponent(token)}`;
}
