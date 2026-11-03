import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20261103120000_agency_registered_broker_consultations.sql",
  import.meta.url,
);
const webLoaderUrl = new URL("../src/lib/dashboard-navigation-data.ts", import.meta.url);
const agencyScopeUrl = new URL("../src/lib/agency-scope.ts", import.meta.url);

test("autoriza somente consultas dos corretores cadastrados na imobiliaria logada", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(migration, /broker\.profile_id = p_profile_id_solicitante/);
  assert.match(
    migration,
    /broker\.imobiliaria_id = public\.current_imobiliaria_id\(\)/,
  );
  assert.doesNotMatch(migration, /broker[\s\S]*contato_email\s*=/);
  assert.match(migration, /REVOKE ALL[\s\S]*FROM PUBLIC, anon/);
});

test("a listagem web aplica os ids da imobiliaria e dos corretores vinculados", async () => {
  const loader = await readFile(webLoaderUrl, "utf8");

  assert.match(loader, /const scope = await loadAgencyScope\(user\)/);
  assert.match(
    loader,
    /query = query\.in\("profile_id_solicitante", scope\.profileIds\)/,
  );
});

test("o escopo da imobiliaria resolve corretores pela RPC autorizada", async () => {
  const agencyScope = await readFile(agencyScopeUrl, "utf8");

  assert.match(
    agencyScope,
    /supabase\.rpc\("current_agency_broker_profile_ids"\)/,
  );
  assert.doesNotMatch(agencyScope, /\.from\("corretores"\)/);
  assert.match(
    agencyScope,
    /if \(brokerProfilesResult\.error\) throw brokerProfilesResult\.error/,
  );
});
