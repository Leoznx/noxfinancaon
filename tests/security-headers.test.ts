import assert from "node:assert/strict";
import test from "node:test";
import { applySecurityHeaders } from "../src/lib/security-headers";

test("adiciona cabeçalhos de defesa e bloqueia cache em áreas privadas", () => {
  const response = applySecurityHeaders(
    new Request("https://noxfianca.com/admin/conta-nox"),
    new Response("ok"),
  );
  assert.match(response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("cache-control") || "", /no-store/);
});

test("mantém páginas públicas elegíveis para cache sem remover as proteções", () => {
  const response = applySecurityHeaders(new Request("https://noxfianca.com/"), new Response("ok"));
  assert.equal(response.headers.get("cache-control"), null);
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
});
