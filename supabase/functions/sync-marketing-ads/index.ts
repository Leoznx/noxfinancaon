/* eslint-disable @typescript-eslint/no-explicit-any */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Integration = {
  id: string;
  provider: "meta" | "google";
  account_id: string;
  token_secret_name: string | null;
  customer_id: string | null;
  manager_customer_id: string | null;
};

type Campaign = {
  id: string;
  integration_id: string | null;
  provider: "meta" | "google";
  external_campaign_id: string | null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey)
    return json({ ok: false, error: "Supabase env ausente." }, 500);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const body = await safeJson(req);
  const date = String(body.date || new Date().toISOString().slice(0, 10));

  const { data: integrations, error: integrationsError } = await admin
    .from("marketing_ad_integrations")
    .select("*")
    .eq("status", "ativo");
  if (integrationsError) return json({ ok: false, error: integrationsError.message }, 500);

  const results: Record<string, unknown>[] = [];
  for (const integration of (integrations ?? []) as Integration[]) {
    const { data: campaigns, error: campaignsError } = await admin
      .from("marketing_campaigns")
      .select("id, integration_id, provider, external_campaign_id")
      .eq("integration_id", integration.id)
      .eq("status", "ativo");
    if (campaignsError) {
      results.push({ integrationId: integration.id, ok: false, error: campaignsError.message });
      continue;
    }

    try {
      const metrics =
        integration.provider === "meta"
          ? await fetchMetaMetrics(integration, (campaigns ?? []) as Campaign[], date)
          : await fetchGoogleMetrics(integration, (campaigns ?? []) as Campaign[], date);

      for (const metric of metrics) {
        await admin
          .from("marketing_campaign_metrics")
          .upsert(metric, { onConflict: "campaign_id,metric_date" });
      }

      await admin
        .from("marketing_ad_integrations")
        .update({ last_sync_at: new Date().toISOString(), last_error: null })
        .eq("id", integration.id);
      results.push({
        integrationId: integration.id,
        provider: integration.provider,
        ok: true,
        rows: metrics.length,
      });
    } catch (error: any) {
      await admin
        .from("marketing_ad_integrations")
        .update({
          last_sync_at: new Date().toISOString(),
          last_error: error.message || "sync_error",
        })
        .eq("id", integration.id);
      results.push({
        integrationId: integration.id,
        provider: integration.provider,
        ok: false,
        error: error.message,
      });
    }
  }

  return json({ ok: true, date, results });
});

async function fetchMetaMetrics(integration: Integration, campaigns: Campaign[], date: string) {
  const token = Deno.env.get(integration.token_secret_name || "META_MARKETING_ACCESS_TOKEN");
  const accountId = Deno.env.get("META_AD_ACCOUNT_ID") || integration.account_id;
  if (!token || !accountId) throw new Error("Credenciais Meta ausentes.");

  const params = new URLSearchParams({
    access_token: token,
    level: "campaign",
    fields: "campaign_id,impressions,clicks,spend,actions",
    time_range: JSON.stringify({ since: date, until: date }),
  });
  const graphVersion = Deno.env.get("META_GRAPH_API_VERSION") || "v23.0";
  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/act_${accountId}/insights?${params.toString()}`,
  );
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || "Falha na Meta Marketing API.");

  return (payload.data ?? [])
    .map((row: any) => {
      const campaign = campaigns.find((item) => item.external_campaign_id === row.campaign_id);
      if (!campaign) return null;
      const actions = Array.isArray(row.actions) ? row.actions : [];
      return {
        campaign_id: campaign.id,
        metric_date: date,
        impressions: Number(row.impressions ?? 0),
        clicks: Number(row.clicks ?? 0),
        leads: Number(actions.find((item: any) => item.action_type === "lead")?.value ?? 0),
        conversions: Number(
          actions.find((item: any) => item.action_type === "purchase")?.value ?? 0,
        ),
        spend: Number(row.spend ?? 0),
        raw_payload: row,
      };
    })
    .filter(Boolean);
}

async function fetchGoogleMetrics(integration: Integration, campaigns: Campaign[], date: string) {
  const developerToken = Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN");
  const accessToken = await getGoogleAccessToken();
  const customerId =
    Deno.env.get("GOOGLE_ADS_CUSTOMER_ID") || integration.customer_id || integration.account_id;
  if (!developerToken || !accessToken || !customerId)
    throw new Error("Credenciais Google Ads ausentes.");

  const query = `
    SELECT campaign.id, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
    FROM campaign
    WHERE segments.date = '${date}'
  `;
  const googleAdsVersion = Deno.env.get("GOOGLE_ADS_API_VERSION") || "v19";
  const response = await fetch(
    `https://googleads.googleapis.com/${googleAdsVersion}/customers/${customerId}:googleAds:search`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": developerToken,
        "login-customer-id":
          Deno.env.get("GOOGLE_ADS_MANAGER_CUSTOMER_ID") || integration.manager_customer_id || "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || "Falha na Google Ads API.");

  return (payload.results ?? [])
    .map((row: any) => {
      const campaign = campaigns.find(
        (item) => item.external_campaign_id === String(row.campaign?.id ?? ""),
      );
      if (!campaign) return null;
      return {
        campaign_id: campaign.id,
        metric_date: date,
        impressions: Number(row.metrics?.impressions ?? 0),
        clicks: Number(row.metrics?.clicks ?? 0),
        leads: Number(row.metrics?.conversions ?? 0),
        conversions: Number(row.metrics?.conversions ?? 0),
        spend: Number(row.metrics?.costMicros ?? 0) / 1_000_000,
        raw_payload: row,
      };
    })
    .filter(Boolean);
}

async function getGoogleAccessToken() {
  const clientId = Deno.env.get("GOOGLE_ADS_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_ADS_CLIENT_SECRET");
  const refreshToken = Deno.env.get("GOOGLE_ADS_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) return null;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error_description || "Falha ao renovar token Google.");
  return payload.access_token as string;
}

async function safeJson(req: Request) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
