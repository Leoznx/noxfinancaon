import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261022190000_restore_shared_team_goal_targets.sql",
    import.meta.url,
  ),
  "utf8",
);

test("RPCs detalhados usam as metas compartilhadas de SDR e Closer", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_my_seller_goal_progress\(\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_seller_team_goal_progress\(/);
  assert.equal(
    (migration.match(/LEFT JOIN public\.seller_team_goals AS team_goal/g) ?? []).length,
    2,
  );
  assert.doesNotMatch(migration, /LEFT JOIN public\.seller_goals/);
});

test("cada perfil recebe a meta de reunião no campo esperado pelo cliente", () => {
  for (const period of ["daily", "weekly", "monthly"]) {
    assert.match(
      migration,
      new RegExp(`CASE WHEN v_seller_type = 'sdr' THEN team_goal\\.target_meetings_${period} END`),
    );
    assert.match(
      migration,
      new RegExp(
        `CASE WHEN v_seller_type = 'closer' THEN team_goal\\.target_meetings_${period} END`,
      ),
    );
  }
});

test("preserva o crédito da reunião concluída para Closer e SDR", () => {
  assert.match(
    migration,
    /coalesce\(appointment\.assigned_closer_id, appointment\.seller_id\) = v_seller_id\s+OR appointment\.sdr_id = v_seller_id/,
  );
  assert.match(migration, /appointment\.status = 'concluido'/);
  assert.match(migration, /appointment\.completed_at >= v_week_start/);
});
