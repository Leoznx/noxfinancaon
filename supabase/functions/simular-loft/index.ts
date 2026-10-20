import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

/**
 * Edge Function: simular-loft
 *
 * Usa os cookies de sessão salvos pelo worker Playwright para autenticar.
 * O worker mantém a sessão sempre ativa (renova cookies automaticamente).
 *
 * Os cookies são lidos do arquivo /app/data/credpago-session.json
 * e podem ser atualizados via redeploy ou renovação manual.
 *
 * Uso: POST /functions/v1/simular-loft
 */

const LOFT_API_BASE = "https://app.loft.com.br/fianca-aluguel/imobiliaria/api";

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

interface StorageState {
  cookies?: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
  }>;
}

/**
 * Obtém cookies de sessão da Loft.
 *
 * Prioridade:
 * 1. LOFT_SESSION_COOKIES (variável de ambiente na Vercel)
 * 2. LOFT_PHPSESSID + LOFT_SESSION_ID (variáveis individuais)
 *
 * Para renovar: acesse o portal da Loft, copie os novos cookies
 * e atualize as variáveis na Vercel (Settings → Environment Variables).
 */
function getSessionCookies(): string {
  // 1. Tenta cookie combinado
  const envCookies = Deno.env.get("LOFT_SESSION_COOKIES");
  if (envCookies && envCookies.length > 0) {
    return envCookies;
  }

  // 2. Fallback: variáveis individuais
  const phpSessId = Deno.env.get("LOFT_PHPSESSID");
  const sessionId = Deno.env.get("LOFT_SESSION_ID");
  const idToken = Deno.env.get("LOFT_ID_TOKEN");

  const cookies: string[] = [];
  if (phpSessId) cookies.push(`PHPSESSID=${phpSessId}`);
  if (sessionId) cookies.push(`session_id=${sessionId}`);
  if (idToken) cookies.push(`id_token=${idToken}`);

  if (cookies.length === 0) {
    throw new Error(
      "Cookies de sessão da Loft não configurados. " +
      "Defina LOFT_SESSION_COOKIES ou LOFT_PHPSESSID + LOFT_SESSION_ID na Vercel. " +
      "Para renovar: acesse o portal da Loft, copie os cookies e atualize na Vercel."
    );
  }

  return cookies.join("; ");
}

async function requestLoft<T>(path: string, options: RequestInit = {}): Promise<T> {
  const cookies = getSessionCookies();
  const response = await fetch(`${LOFT_API_BASE}${path}`, {
    ...options,
    headers: {
      Cookie: cookies,
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Loft ${response.status}: ${text}`);
  }

  const json = await response.json();
  return json.data;
}

function normalizarStatus(statusLoft: string): "aprovado" | "recusado" | "em_analise" {
  const s = statusLoft.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (s.includes("aprov")) return "aprovado";
  if (s.includes("recus") || s.includes("reprov") || s.includes("negad")) return "recusado";
  return "em_analise";
}

async function simularCredito(input: SimularLoftRequest) {
  const inquilinoPrincipal = input.tipoPessoa === "PF"
    ? { cpf: input.documento, nome: input.nome }
    : { cnpj: input.documento };

  // 1. Criar simulação
  const simulacao = await requestLoft<{ id: number }>("/solicitacao/simulacao", {
    method: "POST",
    body: JSON.stringify({
      tipo_imovel: input.tipoImovel,
      cep: input.cep,
      valor_aluguel: input.valorAluguel,
      valor_condominio: input.valorCondominio,
      valor_outras_taxas: input.valorTaxas,
      inquilino_principal: inquilinoPrincipal,
      outros_inquilinos: [],
    }),
  });

  // 2. Escolher produto
  await requestLoft(`/solicitacao/simulacao/escolher-produto/${simulacao.id}`, {
    method: "POST",
    body: JSON.stringify({ id_produto: 33, taxa_setup: 0 }),
  });

  // 3. Atualizar proposta
  await requestLoft(`/solicitacao/simulacao/proposta/${simulacao.id}`, {
    method: "PUT",
    body: JSON.stringify({
      endereco: { cep: input.cep },
      subtipo_imovel: input.tipoImovel,
      tag: "nox_financa",
      ramo_atividade: "Aluguel",
      tipo_cobranca: "Mensal",
      taxa_setup: 0,
      inquilinos: [{ cpf: input.documento, nome: input.nome, tipo: input.tipoPessoa }],
    }),
  });

  // 4. Simular fiança
  await requestLoft(`/solicitacao/simulacao/${simulacao.id}/simular-parametros-fianca`, {
    method: "POST",
    body: JSON.stringify({ custo_saida: 2.5, cobertura_total: 12, comissao: 65 }),
  });

  // 5. Submeter proposta
  const submissao = await requestLoft<{ analise?: { status?: string } }>(
    `/solicitacao/simulacao/proposta/${simulacao.id}/submeter`,
    { method: "POST" },
  );

  const statusLoft = submissao.analise?.status ?? "Pendente";
  const status = normalizarStatus(statusLoft);

  return {
    status,
    proposalId: String(simulacao.id),
    clienteNome: input.nome,
    clienteDocumento: input.documento,
    statusLoft,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método não permitido" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user: authUser } } = await supabaseUser.auth.getUser();
    if (!authUser) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const input = await req.json() as SimularLoftRequest;
    if (!input.documento || !input.nome || !input.tipoImovel) {
      return new Response(JSON.stringify({ error: "Dados incompletos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resultado = await simularCredito(input);

    return new Response(JSON.stringify({ ok: true, resultado }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Erro na simulação:", error);
    return new Response(JSON.stringify({
      ok: false,
      error: error.message ?? "Erro inesperado",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
