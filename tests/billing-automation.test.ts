import assert from "node:assert/strict";
import test from "node:test";

import {
  asaasLateFeePayload,
  buildCollectionMessage,
  collectionCadence,
  monthlyDueDate,
  nextMonthlyDueDate,
  notificationKey,
} from "../supabase/functions/_shared/billing-automation.ts";
import {
  parseWhatsappBillingCommand,
  receivedWhatsappText,
  selectWhatsappBillingCandidate,
} from "../supabase/functions/_shared/whatsapp-billing.ts";

test("novas mensalidades vencem no dia 10 do mês seguinte", () => {
  assert.equal(nextMonthlyDueDate(new Date("2026-08-10T15:00:00Z")), "2026-09-10");
  assert.equal(monthlyDueDate(2027, 1), "2027-01-10");
});

test("lembrete é planejado exatamente um dia antes, inclusive no fim de semana", () => {
  const cadence = collectionCadence({
    dueDate: "2026-08-10",
    now: new Date("2026-08-09T12:00:00Z"), // 09:00 em São Paulo
  });
  assert.deepEqual(cadence, { kind: "pre_due", slot: 1, overdueDays: -1 });
});

test("primeira semana possui duas janelas comerciais idempotentes", () => {
  const morning = collectionCadence({
    dueDate: "2026-08-10",
    now: new Date("2026-08-11T12:00:00Z"),
  });
  const afternoon = collectionCadence({
    dueDate: "2026-08-10",
    now: new Date("2026-08-11T17:00:00Z"),
  });
  const outside = collectionCadence({
    dueDate: "2026-08-10",
    now: new Date("2026-08-11T15:00:00Z"),
  });
  assert.equal(morning?.slot, 1);
  assert.equal(afternoon?.slot, 2);
  assert.equal(outside, null);
  assert.equal(notificationKey(morning!, "2026-08-11"), "overdue_week_1:2026-08-11:slot_1");
});

test("segunda semana possui quatro janelas e para após o 14º dia", () => {
  const hours = [12, 14, 17, 20]; // UTC = 09, 11, 14, 17 São Paulo
  assert.deepEqual(
    hours.map(
      (hour) =>
        collectionCadence({
          dueDate: "2026-08-10",
          now: new Date(`2026-08-18T${hour}:00:00Z`),
        })?.slot,
    ),
    [1, 2, 3, 4],
  );
  assert.equal(
    collectionCadence({ dueDate: "2026-08-10", now: new Date("2026-08-25T12:00:00Z") }),
    null,
  );
});

test("payload usa multa de 2% e juros de 1% ao mês", () => {
  assert.deepEqual(asaasLateFeePayload(), { interest: { value: 1 }, fine: { value: 2 } });
});

test("mensagem consolidada é clara e orienta a segunda via", () => {
  const cadence = collectionCadence({
    dueDate: "2026-08-10",
    now: new Date("2026-08-18T12:00:00Z"),
  });
  const message = buildCollectionMessage({
    name: "Cliente",
    amount: 450,
    dueDate: "2026-08-10",
    cadence: cadence!,
    consolidated: true,
    invoiceCount: 3,
  });
  assert.match(message, /3 contratos ativos/);
  assert.match(message, /boleto atualizado/);
  assert.match(message, /Pix/);
});

test("autoatendimento reconhece boleto, segunda via e Pix sem confundir texto comum", () => {
  assert.equal(parseWhatsappBillingCommand("Quero a 2ª via do boleto"), "boleto");
  assert.equal(parseWhatsappBillingCommand("pode gerar PIX atualizado?"), "pix");
  assert.equal(parseWhatsappBillingCommand("Bom dia, preciso de ajuda"), null);
  assert.equal(receivedWhatsappText({ text: { message: "boleto" } }), "boleto");
});

test("autoatendimento prefere lote consolidado e bloqueia telefone ambíguo", () => {
  const selected = selectWhatsappBillingCandidate([
    { actorId: "a", invoiceId: "invoice", dueDate: "2026-08-10" },
    { actorId: "a", batchId: "batch", dueDate: "2026-09-10" },
  ]);
  assert.equal(selected.candidate?.batchId, "batch");
  assert.equal(
    selectWhatsappBillingCandidate([
      { actorId: "a", invoiceId: "one", dueDate: "2026-08-10" },
      { actorId: "b", invoiceId: "two", dueDate: "2026-08-10" },
    ]).reason,
    "ambiguous_phone",
  );
});
