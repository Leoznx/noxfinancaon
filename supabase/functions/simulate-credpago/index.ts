import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { resolveProvider, MockCredPagoProvider, type ICreditoProvider } from "./provider.ts";
import type { ResultadoSimulacaoCredito, SimulateCredPagoRequest, SimulateCredPagoResponse } from "./types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Quem pode disparar/registrar uma simulação de crédito.
const ALLOWED_ROLES = ["corretor", "imobiliaria", "admin", "analista"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function persistirResultado(
  supabaseAdmin: ReturnType<typeof createClient>,
  consultaId: string,
  consultaAtual: any,
  resultado: ResultadoSimulacaoCredito,
) {
  const statusConsulta =
    resultado.status === "aprovado" ? "aprovado" : resultado.status === "recusado" ? "reprovado" : "pendente";

  // Preserva o resultado anterior (se houver) em external_history antes de sobrescrever —
  // a coluna já existia no schema pra esse propósito.
  const historicoAnterior: unknown[] = Array.isArray(consultaAtual?.external_history)
    ? consultaAtual.external_history
    : [];
  const novoHistorico = consultaAtual?.automacao_credpago_resultado
    ? [...historicoAnterior, { substituidoEm: new Date().toISOString(), resultado: consultaAtual.automacao_credpago_resultado }]
    : historicoAnterior;

  const { error } = await supabaseAdmin
    .from("consultas_credito")
    .update({
      external_provider: "credpago",
      external_status: resultado.statusOriginal,
      external_request_id: resultado.protocolo,
      external_response: (resultado.respostaBruta ?? null) as any,
      external_history: novoHistorico as any,
      automacao_credpago_status: resultado.status,
      automacao_credpago_resultado: resultado as any,
      automacao_origem: resultado.origem,
      automacao_attempts: (consultaAtual?.automacao_attempts ?? 0) + 1,
      automacao_processed_at: new Date().toISOString(),
      provider_returned_at: new Date().toISOString(),
      status: statusConsulta,
    })
    .eq("id", consultaId);

  if (error) throw error;
}

async function registrarAuditoria(
  supabaseAdmin: ReturnType<typeof createClient>,
  performedBy: string,
  action: string,
  targetId: string,
  details: unknown,
) {
  const { error } = await supabaseAdmin.from("audit_logs").insert({
    action,
    module: "consultas_credito",
    target_id: targetId,
    performed_by: performedBy,
    new_value: details as any,
  });
  if (error) console.error("Falha ao gravar audit_logs (não bloqueante):", error);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";

    // Cliente com o JWT de quem chamou — só pra identificar o usuário autenticado.
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    const {
      data: { user: authUser },
    } = await supabaseUser.auth.getUser();

    if (!authUser) {
      return json({ ok: false, error: "Não autenticado." } satisfies Partial<SimulateCredPagoResponse>, 401);
    }

    // Cliente com service role — usado só depois de confirmar quem é o usuário acima.
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, role")
      .eq("id", authUser.id)
      .maybeSingle();

    if (!profile || !ALLOWED_ROLES.includes((profile as any).role)) {
      return json({ ok: false, error: "Sem permissão para simular crédito." }, 403);
    }

    const body = (await req.json()) as SimulateCredPagoRequest;
    const { action, consultaId } = body;

    if (!consultaId) {
      return json({ ok: false, error: "consultaId é obrigatório." }, 400);
    }
    if (!["iniciar", "registrar-resultado", "mock"].includes(action)) {
      return json({ ok: false, error: `Ação desconhecida: ${action}` }, 400);
    }

    const { data: consulta, error: consultaError } = await supabaseAdmin
      .from("consultas_credito")
      .select("id, external_history, automacao_credpago_resultado, automacao_attempts")
      .eq("id", consultaId)
      .maybeSingle();

    if (consultaError || !consulta) {
      return json({ ok: false, error: "Consulta não encontrada." }, 404);
    }

    const provider: ICreditoProvider = action === "mock" ? new MockCredPagoProvider() : resolveProvider();

    if (action === "iniciar" || action === "mock") {
      if (!body.input) {
        return json({ ok: false, error: "Dados da simulação (input) são obrigatórios." }, 400);
      }

      const { portalUrl, instrucoes } = await provider.iniciar(body.input);

      await supabaseAdmin
        .from("consultas_credito")
        .update({
          external_provider: "credpago",
          sent_to_provider_at: new Date().toISOString(),
          automacao_credpago_status: action === "mock" ? "mock_iniciado" : "aguardando_registro_manual",
        })
        .eq("id", consultaId);

      await registrarAuditoria(supabaseAdmin, authUser.id, "simulacao_credpago_iniciada", consultaId, {
        action,
        tenantDocument: body.input.tenantDocument,
      });

      if (action === "mock") {
        const resultado = await provider.registrarResultado({});
        await persistirResultado(supabaseAdmin, consultaId, consulta, resultado);
        await registrarAuditoria(supabaseAdmin, authUser.id, "simulacao_credpago_resultado_mock", consultaId, {
          status: resultado.status,
        });
        return json({ ok: true, modo: "mock", resultado } satisfies SimulateCredPagoResponse);
      }

      return json({ ok: true, modo: "manual_assistido", portalUrl, instrucoes } satisfies SimulateCredPagoResponse);
    }

    // action === "registrar-resultado"
    if (!body.respostaColada) {
      return json({ ok: false, error: "Cole o retorno da CredPago para registrar o resultado." }, 400);
    }

    let resultado: ResultadoSimulacaoCredito;
    try {
      resultado = await provider.registrarResultado(body.respostaColada);
    } catch (validationError: any) {
      await registrarAuditoria(supabaseAdmin, authUser.id, "simulacao_credpago_registro_invalido", consultaId, {
        error: validationError.message,
      });
      return json({ ok: false, error: validationError.message }, 422);
    }

    await persistirResultado(supabaseAdmin, consultaId, consulta, resultado);

    await registrarAuditoria(supabaseAdmin, authUser.id, "simulacao_credpago_resultado_registrado", consultaId, {
      status: resultado.status,
      protocolo: resultado.protocolo,
    });

    return json({ ok: true, modo: "manual_assistido", resultado } satisfies SimulateCredPagoResponse);
  } catch (error: any) {
    console.error("Erro na function simulate-credpago:", error);
    return json({ ok: false, error: error.message ?? "Erro inesperado." }, 500);
  }
});
