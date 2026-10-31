import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261031050000_automatic_monthly_goals_and_daily_notices.sql",
    import.meta.url,
  ),
  "utf8",
);

test("a virada mensal soma dois e nunca sobrescreve uma competencia existente", () => {
  assert.match(migration, /target_meetings_daily \+ 2/);
  assert.match(migration, /target_clients_monthly \+ 2/);
  assert.match(migration, /target_leads_contacted_daily \+ 2/);
  assert.match(migration, /ON CONFLICT \(seller_type, month, year\) DO NOTHING/);
  assert.match(migration, /generation_mode[\s\S]*'automatic'/);
});

test("as leituras restauram o resultado diario de leads em contato", () => {
  assert.match(migration, /target_leads_contacted_daily integer/);
  assert.match(migration, /leads_contacted_daily bigint/);
  assert.match(migration, /event\.event_type = 'lead_contacted'/);
  assert.match(migration, /get_seller_team_goal_configs/);
});

test("o aviso e unico, respeita dia util e as duas janelas solicitadas", () => {
  assert.match(migration, /UNIQUE \(recipient_user_id, notice_date\)/);
  assert.match(migration, /extract\(isodow FROM v_today\) > 5/);
  assert.match(migration, /is_seller_business_holiday\(v_today\)/);
  assert.match(migration, /CASE WHEN random\(\) < 0\.5 THEN 10 ELSE 15 END/);
  assert.match(migration, /delivered_at IS NOT NULL/);
});
