import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261031070000_tv_registration_celebrations.sql",
    import.meta.url,
  ),
  "utf8",
);
const tvRoute = readFileSync(new URL("../src/routes/tv.ranking.tsx", import.meta.url), "utf8");

test("RPC da comemoração é restrita e retorna nome e avatar do vendedor", () => {
  assert.match(migration, /get_tv_registration_celebration/);
  assert.match(migration, /public\.is_admin\(auth\.uid\(\)\)/);
  assert.match(migration, /seller\.full_name/);
  assert.match(migration, /profile\.avatar_url/);
  assert.match(migration, /GRANT EXECUTE[\s\S]*TO authenticated/);
  assert.doesNotMatch(migration, /GRANT EXECUTE[\s\S]*TO anon/);
});

test("painel escuta cadastros em tempo real e celebra durante 15 segundos", () => {
  assert.match(tvRoute, /REGISTRATION_CELEBRATION_MS = 15_000/);
  assert.match(tvRoute, /table: "seller_signup_attributions"/);
  assert.match(tvRoute, /playRegistrationBell\(\)/);
  assert.match(tvRoute, /Foto de \$\{celebration\.sellerName\}/);
});
