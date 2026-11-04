import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, jsonResponse, supabaseAdmin } from "../_shared/asaas.ts";
import { hasOversizedBody } from "../_shared/http-security.ts";
import {
  boundedCelebrationSince,
  isTrustedTvDisplayRequest,
  saoPauloMonthYear,
} from "../_shared/tv-display-access.ts";

type TvDisplayBody = {
  action?: "snapshot" | "celebrations";
  month?: number;
  year?: number;
  since?: string;
};

function uniqueStrings(values: unknown[]) {
  return [...new Set(values.map((value) => String(value || "")).filter(Boolean))];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonResponse(req, { ok: false, error: "Método não permitido." }, 405);
  }
  if (!isTrustedTvDisplayRequest(req)) {
    return jsonResponse(req, { ok: false, error: "Cliente de exibição não autorizado." }, 403);
  }
  if (hasOversizedBody(req, 8_192)) {
    return jsonResponse(req, { ok: false, error: "Payload muito grande." }, 413);
  }

  const body = (await req.json().catch(() => ({}))) as TvDisplayBody;
  const admin = supabaseAdmin();

  if (body.action === "snapshot") {
    const currentPeriod = saoPauloMonthYear();
    const month = Number(body.month);
    const year = Number(body.year);
    if (month !== currentPeriod.month || year !== currentPeriod.year) {
      return jsonResponse(req, { ok: false, error: "Período de exibição inválido." }, 400);
    }

    const [rankingResult, goalsResult] = await Promise.all([
      admin.rpc("ranking_vendedores", { p_month: month, p_year: year }),
      admin.rpc("get_tv_display_goal_progress", { p_month: month, p_year: year }),
    ]);
    if (rankingResult.error || goalsResult.error) {
      console.error("[tv-display] falha ao carregar snapshot", {
        ranking: rankingResult.error?.message || null,
        goals: goalsResult.error?.message || null,
      });
      return jsonResponse(req, { ok: false, error: "Falha ao sincronizar o painel." }, 500);
    }

    return jsonResponse(req, {
      ok: true,
      generatedAt: new Date().toISOString(),
      month,
      year,
      ranking: rankingResult.data || [],
      goals: goalsResult.data || [],
    });
  }

  if (body.action === "celebrations") {
    const checkedAt = new Date();
    const since = boundedCelebrationSince(body.since, checkedAt);
    const { data: attributions, error: attributionError } = await admin
      .from("seller_signup_attributions")
      .select("id,seller_id,created_at")
      .gt("created_at", since)
      .lte("created_at", checkedAt.toISOString())
      .order("created_at", { ascending: true })
      .limit(20);
    if (attributionError) {
      console.error("[tv-display] falha ao carregar comemorações", {
        message: attributionError.message,
      });
      return jsonResponse(req, { ok: false, error: "Falha ao sincronizar comemorações." }, 500);
    }

    const sellerIds = uniqueStrings((attributions || []).map((row) => row.seller_id));
    const { data: sellers, error: sellerError } = sellerIds.length
      ? await admin
          .from("internal_users")
          .select("id,auth_user_id,full_name,seller_type")
          .in("id", sellerIds)
      : { data: [], error: null };
    if (sellerError) {
      return jsonResponse(req, { ok: false, error: "Falha ao identificar a equipe." }, 500);
    }
    const authUserIds = uniqueStrings((sellers || []).map((row) => row.auth_user_id));
    const { data: profiles } = authUserIds.length
      ? await admin.from("profiles").select("id,avatar_url").in("id", authUserIds)
      : { data: [] };
    const sellerById = new Map((sellers || []).map((seller) => [String(seller.id), seller]));
    const avatarByUserId = new Map(
      (profiles || []).map((profile) => [String(profile.id), profile.avatar_url || null]),
    );

    return jsonResponse(req, {
      ok: true,
      checkedAt: checkedAt.toISOString(),
      celebrations: (attributions || []).flatMap((attribution) => {
        const seller = sellerById.get(String(attribution.seller_id));
        if (!seller) return [];
        return [
          {
            attribution_id: attribution.id,
            seller_id: seller.id,
            seller_name: seller.full_name || "Time NOX",
            seller_type: seller.seller_type === "closer" ? "closer" : "sdr",
            avatar_url: avatarByUserId.get(String(seller.auth_user_id)) || null,
            created_at: attribution.created_at,
          },
        ];
      }),
    });
  }

  return jsonResponse(req, { ok: false, error: "Ação inválida." }, 400);
});
