// Full local web application, actual router/Auth/Supabase SDK. All remote I/O mocked or blocked.
import { chromium } from "playwright";
import assert from "node:assert/strict";
const origin = process.env.NOX_TEST_ORIGIN || "http://127.0.0.1:4173";
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  for (const role of ["proprietario", "corretor", "imobiliaria", "inquilino"]) {
    const context = await browser.newContext();
    const id = "11111111-1111-4111-8111-111111111111";
    const authUser = {
      id,
      email: `${role}@nox.com`,
      role: "authenticated",
      aud: "authenticated",
      user_metadata: {},
      app_metadata: {},
    };
    const jwt = [
      { alg: "HS256", typ: "JWT" },
      { sub: id, email: authUser.email, exp: Math.floor(Date.now() / 1000) + 3600 },
      "test-signature",
    ]
      .map((part) =>
        Buffer.from(typeof part === "string" ? part : JSON.stringify(part)).toString("base64url"),
      )
      .join(".");
    await context.addInitScript(
      ({ role, authUser, jwt }) => {
        sessionStorage.setItem("nox_demo_session", role);
        sessionStorage.setItem(
          "sb-nox-demo-test-auth-token",
          JSON.stringify({
            access_token: jwt,
            refresh_token: "test",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            expires_in: 3600,
            token_type: "bearer",
            user: authUser,
          }),
        );
      },
      { role, authUser, jwt },
    );
    const unexpected = [];
    await context.route("**/*", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.origin === origin) {
        if (url.pathname.includes("_serverFn") || request.method() !== "GET") {
          unexpected.push("server-function request");
          return route.abort();
        }
        return route.continue();
      }
      if (url.hostname !== "nox-demo-test.supabase.co") return route.abort();
      const allowed = ["/auth/v1/user", "/rest/v1/profiles", "/rest/v1/internal_users"];
      if (!allowed.includes(url.pathname) || request.method() !== "GET") {
        unexpected.push(`${request.method()} ${url.pathname}`);
        return route.abort();
      }
      const body =
        url.pathname === "/auth/v1/user"
          ? authUser
          : url.pathname === "/rest/v1/profiles"
            ? {
                id,
                role,
                email: authUser.email,
                nome: "Teste sintético",
                avatar_url: null,
                cadastro_concluido_em: "2026-01-01T00:00:00Z",
              }
            : null;
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
        body: JSON.stringify(body),
      });
    });
    const page = await context.newPage();
    // Existing record-shaped IDs must never open the operational details for demo identities.
    for (const path of [
      `/consultas/${id}/finalizar`,
      `/apolices/${id}`,
      `/faturas-inquilinos/${id}`,
      "/configuracoes",
    ]) {
      await page.goto(origin + path, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.getByRole("heading", { name: "Simulação completa" }).waitFor({ timeout: 60000 });
      for (const name of [
        "Simular análise",
        "Simular conferência",
        "Simular ativação sem assinatura",
        "Simular pagamento",
      ])
        await page.getByRole("button", { name, exact: true }).click();
      await page.getByRole("heading", { name: "Recibo demonstrativo" }).waitFor();
      const blocked = await page.evaluate(async (id) => {
        const { supabase } = await import("/src/integrations/supabase/client.ts");
        const outcomes = [];
        for (const fn of ["contract-document", "d4sign-create-contract", "asaas-create-payment"]) {
          const result = await supabase.functions.invoke(fn, {
            body: { policyId: id, consultationId: id },
          });
          outcomes.push(!!result.error);
        }
        outcomes.push(
          !!(await supabase.from("consultas_credito").update({ status: "aprovado" }).eq("id", id))
            .error,
        );
        outcomes.push(
          !!(
            await supabase.auth.signUp({
              email: "never-create@example.invalid",
              password: "test-only-password",
            })
          ).error,
        );
        const { salvarConfiguracaoSeguro } = await import("/src/lib/finalizacao.functions.ts");
        try {
          await salvarConfiguracaoSeguro({
            data: {
              consultaId: id,
              insurance_coverages: [],
              insurance_assistance: null,
              insurance_commission_pct: 0,
            },
          });
          outcomes.push(false);
        } catch (error) {
          outcomes.push(String(error).includes("Operação real bloqueada"));
        }
        return outcomes;
      }, id);
      assert.deepEqual(blocked, [true, true, true, true, true, true]);
      assert.deepEqual(unexpected, [], "operational backend traffic must not escape the boundary");
      console.log(`PASS ${role} ${path}: local receipt, identity reads only`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
