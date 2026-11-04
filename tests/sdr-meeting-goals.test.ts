import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261104220000_sdr_meeting_goals_by_scheduled_date.sql",
    import.meta.url,
  ),
  "utf8",
);

test("reunioes do SDR contam pela data marcada, e nao pela criacao", () => {
  const helper = migration.match(
    /CREATE OR REPLACE FUNCTION public\.count_sdr_goal_meetings[\s\S]*?\$\$;/,
  )?.[0];
  assert.ok(helper, "a migration deve centralizar a contagem das reunioes do SDR");
  assert.match(helper, /appointment\.scheduled_at >= p_period_start/);
  assert.match(helper, /appointment\.scheduled_at < p_period_end/);
  assert.match(helper, /appointment\.status <> 'cancelado'/);
  assert.doesNotMatch(helper, /appointment\.created_at/);
});

test("a mesma contagem alimenta metas pessoais, administrativas e TV", () => {
  assert.match(migration, /FUNCTION public\.get_my_seller_goal_progress\(\)/);
  assert.match(migration, /FUNCTION public\.get_seller_team_goal_progress/);
  assert.match(migration, /FUNCTION public\.get_tv_display_goal_progress/);
  assert.match(migration, /FUNCTION public\.get_admin_goal_daily_notice\(\)/);

  const helperCalls = migration.match(/public\.count_sdr_goal_meetings\(/g) ?? [];
  assert.ok(helperCalls.length >= 8, "todos os periodos e avisos devem usar a fonte unica");
  assert.match(
    migration,
    /WHEN coalesce\(seller\.seller_type, 'sdr'\) = 'sdr'[\s\S]*?THEN public\.count_sdr_goal_meetings/,
  );
});

test("as reunioes concluidas do Closer continuam usando completed_at", () => {
  assert.match(migration, /appointment\.status = 'concluido'/);
  assert.match(migration, /appointment\.completed_at >= v_day_start/);
  assert.match(migration, /appointment\.completed_at < v_day_end/);
});
