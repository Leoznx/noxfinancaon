import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWeeklyFollowupMessage,
  parseWeeklyFollowupPreference,
  saoPauloBusinessClock,
  WEEKLY_FOLLOWUP_MESSAGES,
} from "../supabase/functions/_shared/weekly-user-followups";

test("mantém oito mensagens emocionais diferentes com emoji", () => {
  assert.equal(WEEKLY_FOLLOWUP_MESSAGES.length, 8);
  assert.equal(new Set(WEEKLY_FOLLOWUP_MESSAGES).size, 8);
  for (let variant = 0; variant < WEEKLY_FOLLOWUP_MESSAGES.length; variant += 1) {
    const message = buildWeeklyFollowupMessage({ name: "Leonardo Silva", variant });
    assert.match(message, /Leonardo/);
    assert.match(message, /simula/i);
    assert.match(message, /[😊💛👋🚀😄🤝]/u);
    assert.match(message, /responda SAIR/);
  }
});

test("interpreta saída e reativação sem depender de acento ou pontuação", () => {
  assert.equal(parseWeeklyFollowupPreference("SAIR"), "opt_out");
  assert.equal(parseWeeklyFollowupPreference("Parar!"), "opt_out");
  assert.equal(parseWeeklyFollowupPreference("VOLTAR"), "opt_in");
  assert.equal(parseWeeklyFollowupPreference("quero receber"), null);
  assert.equal(parseWeeklyFollowupPreference("boleto"), null);
});

test("restringe o envio a dias úteis entre 09:00 e 17:59 em São Paulo", () => {
  assert.equal(saoPauloBusinessClock(new Date("2026-10-05T12:00:00Z")).insideBusinessWindow, true);
  assert.equal(saoPauloBusinessClock(new Date("2026-10-05T20:59:00Z")).insideBusinessWindow, true);
  assert.equal(saoPauloBusinessClock(new Date("2026-10-05T21:00:00Z")).insideBusinessWindow, false);
  assert.equal(saoPauloBusinessClock(new Date("2026-10-10T15:00:00Z")).insideBusinessWindow, false);
});
