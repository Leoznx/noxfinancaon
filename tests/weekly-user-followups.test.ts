import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildWeeklyFollowupInteractiveContent,
  buildWeeklyFollowupMessage,
  parseWeeklyFollowupPreference,
  saoPauloBusinessClock,
  WEEKLY_FOLLOWUP_MESSAGES,
  WEEKLY_FOLLOWUP_SIMULATION_URL,
  WEEKLY_FOLLOWUP_SITE_URL,
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

test("monta CTA interativo com acesso ao site e simulacao", () => {
  const content = buildWeeklyFollowupInteractiveContent({ name: "Leo", variant: 0 });
  assert.equal(content.title, "NOX Fiança • acompanhamento semanal");
  assert.equal(content.footer.includes("SAIR"), true);
  assert.deepEqual(
    content.buttonActions.map((button) => [button.type, button.label, button.url]),
    [
      ["URL", "Acessar o site", WEEKLY_FOLLOWUP_SITE_URL],
      ["URL", "Fazer simulação", WEEKLY_FOLLOWUP_SIMULATION_URL],
    ],
  );
});

test("mantém o nome cadastrado no login e troca a mensagem entre variantes", () => {
  const first = buildWeeklyFollowupMessage({ name: "Leonardo Silva", variant: 0 });
  const second = buildWeeklyFollowupMessage({ name: "Leonardo Silva", variant: 1 });
  assert.match(first, /Leonardo Silva/);
  assert.match(second, /Leonardo Silva/);
  assert.notEqual(first, second);
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

test("bloqueia o antigo disparo manual para número de teste", () => {
  const processor = readFileSync(
    new URL(
      "../supabase/functions/process-weekly-user-followups/index.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(processor, /test_dispatch_disabled/);
  assert.doesNotMatch(processor, /is_test:\s*true/);
  assert.doesNotMatch(processor, /sendZApiButtonActions\(\{\s*to:\s*testPhone/);
});
