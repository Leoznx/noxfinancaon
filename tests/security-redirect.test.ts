import assert from "node:assert/strict";
import test from "node:test";
import { safeInternalRedirect } from "../src/lib/safe-redirect";

test("aceita somente destinos internos normais", () => {
  assert.equal(
    safeInternalRedirect("/consultas/123?tab=docs#top", "/dashboard"),
    "/consultas/123?tab=docs#top",
  );
});

test("bloqueia redirecionamentos externos, codificados e rotas de autenticação", () => {
  for (const value of [
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/%2f%2fevil.example",
    "/login?next=/x",
  ]) {
    assert.equal(safeInternalRedirect(value, "/dashboard"), "/dashboard");
  }
});
