import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEMO_PASSWORD = "Teste@123";

const demoUsers = [
  { email: "admin@nox.com", role: "admin", nome: "Administrador NOX", telefone: "" },
  { email: "corretor@nox.com", role: "corretor", nome: "Corretor Teste", telefone: "(48) 99999-1111", cpf: "11122233344" },
  { email: "imobiliaria@nox.com", role: "imobiliaria", nome: "Imobiliária Teste", telefone: "(48) 99999-2222", cnpj: "12345678000190" },
  { email: "proprietario@nox.com", role: "proprietario", nome: "Proprietário Teste", telefone: "(48) 99999-3333", cpfCnpj: "22233344455" },
  { email: "inquilino.teste@nox.com", role: "inquilino", nome: "Anderson Henrique Araujo", telefone: "(48) 99999-4444", cpf: "40166574821" },
  // Camada de colaboradores internos NOX
  { email: "admin.master@nox.com", role: "admin_master", nome: "Admin Master NOX", telefone: "(48) 90000-0001", internal: true },
  { email: "juridico@nox.com", role: "juridico", nome: "Jurídico NOX", telefone: "(48) 90000-0002", internal: true },
  { email: "financeiro@nox.com", role: "financeiro", nome: "Financeiro NOX", telefone: "(48) 90000-0003", internal: true },
  { email: "marketing@nox.com", role: "marketing", nome: "Marketing NOX", telefone: "(48) 90000-0004", internal: true },
  { email: "suporte@nox.com", role: "suporte", nome: "Suporte NOX", telefone: "(48) 90000-0005", internal: true },
  { email: "vendedor@nox.com", role: "vendedor", nome: "Vendedor NOX", telefone: "(48) 90000-0006", internal: true },
] as const;

function isAllowedEnvironment(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const host = new URL(req.url).host;
  const allowedHosts = [origin, host].join(" ").toLowerCase();
  return (
    allowedHosts.includes("localhost") ||
    allowedHosts.includes("127.0.0.1") ||
    allowedHosts.includes("lovableproject.com") ||
    allowedHosts.includes("lovable.app") ||
    allowedHosts.includes("lovable.dev") ||
    Deno.env.get("ALLOW_DEMO_USERS") === "true"
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (!isAllowedEnvironment(req)) {
    console.warn("[ensure-demo-users] blocked outside preview/development", { origin: req.headers.get("origin") });
    return new Response(JSON.stringify({ ok: false, error: "Disponível apenas em desenvolvimento/preview." }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[ensure-demo-users] missing backend credentials");
    return new Response(JSON.stringify({ ok: false, error: "Credenciais do backend ausentes." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const results: Array<{ email: string; role: string; status: string; userId?: string; error?: string }> = [];

  for (const demo of demoUsers) {
    const email = demo.email.toLowerCase().trim();
    console.log("[ensure-demo-users] processando", { email, role: demo.role });

    try {
      const { data: userId, error: demoUserError } = await supabaseAdmin.rpc("ensure_nox_demo_auth_user", {
        p_email: email,
        p_password: DEMO_PASSWORD,
        p_nome: demo.nome,
        p_role: demo.role,
        p_telefone: demo.telefone,
      });

      if (demoUserError || !userId) {
        console.error("[ensure-demo-users] erro ao garantir Auth/Profile", { email, role: demo.role, error: demoUserError });
        throw new Error(demoUserError?.message ?? "Backend não retornou o usuário demo");
      }

      const status = "updated";

      const { error: profileError } = await supabaseAdmin.from("profiles").upsert(
        {
          id: userId,
          email,
          nome: demo.nome,
          role: demo.role,
          telefone: demo.telefone,
          status: "ativo",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
      if (profileError) {
        console.error("[ensure-demo-users] erro ao criar/atualizar profile", { email, role: demo.role, error: profileError });
        throw new Error(`Profile: ${profileError.message}`);
      }

      if (demo.role === "corretor") {
        const { error } = await supabaseAdmin.from("corretores").upsert(
          { profile_id: userId, cpf: demo.cpf, creci: "12345-F-SC", comissao_pct: 7, pix: email },
          { onConflict: "profile_id" },
        );
        if (error) console.error("[ensure-demo-users] erro corretor", { email, error });
      }

      if (demo.role === "imobiliaria") {
        const { error } = await supabaseAdmin.from("imobiliarias").upsert(
          {
            razao_social: `${demo.nome} LTDA`,
            nome_fantasia: demo.nome,
            cnpj: demo.cnpj,
            creci: "J-12345-SC",
            contato_email: email,
            contato_nome: demo.nome,
            contato_telefone: demo.telefone,
            comissao_pct: 3,
          },
          { onConflict: "cnpj" },
        );
        if (error) console.error("[ensure-demo-users] erro imobiliaria", { email, error });
      }

      if (demo.role === "proprietario") {
        const { error } = await supabaseAdmin.from("proprietarios").upsert(
          { profile_id: userId, nome: demo.nome, cpf_cnpj: demo.cpfCnpj, email, telefone: demo.telefone },
          { onConflict: "cpf_cnpj" },
        );
        if (error) console.error("[ensure-demo-users] erro proprietario", { email, error });
      }

      if (demo.role === "inquilino") {
        const { error } = await supabaseAdmin.from("inquilinos").upsert(
          { profile_id: userId, nome: demo.nome, cpf: demo.cpf, renda: 6500, profissao: "Analista", score: 850 },
          { onConflict: "profile_id" },
        );
        if (error) console.error("[ensure-demo-users] erro inquilino", { email, error });
      }

      if ((demo as any).internal) {
        const { error } = await supabaseAdmin.from("internal_users").upsert(
          {
            auth_user_id: userId,
            full_name: demo.nome,
            email,
            phone: demo.telefone,
            role: demo.role,
            status: "ativo",
          },
          { onConflict: "auth_user_id" },
        );
        if (error) console.error("[ensure-demo-users] erro internal_users", { email, error });
      }

      results.push({ email, role: demo.role, status, userId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[ensure-demo-users] falha no usuário demo", { email, role: demo.role, error: message });
      results.push({ email, role: demo.role, status: "error", error: message });
    }
  }

  const failed = results.filter((result) => result.status === "error");
  return new Response(JSON.stringify({ ok: failed.length === 0, users: results }), {
    status: failed.length === 0 ? 200 : 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});