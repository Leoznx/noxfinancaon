// Full local applications. Never open a real payment link: popup APIs are replaced,
// external requests are blocked, and backend responses contain only synthetic fixtures.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { validateFixtureOrigin } from "./demo-browser-fixture-origin.mjs";
const mobile = process.env.NOX_DEMO_SURFACE === "mobile";
const origin = validateFixtureOrigin(
  process.env.NOX_TEST_ORIGIN || (mobile ? "http://127.0.0.1:4374" : "http://127.0.0.1:4173"),
);
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const scenarios = [];
const trackingScripts = [
  "https://www.googletagmanager.com/gtag/js?id=AW-18391707457",
  "https://connect.facebook.net/en_US/fbevents.js",
];
for (const role of ["proprietario", "corretor", "imobiliaria", "inquilino"])
  for (const marker of [false, true]) scenarios.push({ role, marker });
scenarios.push(
  { role: "proprietario", marker: true, real: true },
  { role: "inquilino", marker: true, real: true },
  { role: "inquilino", marker: true, denied: true },
  ...(!mobile
    ? [
        { role: "proprietario", marker: false, real: true, consent: true },
        { role: "proprietario", marker: false, real: true, transition: true },
      ]
    : []),
);
try {
  for (const scenario of scenarios.filter((item) =>
    process.env.NOX_TEST_TRANSITION_PROBE
      ? item.transition
      : !process.env.NOX_TEST_REAL_ONLY || item.real,
  )) {
    const context = await browser.newContext({ serviceWorkers: "block" });
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
    let effectiveReal = !!scenario.real;
    let fixtureUser = user;
    let fixtureRole = scenario.role;
    const jwt = [
      { alg: "HS256", typ: "JWT" },
      { sub: id, email: user.email, exp: Math.floor(Date.now() / 1000) + 3600 },
      "test",
    ]
      .map((x) => Buffer.from(typeof x === "string" ? x : JSON.stringify(x)).toString("base64url"))
      .join(".");
    await context.addInitScript(
      ({ scenario, user, jwt, mobile }) => {
        window.demoLinkAttempts = JSON.parse(
          sessionStorage.getItem("nox-test-popup-audit") || "[]",
        );
        if (scenario.consent) {
          const pixel = (...args) => pixel.queue.push(args);
          pixel.queue = [["consent", "revoke"]];
          window.fbq = pixel;
        }
        if (scenario.consent)
          window.dataLayer = [
            ["consent", "default", { ad_storage: "denied", analytics_storage: "denied" }],
          ];
        window.demoCspAttempts = JSON.parse(sessionStorage.getItem("nox-test-csp-audit") || "[]");
        document.addEventListener("securitypolicyviolation", (event) => {
          window.demoCspAttempts.push(event.blockedURI || event.violatedDirective);
          sessionStorage.setItem("nox-test-csp-audit", JSON.stringify(window.demoCspAttempts));
        });
        window.open = (...args) => {
          window.demoLinkAttempts.push(args[0]);
          sessionStorage.setItem("nox-test-popup-audit", JSON.stringify(window.demoLinkAttempts));
          return null;
        };
        if (!mobile && scenario.marker) sessionStorage.setItem("nox_demo_session", scenario.role);
        if (mobile)
          globalThis.__NOX_DEMO_TEST_BOOTSTRAP__ = {
            marker: scenario.marker,
            session: JSON.stringify({
              access_token: jwt,
              refresh_token: "test",
              expires_in: 3600,
              expires_at: Math.floor(Date.now() / 1000) + 3600,
              token_type: "bearer",
              user,
            }),
          };
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
        const transition = sessionStorage.getItem("nox-test-transition-session");
        if (transition) localStorage.setItem("sb-nox-demo-test-auth-token", transition);
      },
      { scenario, user, jwt, mobile },
    );
    const unexpected = [];
    context.on("page", (popup) => {
      unexpected.push("unexpected popup created");
      void popup.close();
    });
    const reads = [];
    const trackingRequests = [];
    await context.routeWebSocket("**/*", (socket) => {
      if (new URL(socket.url()).host === new URL(origin).host) {
        // Development sockets are not needed for these full-document tests.
        // Never connect even a local websocket to a server.
        if (!["/", "/hot"].includes(new URL(socket.url()).pathname))
          unexpected.push(`unexpected local websocket ${socket.url()}`);
        socket.close();
        return;
      }
      if (
        !effectiveReal ||
        new URL(socket.url()).hostname !== "nox-demo-test.supabase.co" ||
        new URL(socket.url()).pathname !== "/realtime/v1/websocket"
      )
        unexpected.push(`unexpected websocket ${socket.url()}`);
      socket.close();
    });
    await context.route("**/*", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (url.origin === origin) {
        if (!["GET", "HEAD"].includes(req.method())) {
          unexpected.push(`unexpected local mutation ${req.method()} ${url.pathname}`);
          return route.abort();
        }
        return route.continue();
      }
      if (
        !mobile &&
        effectiveReal &&
        req.method() === "GET" &&
        trackingScripts.includes(url.href)
      ) {
        trackingRequests.push(url.href);
        return route.fulfill({
          status: 200,
          contentType: "application/javascript",
          body: "/* intercepted vendor fixture: no external SDK execution */",
        });
      }
      if (url.hostname !== "nox-demo-test.supabase.co") {
        unexpected.push(`external ${req.method()} ${url.href}`);
        return route.abort();
      }
      if (
        !effectiveReal &&
        (!["/auth/v1/user", "/rest/v1/profiles", "/rest/v1/internal_users"].includes(
          url.pathname,
        ) ||
          req.method() !== "GET")
      ) {
        unexpected.push(`${req.method()} ${url.pathname}`);
        return route.abort();
      }
      const allowedRealReadRpc =
        req.method() === "POST" &&
        [
          "/rest/v1/rpc/get_my_owner_dashboard",
          "/rest/v1/rpc/get_visible_active_tenant_invoice_summaries",
        ].includes(url.pathname);
      if (
        effectiveReal &&
        !allowedRealReadRpc &&
        (req.method() !== "GET" ||
          !(url.pathname === "/auth/v1/user" || url.pathname.startsWith("/rest/v1/")))
      ) {
        unexpected.push(`unapproved fixture ${req.method()} ${url.href}`);
        return route.abort();
      }
      reads.push(url.pathname);
      let body = [];
      if (url.pathname === "/auth/v1/user") body = scenario.denied ? null : fixtureUser;
      else if (url.pathname === "/rest/v1/profiles")
        body = {
          id,
          email: fixtureUser.email,
          role: fixtureRole,
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
      if (!mobile && scenario.real) {
        await page.waitForFunction(() => !!window.fbq && !!window.gtag);
        assert.deepEqual([...new Set(trackingRequests)].sort(), [...trackingScripts].sort());
        if (scenario.consent) {
          const commands = await page.evaluate(() =>
            window.dataLayer.map((value) => Array.from(value)),
          );
          assert.deepEqual(
            await page.evaluate(() => window.fbq.queue.filter((value) => value[0] === "consent")),
            [["consent", "revoke"]],
          );
          assert.deepEqual(
            commands.filter((value) => value[0] === "consent"),
            [["consent", "default", { ad_storage: "denied", analytics_storage: "denied" }]],
          );
        }
      }
      if (process.env.NOX_TEST_EXTERNAL_PROBE === "http") {
        await page.evaluate(
          () =>
            new Promise((resolve) => {
              const probe = new Image();
              probe.onload = probe.onerror = resolve;
              probe.src = "https://unexpected.invalid/probe";
            }),
        );
      }
      if (mobile) {
        const actual = await page.evaluate(async () => {
          const bridge = globalThis.__NOX_DEMO_TEST_STORAGE__;
          if (!bridge)
            throw new Error(
              "Missing instrumented auth-storage; use build-demo-mobile-test-export.mjs",
            );
          return {
            active: bridge.isActive(),
            email: JSON.parse(await bridge.readSession())?.user?.email,
          };
        });
        assert.deepEqual(
          actual,
          { active: scenario.marker, email: user.email },
          "actual mobile storage marker and authenticated session",
        );
        console.log(`STORAGE active=${actual.active} email=${actual.email}`);
      }
      assert.deepEqual(await page.evaluate(() => window.demoLinkAttempts), []);
      assert.deepEqual(await page.evaluate(() => window.demoCspAttempts), []);
      assert.deepEqual(unexpected, []);
      if (scenario.transition) {
        const previousRequests = trackingRequests.length;
        // The SDK event is the boundary: requests started while still real are
        // not retroactively classified as demo. The policy never waits for UI.
        let transitionReadStart;
        await page.exposeBinding("__noxDemoSessionObserved", (_source, email) => {
          assert.equal(email, "inquilino@nox.com");
          effectiveReal = false;
          transitionReadStart = reads.length;
        });
        fixtureUser = { ...user, email: "inquilino@nox.com" };
        fixtureRole = "inquilino";
        const token = [
          { alg: "HS256", typ: "JWT" },
          { sub: id, email: fixtureUser.email, exp: Math.floor(Date.now() / 1000) + 3600 },
          "test",
        ]
          .map((value) =>
            Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString(
              "base64url",
            ),
          )
          .join(".");
        await page.evaluate(
          async ({ token, user, probe }) => {
            sessionStorage.setItem(
              "nox-test-transition-session",
              JSON.stringify({
                access_token: token,
                refresh_token: "test",
                expires_in: 3600,
                expires_at: Math.floor(Date.now() / 1000) + 3600,
                token_type: "bearer",
                user,
              }),
            );
            if (probe === "before-reload-popup")
              window.open("https://unexpected.invalid/before-reload");
            window.noxOldTrackingDocument = true;
            const { supabase } = await import("/src/integrations/supabase/client.ts");
            supabase.auth.onAuthStateChange((_event, session) => {
              if (session?.user.email === "inquilino@nox.com")
                return window.__noxDemoSessionObserved(session.user.email);
            });
            void supabase.auth.setSession({ access_token: token, refresh_token: "test" });
          },
          { token, user: fixtureUser, probe: process.env.NOX_TEST_TRANSITION_PROBE },
        );
        await page.getByText("Simulação completa", { exact: true }).waitFor({ timeout: 60000 });
        assert.equal(effectiveReal, false, "SDK demo session event must switch network policy");
        assert.equal(typeof transitionReadStart, "number");
        assert.equal(
          await page.evaluate(() => window.noxOldTrackingDocument),
          undefined,
          "demo must use a fresh document",
        );
        assert.equal(
          trackingRequests.length,
          previousRequests,
          "no tracking after switching to demo",
        );
        assert.equal(
          await page
            .locator('script[src*="googletagmanager"],script[src*="connect.facebook"]')
            .count(),
          0,
        );
        for (const name of [
          "Simular análise",
          "Simular conferência",
          "Simular ativação sem assinatura",
          "Simular pagamento",
        ]) {
          await page.getByRole("button", { name, exact: true }).click();
        }
        await page.getByText("Recibo demonstrativo", { exact: true }).waitFor();
        if (process.env.NOX_TEST_TRANSITION_PROBE) {
          await page.evaluate(async (probe) => {
            if (probe === "local-mutation")
              await fetch("/must-not-run", { method: "POST" }).catch(() => {});
            if (probe === "local-websocket")
              await new Promise((resolve) => {
                const socket = new WebSocket(
                  window.location.origin.replace("http:", "ws:") + "/forbidden-socket",
                );
                socket.onclose = socket.onerror = resolve;
              });
            if (probe === "rest")
              await fetch("https://nox-demo-test.supabase.co/rest/v1/faturas_inquilino").catch(
                () => {},
              );
            if (probe === "rpc")
              await fetch("https://nox-demo-test.supabase.co/rest/v1/rpc/get_my_owner_dashboard", {
                method: "POST",
              }).catch(() => {});
            if (probe === "realtime")
              await new Promise((resolve) => {
                const socket = new WebSocket(
                  "wss://nox-demo-test.supabase.co/realtime/v1/websocket",
                );
                socket.onclose = socket.onerror = resolve;
              });
            if (probe === "popup") window.open("https://unexpected.invalid/popup");
            if (probe === "tracking")
              await new Promise((resolve) => {
                const script = document.createElement("script");
                script.onload = script.onerror = resolve;
                script.src = "https://connect.facebook.net/en_US/fbevents.js";
                document.head.appendChild(script);
              });
            if (probe === "csp")
              await new Promise((resolve) => {
                document.addEventListener("securitypolicyviolation", resolve, { once: true });
                const script = document.createElement("script");
                script.src = "https://unexpected.invalid/csp-script";
                document.head.appendChild(script);
              });
          }, process.env.NOX_TEST_TRANSITION_PROBE);
        }
        // These audits survive reload: a forbidden operation in either document fails.
        assert.deepEqual(
          await page.evaluate(() => window.demoLinkAttempts),
          [],
          "no popups across transition",
        );
        assert.deepEqual(
          await page.evaluate(() => window.demoCspAttempts),
          [],
          "no CSP violations across transition",
        );
        assert.deepEqual(unexpected, [], "demo network policy active throughout transition");
        assert.ok(
          reads
            .slice(transitionReadStart)
            .every((path) =>
              ["/auth/v1/user", "/rest/v1/profiles", "/rest/v1/internal_users"].includes(path),
            ),
          "only identity reads after transition starts",
        );
        console.log(
          "PASS real-to-demo SDK transition: demo network policy, persistent CSP/popup audit",
        );
      }
      console.log(`PASS ${mobile ? "mobile" : "web"} ${JSON.stringify(scenario)} ${path}`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
