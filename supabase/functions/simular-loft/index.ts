import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

/**
 * Edge Function: simular-loft
 *
 * Recebe os dados do formulário da NOX e chama a API da Loft diretamente.
 * Retorna o resultado (aprovado/recusado/em_analise) para o frontend.
 *
 * Uso: POST /functions/v1/simular-loft
 */

const LOFT_API_BASE = "https://app.loft.com.br/fianca-aluguel/imobiliaria/api";
const LOFT_OAUTH_TOKEN_URL = "https://auth.loft.com.br/v2/oauth/token";

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

interface LoftApiClient {
  accessToken: string | null;
  tokenExpiresAt: number;
  clientId: string;
  clientSecret: string;
  scope: string;
}

function createLoftClient(): LoftApiClient {
  return {
    accessToken: null,
    tokenExpiresAt: 0,
    clientId: Deno.env.get("LOFT_OAUTH_CLIENT_ID") ?? "",
    clientSecret: Deno.env.get("LOFT_OAUTH_CLIENT_SECRET") ?? "",
    scope: "loft-aluguel",
  };
}

async function obterToken(client: LoftApiClient): Promise<string> {
  if (client.accessToken && Date.now() < client.tokenExpiresAt) {
    return client.accessToken;
  }

  if (!client.clientId || !client.clientSecret) {
    throw new Error("Credenciais OAuth2 da Loft não configuradas");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: client.clientId,
    client_secret: client.clientSecret,
    scope: client.scope,
  });

  const response = await fetch(LOFT_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`OAuth2 ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  client.accessToken = data.access_token;
  client.tokenExpiresAt = Date.now() + (data.expires_in - 300) * 1000;
  return client.accessToken;
}

async function requestLoft<T>(client: LoftApiClient, path: string, options: RequestInit = {}): Promise<T> {
  const token = await obterToken(client);
  const response = await fetch(`${LOFT_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    },
  });

  if (!response.ok) {
    throw new Error(`Loft ${response.status}: ${await response.text()}`);
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

async function simularCredito(client: LoftApiClient, input: SimularLoftRequest) {
  // 1. Criar simulação
  const inquilinoPrincipal = input.tipoPessoa === "PF"
    ? { cpf: input.documento, nome: input.nome }
    : { cnpj: input.documento };

  const simulacao = await requestLoft<{ id: number }>(client, "/solicitacao/simulacao", {
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
  await requestLoft(client, `/solicitacao/simulacao/escolher-produto/${simulacao.id}`, {
    method: "POST",
    body: JSON.stringify({ id_produto: 33, taxa_setup: 0 }),
  });

  // 3. Atualizar proposta
  await requestLoft(client, `/solicitacao/simulacao/proposta/${simulacao.id}`, {
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
  await requestLoft(client, `/solicitacao/simulacao/${simulacao.id}/simular-parametros-fianca`, {
    method: "POST",
    body: JSON.stringify({ custo_saida: 2.5, cobertura_total: 12, comissao: 65 }),
  });

  // 5. Submeter proposta
  const submissao = await requestLoft<{ analise?: { status?: string } }>(
    client,
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
    // Verifica autenticação do usuário
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

    // Validação mínima
    if (!input.documento || !input.nome || !input.tipoImovel) {
      return new Response(JSON.stringify({ error: "Dados incompletos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const client = createLoftClient();
    const resultado = await simularCredito(client, input);

    return new Response(JSON.stringify({
      ok: true,
      resultado,
    }), {
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
