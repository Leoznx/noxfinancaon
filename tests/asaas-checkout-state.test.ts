import assert from "node:assert/strict";
import test from "node:test";

import {
  cardRegistrationStatusLabel,
  checkoutActionsForMethod,
  hasIncompleteInstallmentPlan,
  paymentLink,
  policyStatusLabel,
  shouldCollectCardData,
  signatureStatusLabel,
  type NormalizedAsaasPayment,
} from "../src/lib/asaas-payment";

test("Pix e boleto oferecem pagar agora e pagar depois", () => {
  assert.deepEqual(checkoutActionsForMethod("pix"), {
    canPayNow: true,
    canPayLater: true,
  });
  assert.deepEqual(checkoutActionsForMethod("boleto"), {
    canPayNow: true,
    canPayLater: true,
  });
});

test("cartão nunca expõe pagar depois e exige escolha de cadastro", () => {
  assert.deepEqual(checkoutActionsForMethod("credit_card"), {
    canPayNow: true,
    canPayLater: false,
  });
  assert.equal(shouldCollectCardData(null), false);
  assert.equal(shouldCollectCardData("checkout"), false);
  assert.equal(shouldCollectCardData("direct"), true);
});

test("link persistido prioriza invoiceUrl sem perder boleto legado", () => {
  const base: NormalizedAsaasPayment = {
    success: true,
    paymentId: "pay_1",
    externalReference: "nox:1",
    status: "pending",
    paymentMethod: "boleto",
    amount: 377.5,
    dueDate: "2026-10-16",
    pix: null,
    boleto: {
      barcode: "123",
      pdfUrl: "https://legacy.example/boleto",
      dueDate: "2026-10-16",
    },
  };
  assert.equal(paymentLink(base), "https://legacy.example/boleto");
  assert.equal(
    paymentLink({ ...base, invoiceUrl: "https://asaas.example/invoice" }),
    "https://asaas.example/invoice",
  );
});

test("estados de apólice, assinatura e cadastro de cartão permanecem separados", () => {
  assert.equal(policyStatusLabel("issued_pending"), "Emitida, aguardando requisitos");
  assert.equal(signatureStatusLabel("signed"), "Assinada");
  assert.equal(cardRegistrationStatusLabel("awaiting_card"), "Aguardando cadastro do cartão");
});

test("retomada identifica apenas cronograma futuro incompleto sem recriar a inicial", () => {
  const initial = {
    id: "invoice-1",
    billing_key: "contract:initial:1",
    charge_kind: "initial",
    installment_total: 3,
    payment_method: "pix",
  };
  assert.equal(hasIncompleteInstallmentPlan([initial]), true);
  assert.equal(
    hasIncompleteInstallmentPlan([
      initial,
      { id: "invoice-2", billing_key: "contract:monthly:2", charge_kind: "monthly" },
      { id: "invoice-3", billing_key: "contract:monthly:3", charge_kind: "monthly" },
    ]),
    false,
  );
  assert.equal(
    hasIncompleteInstallmentPlan([{ ...initial, payment_method: "credit_card" }]),
    false,
  );
});
