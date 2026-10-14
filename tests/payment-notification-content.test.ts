import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildPaymentRequestEmailContent,
  buildPaymentRequestWhatsappContent,
  paymentNotificationActions,
} from "../supabase/functions/_shared/payment-notification-content";

const base = {
  name: "ANA BEATRIZ BENVENUTTI",
  amount: 377.5,
  dueDate: "2026-10-19",
  contractRef: "EFC43FA4",
  paymentUrl: "https://www.asaas.com/i/seguro",
};

test("Pix, boleto e cartão geram uma mensagem curta com botão Pagar", () => {
  for (const method of ["pix", "boleto", "credit_card"] as const) {
    const content = buildPaymentRequestWhatsappContent({ ...base, method });
    assert.match(content.message, /^Olá, Ana! 👋/);
    assert.match(content.message, /R\$ 377,50/);
    assert.match(content.message, /19\/10\/2026/);
    assert.match(content.message, /EFC43FA4/);
    assert.doesNotMatch(content.message, /https?:\/\//);
    assert.equal(content.message.length < 320, true);
    assert.deepEqual(content.buttonActions, [
      {
        id: "pagar-nox",
        type: "URL",
        label: "Pagar",
        url: "https://www.asaas.com/i/seguro",
      },
    ]);
  }
});

test("cartão remoto mantém os dois passos técnicos em uma única mensagem", () => {
  const content = buildPaymentRequestWhatsappContent({
    ...base,
    method: "credit_card",
    secondaryPaymentUrl: "https://www.asaas.com/checkout/recorrencia",
  });
  assert.match(content.message, /Pague o valor inicial e ative as mensalidades/);
  assert.equal(content.buttonActions.length, 2);
  assert.deepEqual(
    content.buttonActions.map((action) => action.label),
    ["Pagar", "Ativar mensalidades"],
  );
});

test("e-mail traz resumo visual e CTA sem expor URL no texto", () => {
  const content = buildPaymentRequestEmailContent({ ...base, method: "pix" });
  assert.equal(content.subject, "Pagamento disponível — NOX Fiança");
  assert.match(content.html, /Ir para pagamento/);
  assert.match(content.html, /https:\/\/www\.asaas\.com\/i\/seguro/);
  assert.match(content.html, /Forma de pagamento/);
  assert.match(content.html, /Pix/);
});

test("descarta links inseguros dos botões", () => {
  assert.deepEqual(paymentNotificationActions({ paymentUrl: "javascript:alert(1)" }), []);
  assert.deepEqual(paymentNotificationActions({ paymentUrl: "http://www.asaas.com/i/teste" }), []);
});

test("cronograma não dispara uma segunda mensagem ou um segundo e-mail", () => {
  const installmentPlan = readFileSync(
    new URL("../supabase/functions/asaas-create-installment-plan/index.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(installmentPlan, /billing_schedule_created/);
  assert.doesNotMatch(installmentPlan, /sendInstallmentScheduleEmail/);
  assert.doesNotMatch(installmentPlan, /cronograma da NOX/i);
});

test("checkout remoto do cartão consolida os dois passos em um único envio", () => {
  const subscription = readFileSync(
    new URL("../supabase/functions/asaas-create-subscription/index.ts", import.meta.url),
    "utf8",
  );
  const start = subscription.lastIndexOf("const notificationPlan =");
  const end = subscription.indexOf("const recurringReady", start);
  const dispatch = subscription.slice(start, end);
  assert.match(dispatch, /secondaryPaymentUrl/);
  assert.match(dispatch, /Ativar mensalidades/);
  assert.doesNotMatch(dispatch, /for \(const notification of notificationPlan\)/);
});
