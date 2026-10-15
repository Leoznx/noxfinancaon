import assert from "node:assert/strict";
import test from "node:test";

import { applySecurityHeaders } from "../src/lib/security-headers.ts";

test("adiciona cabeçalhos de defesa e bloqueia cache em áreas privadas", () => {
  const response = applySecurityHeaders(
    new Request("https://noxfianca.com/admin/conta-nox"),
    new Response("ok"),
  );
  const contentSecurityPolicy = response.headers.get("content-security-policy") || "";
  assert.match(contentSecurityPolicy, /frame-ancestors 'none'/);
  assert.match(contentSecurityPolicy, /https:\/\/servicodados\.ibge\.gov\.br/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("cache-control") || "", /no-store/);
});

test("mantém respostas públicas não HTML elegíveis para cache sem remover as proteções", () => {
  const response = applySecurityHeaders(
    new Request("https://noxfianca.com/api/publica"),
    new Response("ok"),
  );
  assert.equal(response.headers.get("cache-control"), null);
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
});

test("obriga a revalidação do HTML público entre deploys", () => {
  const response = applySecurityHeaders(
    new Request("https://noxfianca.com/"),
    new Response("<html></html>", { headers: { "Content-Type": "text/html; charset=utf-8" } }),
  );

  assert.equal(response.headers.get("Cache-Control"), "no-cache, max-age=0, must-revalidate");
});

test("mantém páginas privadas sem cache", () => {
  const response = applySecurityHeaders(
    new Request("https://noxfianca.com/dashboard"),
    new Response("<html></html>", { headers: { "Content-Type": "text/html; charset=utf-8" } }),
  );

  assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("Pragma"), "no-cache");
});

test("não altera a política de cache de assets versionados", () => {
  const response = applySecurityHeaders(
    new Request("https://noxfianca.com/assets/app-A1B2.js"),
    new Response("export {}", {
      headers: {
        "Content-Type": "text/javascript",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    }),
  );

  assert.equal(response.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
});
