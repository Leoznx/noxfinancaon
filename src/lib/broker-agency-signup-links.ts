import { supabase } from "@/integrations/supabase/client";
import { normalizeBrokerAgencySignupToken } from "@/lib/broker-agency-signup-token";

export {
  BROKER_AGENCY_SIGNUP_TOKEN_PATTERN,
  buildBrokerAgencySignupUrl,
  normalizeBrokerAgencySignupToken,
} from "@/lib/broker-agency-signup-token";

export type BrokerAgencySignupLink = {
  token: string;
  agencyName: string;
  usageCount: number;
};

export async function getOrCreateMyBrokerAgencySignupLink() {
  const { data, error } = await supabase.rpc("get_or_create_my_broker_agency_signup_link");
  if (error) return { data: null, error: error.message };
  const row = Array.isArray(data) ? data[0] : null;
  const token = normalizeBrokerAgencySignupToken(row?.token);
  if (!row || !token) {
    return { data: null, error: "Não foi possível gerar o link da imobiliária." };
  }
  return {
    data: {
      token,
      agencyName: String(row.agency_name || "Imobiliária"),
      usageCount: Number(row.usage_count || 0),
    } satisfies BrokerAgencySignupLink,
    error: null,
  };
}

export async function resolveBrokerAgencySignupLink(tokenValue: unknown) {
  const token = normalizeBrokerAgencySignupToken(tokenValue);
  if (!token) return { agencyName: null, error: "Link de cadastro inválido." };
  const { data, error } = await supabase.rpc("resolve_broker_agency_signup_link", {
    p_token: token,
  });
  if (error) return { agencyName: null, error: error.message };
  const row = Array.isArray(data) ? data[0] : null;
  return row?.agency_name
    ? { agencyName: String(row.agency_name), error: null }
    : { agencyName: null, error: "Link de cadastro inválido." };
}
