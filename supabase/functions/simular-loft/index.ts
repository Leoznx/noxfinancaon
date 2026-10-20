import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

/**
 * Edge Function: simular-loft
 *
 * Estratégia unificada:
 * 1. Tenta API direta com cookies de sessão (rápido, ~5-10s)
 * 2. Se cookies falham, usa fila + worker Playwright (confiável, ~2-5min)
 *
 * O worker Playwright mantém a sessão ativa e renova cookies automaticamente.
 * Quando a API direta falha, o worker processa a consulta e o resultado
 * aparece no painel via Realtime.
 *
 * Uso: POST /functions/v1/simular-loft
 */

const LOFT_API_BASE = "https://app.loft.com.br/fianca-aluguel/imobiliaria/api";
const LOFT_BASE = "https://app.loft.com.br";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface SimularLoftRequest {
  tipoPessoa: "PF" | "PJ";
  documento: string;
  nome: string;
  tipoImovel: string;
  cep: string;
  valorAluguel: number;
  valorCondominio: number;
  valorTaxas: number;
}

function getSessionCookies(): string {
  const envCookies = Deno.env.get("LOFT_SESSION_COOKIES");
  if (envCookies && envCookies.length > 0) return envCookies;

  const phpSessId = Deno.env.get("LOFT_PHPSESSID");
  const sessionId = Deno.env.get("LOFT_SESSION_ID");
  const idToken = Deno.env.get("LOFT_ID_TOKEN");

  const cookies: string[] = [];
  if (phpSessId) cookies.push(`PHPSESSID=${phpSessId}`);
  if (sessionId) cookies.push(`session_id=${sessionId}`);
  if (idToken) cookies.push(`id_token=${idToken}`);

  return cookies.length > 0 ? cookies.join("; ") : "";
}

async function requestLoft<T>(path: string, options: RequestInit = {}): Promise<T> {
  const cookies = getSessionCookies();
  if (!cookies) throw new Error("Sem cookies");

  const response = await fetch(`${LOFT_API_BASE}${path}`, {
    ...options,
    headers: { Cookie: cookies, "Content-Type": "application/json", ...(options.headers as Record<string, string>) },
  });

  if (!response.ok) throw new Error(`Loft ${response.status}: ${await response.text()}`);
  return (await response.json()).data;
}

function normalizarStatus(statusLoft: string): "aprovado" | "recusado" | "em_analise" {
  const s = statusLoft.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (s.includes("aprov")) return "aprovado";
  if (s.includes("recus") || s.includes("reprov") || s.includes("negad")) return "recusado";
  return "em_analise";
}

async function simularViaApiDireta(input: SimularLoftRequest) {
  const inquilinoPrincipal = input.tipoPessoa === "PF"
    ? { cpf: input.documento, nome: input.nome }
    : { cnpj: input.documento };

  const simulacao = await requestLoft<{ id: number }>("/solicitacao/simulacao", {
    method: "POST",
    body: JSON.stringify({
      tipo_imovel: input.tipoImovel, cep: input.cep,
      valor_aluguel: input.valorAluguel, valor_condominio: input.valorCondominio,
      valor_outras_taxas: input.valorTaxas,
      inquilino_principal: inquilinoPrincipal, outros_inquilinos: [],
    }),
  });

  await requestLoft(`/solicitacao/simulacao/escolher-produto/${simulacao.id}`, {
    method: "POST", body: JSON.stringify({ id_produto: 33, taxa_setup: 0 }),
  });

  await requestLoft(`/solicitacao/simulacao/proposta/${simulacao.id}`, {
    method: "PUT",
    body: JSON.stringify({
      endereco: { cep: input.cep }, subtipo_imovel: input.tipoImovel,
      tag: "nox_financa", ramo_atividade: "Aluguel", tipo_cobranca: "Mensal",
      taxa_setup: 0,
      inquilinos: [{ cpf: input.documento, nome: input.nome, tipo: input.tipoPessoa }],
    }),
  });

  await requestLoft(`/solicitacao/simulacao/${simulacao.id}/simular-parametros-fianca`, {
    method: "POST", body: JSON.stringify({ custo_saida: 2.5, cobertura_total: 12, comissao: 65 }),
  });

  const submissao = await requestLoft<{ analise?: { status?: string } }>(
    `/solicitacao/simulacao/proposta/${simulacao.id}/submeter`, { method: "POST" },
  );

  const statusLoft = submissao.analise?.status ?? "Pendente";
  return { status: normalizarStatus(statusLoft), proposalId: String(simulacao.id), clienteNome: input.nome, clienteDocumento: input.documento, statusLoft };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Método não permitido" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUser = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", { global: { headers: { Authorization: authHeader } } });
    const { data: { user: authUser } } = await supabaseUser.auth.getUser();
    if (!authUser) return new Response(JSON.stringify({ error: "Não autenticado" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const input = await req.json() as SimularLoftRequest;
    if (!input.documento || !input.nome || !input.tipoImovel) {
      return new Response(JSON.stringify({ error: "Dados incompletos" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Tenta API direta primeiro (se cookies configurados)
    if (getSessionCookies()) {
      try {
        const resultado = await simularViaApiDireta(input);
        return new Response(JSON.stringify({ ok: true, resultado, metodo: "api_direta" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (apiError) {
        console.warn("API direta falhou, cliente deve usar fila:", apiError);
      }
    }

    // Sem cookies ou API falhou: retorna orientação para usar fila
    return new Response(JSON.stringify({
      ok: false,
      metodo: "fila_necessaria",
      error: "API direta indisponível. Sua consulta será processada pela automação (worker Playwright). Acompanhe em Minhas Consultas.",
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Erro na simulação:", error);
    return new Response(JSON.stringify({ ok: false, error: error.message ?? "Erro inesperado" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
