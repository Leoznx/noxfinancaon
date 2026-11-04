// Full local applications. Never open a real payment link: popup APIs are replaced,
// external requests are blocked, and backend responses contain only synthetic fixtures.
import { chromium } from "playwright";
import assert from "node:assert/strict";
const mobile = process.env.NOX_DEMO_SURFACE === "mobile";
const origin =
  process.env.NOX_TEST_ORIGIN || (mobile ? "http://127.0.0.1:4374" : "http://127.0.0.1:4173");
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const scenarios = [];
for (const role of ["proprietario", "corretor", "imobiliaria", "inquilino"])
  for (const marker of [false, true]) scenarios.push({ role, marker });
scenarios.push(
  { role: "proprietario", marker: true, real: true },
  { role: "inquilino", marker: true, real: true },
  { role: "inquilino", marker: true, denied: true },
);
try {
  for (const scenario of scenarios.filter((item) => !process.env.NOX_TEST_REAL_ONLY || item.real)) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const id = "11111111-1111-4111-8111-111111111111";
    const user = {
      id,
      email: scenario.real ? "real@example.invalid" : `${scenario.role}@nox.com`,
      aud: "authenticated",
      role: "authenticated",
      user_metadata: {},
      app_metadata: {},
    };
    const jwt = [
      { alg: "HS256", typ: "JWT" },
      { sub: id, email: user.email, exp: Math.floor(Date.now() / 1000) + 3600 },
      "test",
    ]
      .map((x) => Buffer.from(typeof x === "string" ? x : JSON.stringify(x)).toString("base64url"))
      .join(".");
    await context.addInitScript(
      ({ scenario, user, jwt, mobile }) => {
        window.demoLinkAttempts = [];
        window.open = (...args) => {
          window.demoLinkAttempts.push(args[0]);
          return null;
        };
        if (scenario.marker) sessionStorage.setItem("nox_demo_session", scenario.role);
        const storage = mobile || !scenario.marker ? localStorage : sessionStorage;
        storage.setItem(
          "sb-nox-demo-test-auth-token",
          JSON.stringify({
            access_token: jwt,
            refresh_token: "test",
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            token_type: "bearer",
            user,
          }),
        );
      },
      { scenario, user, jwt, mobile },
    );
    const unexpected = [];
    const reads = [];
    await context.route("**/*", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (url.origin === origin) return route.continue();
      if (url.hostname !== "nox-demo-test.supabase.co") {
        if (url.hostname === "real-boleto.invalid") unexpected.push("payment link");
        return route.abort();
      }
      if (
        !scenario.real &&
        (!["/auth/v1/user", "/rest/v1/profiles", "/rest/v1/internal_users"].includes(
          url.pathname,
        ) ||
          req.method() !== "GET")
      ) {
        unexpected.push(`${req.method()} ${url.pathname}`);
        return route.abort();
      }
      reads.push(url.pathname);
      let body = [];
      if (url.pathname === "/auth/v1/user") body = scenario.denied ? null : user;
      else if (url.pathname === "/rest/v1/profiles")
        body = {
          id,
          email: user.email,
          role: scenario.role,
          nome: "Fixture seguro",
          status: "ativo",
          cadastro_concluido_em: "2026-01-01",
        };
      else if (url.pathname === "/rest/v1/internal_users") body = null;
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
        body: JSON.stringify(body),
      });
    });
    const paths = scenario.real
      ? [scenario.role === "inquilino" ? "/inquilino/dashboard" : "/carteira-cobrancas"]
      : ["/inquilino/dashboard", "/carteira-cobrancas"];
    for (const path of paths) {
      reads.length = 0;
      await page.goto(origin + path, { waitUntil: "domcontentloaded", timeout: 120000 });
      if (scenario.denied) {
        await page
          .getByText(/Não foi possível verificar esta identidade demo/)
          .waitFor({ timeout: 60000 });
      } else if (scenario.real) {
        await page
          .getByText(path === "/carteira-cobrancas" ? "Carteira de Cobranças" : "Minhas faturas", {
            exact: true,
          })
          .first()
          .waitFor({ timeout: 60000 })
          .catch(async (error) => {
            console.error(await page.locator("body").innerText(), reads);
            throw error;
          });
        assert.equal(await page.getByText("Simulação completa", { exact: true }).count(), 0);
        await page.waitForFunction(() => !document.body.innerText.includes("Verificando sessão"));
        assert.ok(
          reads.some((path) =>
            ["/rest/v1/consultas_credito", "/rest/v1/faturas_inquilino"].includes(path),
          ),
          "real account must load its normal data, not marker fixtures",
        );
      } else {
        await page.getByText("Simulação completa", { exact: true }).waitFor({ timeout: 60000 });
        for (const name of [
          "Simular análise",
          "Simular conferência",
          "Simular ativação sem assinatura",
          "Simular pagamento",
        ])
          await page.getByRole("button", { name, exact: true }).click();
        await page.getByText("Recibo demonstrativo", { exact: true }).waitFor();
        assert.equal(await page.locator('a[href^="http"]').count(), 0);
      }
      assert.deepEqual(await page.evaluate(() => window.demoLinkAttempts), []);
      assert.deepEqual(unexpected, []);
      console.log(`PASS ${mobile ? "mobile" : "web"} ${JSON.stringify(scenario)} ${path}`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
