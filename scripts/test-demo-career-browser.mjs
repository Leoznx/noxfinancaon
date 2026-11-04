// Run against a local dev server started with:
// VITE_SUPABASE_URL=https://nox-demo-test.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=test-public-key npm run dev -- --host 127.0.0.1 --port 4173
// All external requests are mocked or blocked; no production credentials or data are used.
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  headless: true,
  args: ["--no-sandbox"],
});
try {
  for (const scenario of [
    { role: "corretor", demo: true, email: "corretor@nox.com", count: 15 },
    { role: "imobiliaria", demo: true, email: "imobiliaria@nox.com", count: 15 },
    { role: "proprietario", demo: true, email: "proprietario@nox.com", count: 15 },
    { role: "corretor", demo: true, email: "real@example.com", count: 7 },
    { role: "corretor", demo: false, email: "real@example.com", count: 7 },
  ]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const id = "11111111-1111-4111-8111-111111111111";
    const authUser = {
      id,
      email: scenario.email,
      role: "authenticated",
      aud: "authenticated",
      user_metadata: {},
      app_metadata: {},
      created_at: new Date().toISOString(),
    };
    const jwt = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated" })).toString("base64url")}.test`;
    await context.addInitScript(
      ({ scenario, authUser, jwt }) => {
        if (scenario.demo) sessionStorage.setItem("nox_demo_session", scenario.role);
        const storage = scenario.demo ? sessionStorage : localStorage;
        storage.setItem(
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
      { scenario, authUser, jwt },
    );
    let careerReads = 0;
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.hostname === "127.0.0.1") return route.continue();
      if (url.hostname !== "nox-demo-test.supabase.co") return route.abort();
      let body = [];
      const headers = {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        "access-control-expose-headers": "content-range",
      };
      if (url.pathname === "/auth/v1/user") body = authUser;
      else if (url.pathname === "/rest/v1/profiles")
        body = {
          role: scenario.role,
          nome: "Conta de teste",
          avatar_url: null,
          cadastro_concluido_em: "2026-01-01T00:00:00Z",
        };
      else if (url.pathname === "/rest/v1/internal_users") body = null;
      else if (url.pathname === "/rest/v1/rpc/get_my_broker_commission_access")
        body = [{ can_access_financial_modules: true, commission_allocation_mode: "broker_full" }];
      else if (url.pathname === "/rest/v1/apolices" && request.method() === "HEAD") {
        careerReads++;
        headers["content-range"] = "0-6/7";
      }
      await route.fulfill({
        status: 200,
        headers,
        body: request.method() === "HEAD" ? "" : JSON.stringify(body),
      });
    });
    await page.goto("http://127.0.0.1:4173/plano-carreira");
    const bar = page.getByRole("progressbar", { name: "Progresso para o próximo nível" });
    await bar.waitFor({ timeout: 60000 });
    await page.getByText(`${scenario.count} contratos`, { exact: false }).first().waitFor();
    if (scenario.count === 15) {
      assert.equal(await bar.getAttribute("aria-valuenow"), "40");
      assert.match(await page.locator("body").innerText(), /PRATA • 15 contratos/);
      assert.match(await page.locator("body").innerText(), /Faltam 6 contratos para OURO/i);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.waitForTimeout(250);
      assert.equal(careerReads, 0);
      if (process.env.DEMO_SCREENSHOT_DIR) {
        await page.screenshot({
          path: `${process.env.DEMO_SCREENSHOT_DIR}/nox-demo-${scenario.role}.png`,
          fullPage: true,
        });
      }
    } else {
      assert.match(await page.locator("body").innerText(), /BRONZE • 7 contratos/);
      assert.ok(careerReads > 0);
    }
    console.log(
      JSON.stringify({
        scenario,
        careerReads,
        progress: await bar.getAttribute("aria-valuenow"),
        passed: true,
      }),
    );
    await context.close();
  }
} finally {
  await browser.close();
}
