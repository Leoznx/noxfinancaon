import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

/**
 * Edge Function: simular-loft
 *
 * Faz login automático na Loft via HTTP (sem cookies, sem client_id, sem token)
 * e chama a API de simulação de crédito.
 *
 * Fluxo:
 * 1. GET /oidc/authorization-code → redirect para Keycloak
 * 2. POST no Keycloak com email/senha → redirect de volta
 * 3. GET /oidc/callback → cookies de sessão
 * 4. Chama API de simulação com os cookies
 *
 * Uso: POST /functions/v1/simular-loft
 */

const LOFT_BASE = "https://app.loft.com.br";
const LOFT_API_BASE = `${LOFT_BASE}/fianca-aluguel/imobiliaria/api`;

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

/**
 * Extrai cookies de uma resposta HTTP.
 */
function extrairCookies(response: Response): Map<string, string> {
  const cookies = new Map<string, string>();
  const setCookieHeaders = response.headers.getSetCookie?.() ?? [];
  for (const header of setCookieHeaders) {
    const [pair] = header.split(";");
    const [name, ...rest] = pair.split("=");
    if (name && rest.length > 0) {
      cookies.set(name.trim(), rest.join("=").trim());
    }
  }
  return cookies;
}

/**
 * Faz login na Loft via HTTP e retorna os cookies de sessão.
 */
async function fazerLogin(): Promise<Map<string, string>> {
  const login = Deno.env.get("CREDPAGO_LOGIN") ?? "";
  const password = Deno.env.get("CREDPAGO_PASSWORD") ?? "";

  if (!login || !password) {
    throw new Error(
      "Credenciais da Loft não configuradas. Defina CREDPAGO_LOGIN e CREDPAGO_PASSWORD na Vercel."
    );
  }

  const cookies = new Map<string, string>();

  // 1. GET /oidc/authorization-code → redirect para Keycloak
  const authResponse = await fetch(`${LOFT_BASE}/fianca-aluguel/imobiliaria/oidc/authorization-code`, {
    redirect: "manual",
  });

  const location = authResponse.headers.get("location");
  if (!location) {
    throw new Error("Loft não retornou redirect para Keycloak");
  }

  // Captura cookies do primeiro response
  const firstCookies = extrairCookies(authResponse);
  firstCookies.forEach((v, k) => cookies.set(k, v));

  // 2. Segue o redirect para Keycloak
  const keycloakResponse = await fetch(location, { redirect: "manual" });
  const keycloakLocation = keycloakResponse.headers.get("location");
  const keycloakCookies = extrairCookies(keycloakResponse);
  keycloakCookies.forEach((v, k) => cookies.set(k, v));

  // 3. Se o Keycloak retornar redirect de volta (sessão já ativa), captura cookies
  if (keycloakLocation) {
    const callbackResponse = await fetch(keycloakLocation, { redirect: "manual" });
    const callbackCookies = extrairCookies(callbackResponse);
    callbackCookies.forEach((v, k) => cookies.set(k, v));
    const secondLocation = callbackResponse.headers.get("location");
    if (secondLocation) {
      const secondResponse = await fetch(secondLocation, { redirect: "manual" });
      const secondCookies = extrairCookies(secondResponse);
      secondCookies.forEach((v, k) => cookies.set(k, v));
    }
  }

  // 4. Tenta POST no Keycloak com as credenciais
  // Extrai a URL de login do Keycloak
  const loginUrl = keycloakLocation ?? location;
  const formData = new URLSearchParams({
    username: login,
    password: password,
    credentialId: "",
  });

  const loginResponse = await fetch(loginUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: Array.from(cookies.entries()).map(([k, v]) => `${k}=${v}`).join("; "),
    },
    body: formData.toString(),
    redirect: "manual",
  });

  const loginCookies = extrairCookies(loginResponse);
  loginCookies.forEach((v, k) => cookies.set(k, v));

  // 5. Segue redirects até receber os cookies de sessão
  let redirectUrl = loginResponse.headers.get("location");
  let redirects = 0;
  while (redirectUrl && redirects < 5) {
    const redirectResponse = await fetch(redirectUrl, {
      redirect: "manual",
      headers: {
        Cookie: Array.from(cookies.entries()).map(([k, v]) => `${k}=${v}`).join("; "),
      },
    });
    const redirectCookies = extrairCookies(redirectResponse);
    redirectCookies.forEach((v, k) => cookies.set(k, v));
    redirectUrl = redirectResponse.headers.get("location");
    redirects++;
  }

  return cookies;
}

async function requestLoft<T>(cookies: Map<string, string>, path: string, options: RequestInit = {}): Promise<T> {
  const cookieHeader = Array.from(cookies.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
  const response = await fetch(`${LOFT_API_BASE}${path}`, {
    ...options,
    headers: {
      Cookie: cookieHeader,
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

async function simularCredito(cookies: Map<string, string>, input: SimularLoftRequest) {
  const inquilinoPrincipal = input.tipoPessoa === "PF"
    ? { cpf: input.documento, nome: input.nome }
    : { cnpj: input.documento };

  // 1. Criar simulação
  const simulacao = await requestLoft<{ id: number }>(cookies, "/solicitacao/simulacao", {
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
  await requestLoft(cookies, `/solicitacao/simulacao/escolher-produto/${simulacao.id}`, {
    method: "POST",
    body: JSON.stringify({ id_produto: 33, taxa_setup: 0 }),
  });

  // 3. Atualizar proposta
  await requestLoft(cookies, `/solicitacao/simulacao/proposta/${simulacao.id}`, {
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
  await requestLoft(cookies, `/solicitacao/simulacao/${simulacao.id}/simular-parametros-fianca`, {
    method: "POST",
    body: JSON.stringify({ custo_saida: 2.5, cobertura_total: 12, comissao: 65 }),
  });

  // 5. Submeter proposta
  const submissao = await requestLoft<{ analise?: { status?: string } }>(
    cookies,
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

    // Faz login automático e obtém cookies de sessão
    const cookies = await fazerLogin();

    // Chama a API de simulação
    const resultado = await simularCredito(cookies, input);

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
