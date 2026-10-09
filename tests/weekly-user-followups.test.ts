import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildWeeklyFollowupInteractiveContent,
  buildWeeklyFollowupMessage,
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
    assert.match(message, /^Olá, Leonardo!/);
    assert.match(message, /simula/i);
    assert.match(message, /[😊💛👋🚀😄🤝]/u);
    assert.doesNotMatch(message, /E aí|responda SAIR/i);
  }
});

test("monta CTA interativo com acesso ao site e simulacao", () => {
  const content = buildWeeklyFollowupInteractiveContent({ name: "Leo", variant: 0 });
  assert.equal(content.title, "NOX Fiança • Acompanhamento semanal");
  assert.equal("footer" in content, false);
  assert.deepEqual(
    content.buttonActions.map((button) => [button.type, button.label, button.url]),
    [
      ["URL", "Acessar o site", WEEKLY_FOLLOWUP_SITE_URL],
      ["URL", "Fazer simulação", WEEKLY_FOLLOWUP_SIMULATION_URL],
    ],
  );
});

test("usa somente o primeiro nome cadastrado e troca a mensagem entre variantes", () => {
  const first = buildWeeklyFollowupMessage({ name: "LEONARDO Silva", variant: 0 });
  const second = buildWeeklyFollowupMessage({ name: "Leonardo Silva", variant: 1 });
  assert.match(first, /^Olá, Leonardo!/);
  assert.match(second, /^Olá, Leonardo!/);
  assert.doesNotMatch(first, /Silva/);
  assert.doesNotMatch(second, /Silva/);
  assert.notEqual(first, second);
});

test("restringe o envio a dias úteis entre 09:00 e 17:59 em São Paulo", () => {
  assert.equal(saoPauloBusinessClock(new Date("2026-10-05T12:00:00Z")).insideBusinessWindow, true);
  assert.equal(saoPauloBusinessClock(new Date("2026-10-05T20:59:00Z")).insideBusinessWindow, true);
  assert.equal(saoPauloBusinessClock(new Date("2026-10-05T21:00:00Z")).insideBusinessWindow, false);
  assert.equal(saoPauloBusinessClock(new Date("2026-10-10T15:00:00Z")).insideBusinessWindow, false);
});

test("webhook não interpreta comandos de saída ou reativação", () => {
  const webhook = readFileSync(
    new URL("../supabase/functions/zapi-webhook/index.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(webhook, /parseWeeklyFollowupPreference/);
  assert.doesNotMatch(webhook, /handleWeeklyFollowupPreference/);
  assert.doesNotMatch(webhook, /weekly_whatsapp_followup_opt_outs/);
  assert.doesNotMatch(webhook, /responda VOLTAR/);
});

test("bloqueia o antigo disparo manual para número de teste", () => {
  const processor = readFileSync(
    new URL("../supabase/functions/process-weekly-user-followups/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(processor, /test_dispatch_disabled/);
  assert.doesNotMatch(processor, /is_test:\s*true/);
  assert.doesNotMatch(processor, /sendZApiButtonActions\(\{\s*to:\s*testPhone/);
});

test("não reenvia quando a resposta do provedor deixa a entrega incerta", () => {
  const zapi = readFileSync(
    new URL("../supabase/functions/_shared/zapi.ts", import.meta.url),
    "utf8",
  );
  const buttonSender = zapi.slice(zapi.indexOf("export async function sendZApiButtonActions"));
  const processor = readFileSync(
    new URL("../supabase/functions/process-weekly-user-followups/index.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(buttonSender, /sendZApiText\(/);
  assert.match(buttonSender, /deliveryUncertain:\s*true/);
  assert.match(processor, /delivery_uncertain_not_retried/);
});
