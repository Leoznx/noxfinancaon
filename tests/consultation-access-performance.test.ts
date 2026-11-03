import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20261103170000_optimize_consultation_access.sql",
  import.meta.url,
);

test("calcula o contexto autenticado uma unica vez nas policies de consultas", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(migration, /profile_id_solicitante = \(SELECT auth\.uid\(\)\)/);
  assert.match(migration, /SELECT public\.current_agency_broker_profile_ids\(\)/);
  assert.match(migration, /tenant_email = \(SELECT public\.current_authenticated_email\(\)\)/);
  assert.match(migration, /OR \(SELECT public\.eh_staff_interno_consultas\(\)\)/);
  assert.doesNotMatch(
    migration,
    /public\.eh_dono_ou_imobiliaria_da_consulta\(profile_id_solicitante\)/,
  );
});

test("mantem helpers de escopo protegidos e indices para agencia", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(migration, /imobiliarias_contato_email_lower_idx/);
  assert.match(migration, /corretores_imobiliaria_profile_idx/);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.current_authenticated_email\(\)[\s\S]*FROM PUBLIC, anon/,
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.current_agency_broker_profile_ids\(\)[\s\S]*FROM PUBLIC, anon/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.current_agency_broker_profile_ids\(\)[\s\S]*TO authenticated, service_role/,
  );
});
