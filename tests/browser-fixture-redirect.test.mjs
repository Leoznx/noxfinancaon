import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { serveFixtureResponse } from "../scripts/demo-browser-fixture-response.mjs";
const listen = (server) =>
  new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)),
  );
const close = (server) => new Promise((resolve) => server.close(resolve));
test("fixture fetch never follows redirect/refresh to a same-origin or cross-origin canary", async (t) => {
  let sinkHits = 0,
    secondHopHits = 0;
  const sink = createServer((_req, res) => {
    sinkHits++;
    res.end("MUST NOT BE REACHED");
  });
  const sinkOrigin = await listen(sink);
  const fixture = createServer((req, res) => {
    const url = new URL(req.url, "http://fixture.invalid");
    if (url.pathname === "/second-hop") {
      secondHopHits++;
      res.writeHead(302, { location: sinkOrigin + "/sink" });
      return res.end();
    }
    if (url.pathname === "/sink") {
      sinkHits++;
      return res.end("MUST NOT BE REACHED");
    }
    if (url.pathname === "/redirect") {
      const target =
        url.searchParams.get("target") === "same"
          ? "/sink"
          : url.searchParams.get("target") === "chain"
            ? "/second-hop"
            : sinkOrigin + "/sink";
      const status = Number(url.searchParams.get("status"));
      res.writeHead(
        status,
        url.searchParams.has("refresh") ? { refresh: `0; url=${target}` } : { location: target },
      );
      return res.end();
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><title>Controlled fixture</title>");
  });
  const origin = await listen(fixture);
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    for (const item of [
      ...[301, 302, 303, 307, 308].map((status) => ({ status, target: "cross" })),
      { status: 302, target: "same" },
      { status: 302, target: "chain" },
      { status: 200, target: "cross", refresh: true },
      { status: 200, target: "cross" },
    ].flatMap((item) => ["GET", "HEAD"].map((method) => ({ ...item, method }))))
      await t.test(JSON.stringify(item), async () => {
        const context = await browser.newContext({ serviceWorkers: "block" });
        const violations = [];
        await context.route("**/*", (route) => serveFixtureResponse(route, origin, violations));
        const page = await context.newPage();
        const path =
          "/redirect?" +
          new URLSearchParams(Object.entries(item).map(([key, value]) => [key, String(value)]));
        if (item.method === "GET") {
          await assert.rejects(() => page.goto(origin + path, { waitUntil: "domcontentloaded" }));
        } else {
          await page.goto(origin);
          assert.equal(
            await page.evaluate(async (path) => {
              try {
                await fetch(path, { method: "HEAD" });
                return false;
              } catch {
                return true;
              }
            }, path),
            true,
            "HEAD redirect must be rejected",
          );
        }
        assert.ok(
          violations.some((value) => value.startsWith("blocked fixture redirect")),
          JSON.stringify(violations),
        );
        assert.equal(
          sinkHits,
          0,
          "redirect target must receive ZERO requests, including bypasses of page routing",
        );
        assert.equal(secondHopHits, 0, "redirect chain must stop before its second hop");
        await context.close();
      });
    await t.test("ordinary local response remains readable", async () => {
      const context = await browser.newContext();
      const violations = [];
      await context.route("**/*", (route) => serveFixtureResponse(route, origin, violations));
      const page = await context.newPage();
      await page.goto(origin);
      assert.equal(await page.title(), "Controlled fixture");
      assert.deepEqual(violations, []);
      await context.close();
    });
  } finally {
    await browser.close();
    await close(fixture);
    await close(sink);
  }
});
