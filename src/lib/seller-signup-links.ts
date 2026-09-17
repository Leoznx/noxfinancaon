import { supabase } from "@/integrations/supabase/client";

export type SellerSignupRole = "proprietario" | "imobiliaria" | "corretor";
export type SellerSignupSendChannel = "copy" | "whatsapp" | "share";

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

export async function fetchMeetingSignupLinks(appointmentId: string) {
  const { data, error } = await (supabase as any).rpc("get_meeting_signup_links", {
    p_appointment_id: appointmentId,
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

export async function recordSellerSignupLinkSend(
  token: string,
  profileRole: SellerSignupRole,
  channel: SellerSignupSendChannel,
) {
  const { error } = await (supabase as any).rpc("record_my_seller_signup_link_send", {
    p_token: token,
    p_profile_role: profileRole,
    p_channel: channel,
  });
  if (error) throw error;
}

export async function recordMeetingSignupLinkSend(
  appointmentId: string,
  token: string,
  profileRole: SellerSignupRole,
  channel: SellerSignupSendChannel,
) {
  const { error } = await (supabase as any).rpc("record_meeting_signup_link_send", {
    p_appointment_id: appointmentId,
    p_token: token,
    p_profile_role: profileRole,
    p_channel: channel,
  });
  if (error) throw error;
}

export function buildSellerSignupUrl(
  role: SellerSignupRole,
  token: string,
  appointmentId?: string,
) {
  const origin = typeof window === "undefined" ? "https://noxfianca.com" : window.location.origin;
  const params = new URLSearchParams({ sl: token });
  if (appointmentId) params.set("ma", appointmentId);
  return `${origin}/cadastro-${role}?${params.toString()}`;
}
