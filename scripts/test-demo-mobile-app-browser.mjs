// Full Expo web application, actual native screens/router/Auth/Supabase SDK. Run Expo on 4174 with the same synthetic configuration as the web test. All remote I/O mocked or blocked.
import { chromium } from "playwright";
import assert from "node:assert/strict";
const origin = process.env.NOX_TEST_ORIGIN || "http://127.0.0.1:4174";
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  for (const role of ["proprietario", "corretor", "imobiliaria", "inquilino", "real"]) {
    const context = await browser.newContext();
    const id = "11111111-1111-4111-8111-111111111111";
    const authUser = {
      id,
      email: role === "real" ? "real@example.invalid" : `${role}@nox.com`,
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
        // Auth identity deliberately differs from the stale profile email.
        localStorage.setItem("nox_demo_session", role);
        localStorage.setItem(
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
      if (role !== "real" && (!allowed.includes(url.pathname) || request.method() !== "GET")) {
        unexpected.push(`${request.method()} ${url.pathname}`);
        return route.abort();
      }
      const body =
        url.pathname === "/auth/v1/user"
          ? authUser
          : url.pathname === "/rest/v1/profiles"
            ? {
                id,
                role: role === "real" ? "corretor" : role,
                email: role === "real" ? "corretor@nox.com" : "stale-real-profile@example.invalid",
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
    for (const path of role === "real"
      ? ["/perfil"]
      : [`/consulta/${id}/finalizar`, `/apolice/${id}`, "/perfil"]) {
      await page.goto(origin + path, { waitUntil: "domcontentloaded", timeout: 120000 });
      if (role === "real") {
        await page
          .getByText("Gerencie sua conta, preferências e dados da plataforma.", { exact: true })
          .waitFor({ timeout: 120000 });
        assert.equal(await page.getByText("Simulação completa", { exact: true }).count(), 0);
        console.log("PASS real: Auth email overrides misleading demo profile.email");
        continue;
      }
      await page.getByText("Simulação completa", { exact: true }).waitFor({ timeout: 120000 });
      for (const name of [
        "Simular análise",
        "Simular conferência",
        "Simular ativação sem assinatura",
        "Simular pagamento",
      ])
        await page.getByRole("button", { name, exact: true }).click();
      await page.getByText("Recibo demonstrativo", { exact: true }).waitFor();
      assert.deepEqual(unexpected, [], "operational backend traffic must not escape the boundary");
      console.log(`PASS ${role} ${path}: local receipt, identity reads only`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
