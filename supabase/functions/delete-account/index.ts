import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { corsHeaders, hasOversizedBody, rejectDisallowedOrigin } from "../_shared/http-security.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  const response = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  const rejected = rejectDisallowedOrigin(req);
  if (rejected) return rejected;
  if (req.method !== "POST") return response({ ok: false, error: "Método não permitido." }, 405);
  if (hasOversizedBody(req, 4_096))
    return response({ ok: false, error: "Payload muito grande." }, 413);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey)
    return response({ ok: false, error: "Serviço indisponível." }, 500);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return response({ ok: false, error: "Não autenticado." }, 401);

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  const userId = userData?.user?.id;
  if (userError || !userId)
    return response({ ok: false, error: "Sessão inválida ou expirada." }, 401);

  // Business guard: nao permite auto-exclusao com obrigacoes financeiras ou
  // contratuais em aberto. Impede corretor/imobiliaria/inquilino de fugir de
  // reversao de comissao, fatura pendente ou saque em analise.
  const [faturasAbertas, apolicesAtivas, saquesPendentes, periodoPendente] = await Promise.all([
    supabaseAdmin
      .from("faturas_inquilino")
      .select("id", { count: "exact", head: true })
      .eq("tenant_user_id", userId)
      .in("status", ["pending", "overdue", "waiting_payment", "approved", "confirmed", "partial"]),
    supabaseAdmin
      .from("apolices")
      .select("id", { count: "exact", head: true })
      .or(
        `tenant_user_id.eq.${userId},profile_id_solicitante.eq.${userId},corretor_profile_id.eq.${userId},imobiliaria_profile_id.eq.${userId}`,
      )
      .in("status", ["ativa", "ativada", "pendente_pagamento", "pendente_assinatura"]),
    supabaseAdmin
      .from("withdrawal_requests")
      .select("id", { count: "exact", head: true })
      .eq("beneficiary_profile_id", userId)
      .in("status", ["pending", "approved", "awaiting_payment"]),
    supabaseAdmin
      .from("consultas_credito")
      .select("id", { count: "exact", head: true })
      .or(`profile_id_solicitante.eq.${userId},tenant_user_id.eq.${userId}`)
      .not("contract_period_change_pending_at", "is", null),
  ]);

  const bloqueios: string[] = [];
  if ((faturasAbertas?.count || 0) > 0) bloqueios.push("faturas em aberto");
  if ((apolicesAtivas?.count || 0) > 0) bloqueios.push("apólices ativas");
  if ((saquesPendentes?.count || 0) > 0) bloqueios.push("saques pendentes");
  if ((periodoPendente?.count || 0) > 0) bloqueios.push("mudança de período em andamento");
  if (bloqueios.length) {
    return response(
      {
        ok: false,
        error: `Resolva antes: ${bloqueios.join(", ")}. Fale com o suporte para prosseguir com a exclusao.`,
      },
      409,
    );
  }

  const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (deleteError) {
    console.error("[delete-account] exclusão não concluída", {
      code: (deleteError as any)?.code || "unknown",
    });
    return response({ ok: false, error: "Não foi possível excluir a conta." }, 500);
  }
  return response({ ok: true });
});
