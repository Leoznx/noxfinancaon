import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBillingKey,
  buildBillingSchedule,
  buildSubscriptionNotificationPlan,
  billingDueDateError,
  calculateBillingAmounts,
  checkoutStatusFromEvent,
  contractActivationDecision,
  hasDirectBillingOwnership,
  planInitialBilling,
  reduceCheckoutStatus,
  reduceConsolidatedBatchStatus,
  reducePaymentStatus,
  reduceSubscriptionStatus,
  shouldAttemptNotification,
  shouldReconcileBillingOperation,
  subscriptionStatusFromEvent,
  webhookEventCanBeClaimed,
} from "../supabase/functions/_shared/billing-state";
import {
  monthlyDueDate,
  normalizeBillingDueDay,
} from "../supabase/functions/_shared/billing-automation";

test("matriz de 16 cenarios Pix/boleto materializa a inicial sem duplicar cobranca", () => {
  const methods = ["pix", "boleto"] as const;
  const intents = [false, true] as const;
  const payers = ["tenant", "agency"] as const;
  const fireModes = ["avista", "embutido"] as const;
  const scenarios = methods.flatMap((paymentMethod) =>
    intents.flatMap((deferPayment) =>
      payers.flatMap((payer) =>
        fireModes.map((fireMode) => ({ paymentMethod, deferPayment, payer, fireMode })),
      ),
    ),
  );

  assert.equal(scenarios.length, 16);
  for (const scenario of scenarios) {
    const decision = planInitialBilling(scenario);
    assert.equal(decision.createInvoice, true, JSON.stringify(scenario));
    assert.equal(
      decision.createIndividualProviderCharge,
      scenario.payer === "tenant",
      JSON.stringify(scenario),
    );
    assert.equal(
      decision.invoiceStatus,
      scenario.payer === "agency" ? "awaiting_consolidation" : "pending",
      JSON.stringify(scenario),
    );
    assert.deepEqual(decision.notificationChannels, ["email", "whatsapp"]);
    assert.equal(decision.dispatchPendingDocuments, true);
  }
});

test("dia de vencimento configuravel governa cronograma, assinatura e consolidacao", () => {
  const dueDay = normalizeBillingDueDay(18);
  assert.equal(dueDay, 18);
  assert.equal(monthlyDueDate(2027, 2, dueDay), "2027-02-18");
  assert.equal(
    buildBillingSchedule({
      consultationId: "consulta-due-day",
      months: 3,
      initialDueDate: "2026-10-13",
      monthlyDueDay: dueDay,
    })[1].dueDate,
    "2026-11-18",
  );
  assert.equal(normalizeBillingDueDay(0), 10);
  assert.equal(normalizeBillingDueDay(29), 10);
  assert.equal(normalizeBillingDueDay("invalido"), 10);
});

test("valores separam mensal, taxa inicial e seguro incendio", () => {
  assert.deepEqual(
    calculateBillingAmounts({
      guaranteeMonthly: 270,
      fireAnnual: 90,
      activationFee: 100,
      fireMode: "embutido",
    }),
    {
      initialAmount: 377.5,
      monthlyAmount: 277.5,
      components: {
        guaranteeMonthly: 270,
        paintingMonthly: 0,
        fireMonthly: 7.5,
        fireUpfront: 0,
        activationFee: 100,
      },
    },
  );
  assert.deepEqual(
    calculateBillingAmounts({
      guaranteeMonthly: 270,
      fireAnnual: 90,
      activationFee: 100,
      fireMode: "avista",
    }),
    {
      initialAmount: 460,
      monthlyAmount: 270,
      components: {
        guaranteeMonthly: 270,
        paintingMonthly: 0,
        fireMonthly: 0,
        fireUpfront: 90,
        activationFee: 100,
      },
    },
  );
});

test("cronograma de 12 competencias inclui a inicial exatamente uma vez", () => {
  const consultationId = "11111111-1111-4111-8111-111111111111";
  const schedule = buildBillingSchedule({
    consultationId,
    months: 12,
    initialDueDate: "2026-10-31",
    monthlyDueDay: 10,
  });
  assert.equal(schedule.length, 12);
  assert.equal(schedule.filter((item) => item.kind === "initial").length, 1);
  assert.equal(schedule.filter((item) => item.kind === "monthly").length, 11);
  assert.equal(schedule[1].dueDate, "2026-11-10");
  assert.equal(schedule.at(-1)?.dueDate, "2027-09-10");
  assert.equal(new Set(schedule.map((item) => item.billingKey)).size, 12);
  assert.equal(schedule[0].billingKey, buildBillingKey(consultationId, "initial", 1));
});

test("redutor de pagamento ignora redelivery antiga e nunca regride quitacao", () => {
  assert.equal(reducePaymentStatus("paid", "pending"), "paid");
  assert.equal(reducePaymentStatus("confirmed", "overdue"), "confirmed");
  assert.equal(
    reducePaymentStatus("confirmed", "paid", "2026-10-13T12:00:00Z", "2026-10-13T11:00:00Z"),
    "confirmed",
  );
  assert.equal(reducePaymentStatus("paid", "refunded"), "refunded");
  assert.equal(reducePaymentStatus("refunded", "cancelled"), "refunded");
  assert.equal(reducePaymentStatus("refunded", "chargeback"), "chargeback");
});

test("lote consolidado e claim de webhook preservam concorrencia e retentativa", () => {
  assert.equal(
    reduceConsolidatedBatchStatus("paid", "active", "2026-10-13T12:00:00Z", "2026-10-13T13:00:00Z"),
    "paid",
  );
  assert.equal(
    reduceConsolidatedBatchStatus(
      "cancelled",
      "paid",
      "2026-10-13T12:00:00Z",
      "2026-10-13T13:00:00Z",
    ),
    "paid",
  );
  assert.equal(
    reduceConsolidatedBatchStatus(
      "paid",
      "cancelled",
      "2026-10-13T13:00:00Z",
      "2026-10-13T12:00:00Z",
    ),
    "paid",
  );
  assert.equal(
    webhookEventCanBeClaimed("error", {
      nextAttemptAt: "2026-10-13T12:00:00Z",
      now: "2026-10-13T12:00:01Z",
    }),
    true,
  );
  assert.equal(
    webhookEventCanBeClaimed("processing", {
      lockedAt: "2026-10-13T11:54:59Z",
      now: "2026-10-13T12:00:00Z",
    }),
    true,
  );
});

test("assinatura e Checkout preservam estados terminais e aceitam recuperacao nova", () => {
  assert.equal(subscriptionStatusFromEvent("SUBSCRIPTION_CREATED", "ACTIVE"), "active");
  assert.equal(subscriptionStatusFromEvent("SUBSCRIPTION_INACTIVATED"), "suspended");
  assert.equal(checkoutStatusFromEvent("CHECKOUT_PAID"), "paid");
  assert.equal(checkoutStatusFromEvent("CHECKOUT_EXPIRED"), "expired");
  assert.equal(reduceSubscriptionStatus("cancelled", "active"), "cancelled");
  assert.equal(
    reduceSubscriptionStatus("active", "suspended", "2026-10-13T12:00:00Z", "2026-10-13T11:00:00Z"),
    "active",
  );
  assert.equal(
    reduceSubscriptionStatus("suspended", "active", "2026-10-13T11:00:00Z", "2026-10-13T12:00:00Z"),
    "active",
  );
});

test("Checkout hospedado notifica a inicial e o cadastro recorrente com links distintos", () => {
  const plan = buildSubscriptionNotificationPlan({
    mode: "checkout",
    initialAmount: 377.5,
    monthlyAmount: 277.5,
    initialDueDate: "2026-10-13",
    nextDueDate: "2026-11-10",
    initialPaymentUrl: "https://checkout.asaas.com/initial",
    recurringCheckoutUrl: "https://checkout.asaas.com/recurring",
  });
  assert.deepEqual(plan, [
    {
      notificationType: "payment_created",
      amount: 377.5,
      dueDate: "2026-10-13",
      paymentUrl: "https://checkout.asaas.com/initial",
      cardRegistration: false,
    },
    {
      notificationType: "card_registration_requested",
      amount: 277.5,
      dueDate: "2026-11-10",
      paymentUrl: "https://checkout.asaas.com/recurring",
      cardRegistration: true,
    },
  ]);
});

test("os 16 cenarios obrigatorios possuem expectativas deterministicas", async (t) => {
  await t.test("01 Pix + Pagar agora + inquilino", () => {
    const result = planInitialBilling({
      paymentMethod: "pix",
      deferPayment: false,
      payer: "tenant",
      fireMode: "embutido",
    });
    assert.equal(result.createInvoice, true);
    assert.equal(result.createIndividualProviderCharge, true);
    assert.equal(result.dispatchPendingDocuments, true);
  });

  await t.test("02 Pix + Pagar depois + inquilino", () => {
    const result = planInitialBilling({
      paymentMethod: "pix",
      deferPayment: true,
      payer: "tenant",
      fireMode: "embutido",
    });
    assert.equal(result.invoiceStatus, "pending");
    assert.equal(result.createIndividualProviderCharge, true);
  });

  await t.test("03 Pix + Pagar depois + imobiliaria", () => {
    const result = planInitialBilling({
      paymentMethod: "pix",
      deferPayment: true,
      payer: "agency",
      fireMode: "avista",
    });
    assert.equal(result.invoiceStatus, "awaiting_consolidation");
    assert.equal(result.createIndividualProviderCharge, false);
  });

  await t.test("04 Boleto + Pagar agora + inquilino", () => {
    const result = planInitialBilling({
      paymentMethod: "boleto",
      deferPayment: false,
      payer: "tenant",
      fireMode: "avista",
    });
    assert.equal(result.createIndividualProviderCharge, true);
    assert.deepEqual(result.notificationChannels, ["email", "whatsapp"]);
  });

  await t.test("05 Boleto + Pagar depois + imobiliaria", () => {
    const result = planInitialBilling({
      paymentMethod: "boleto",
      deferPayment: true,
      payer: "agency",
      fireMode: "embutido",
    });
    assert.equal(result.createInvoice, true);
    assert.equal(result.createIndividualProviderCharge, false);
  });

  await t.test("06 Cartao + preenchimento imediato", () => {
    assert.equal(subscriptionStatusFromEvent("SUBSCRIPTION_CREATED"), "pending");
    assert.deepEqual(
      contractActivationDecision({
        paymentStatus: "confirmed",
        signatureStatus: "pending",
      }),
      { activate: false, reason: "signature_not_signed" },
    );
  });

  await t.test("07 Cartao + link enviado ao inquilino", () => {
    const [initial, registration] = buildSubscriptionNotificationPlan({
      mode: "checkout",
      initialAmount: 377.5,
      monthlyAmount: 277.5,
      initialDueDate: "2026-10-13",
      nextDueDate: "2026-11-10",
      initialPaymentUrl: "https://checkout/initial",
      recurringCheckoutUrl: "https://checkout/recurring",
    });
    assert.equal(initial.notificationType, "payment_created");
    assert.equal(registration.notificationType, "card_registration_requested");
    assert.notEqual(initial.paymentUrl, registration.paymentUrl);
  });

  await t.test("08 Cartao + cadastro concluido posteriormente", () => {
    assert.equal(
      reduceSubscriptionStatus("pending", "active", "2026-10-13T10:00:00Z", "2026-10-13T11:00:00Z"),
      "active",
    );
  });

  await t.test("09 Cartao + pagamento recusado", () => {
    assert.equal(reducePaymentStatus("processing", "refused"), "refused");
    assert.deepEqual(
      contractActivationDecision({
        paymentStatus: "refused",
        signatureStatus: "signed",
      }),
      { activate: false, reason: "payment_not_confirmed" },
    );
  });

  await t.test("10 Cobranca criada com falha no WhatsApp", () => {
    assert.equal(shouldAttemptNotification("failed"), true);
    assert.equal(shouldAttemptNotification("sent"), false);
  });

  await t.test("11 Cobranca criada com falha no e-mail", () => {
    assert.equal(shouldAttemptNotification("not_configured"), true);
    assert.equal(shouldAttemptNotification("delivered"), false);
    assert.equal(shouldAttemptNotification("sent", true), true);
  });

  await t.test("12 Webhook duplicado e fora de ordem", () => {
    assert.equal(reducePaymentStatus("paid", "paid"), "paid");
    assert.equal(
      reducePaymentStatus("paid", "pending", "2026-10-13T12:00:00Z", "2026-10-13T11:00:00Z"),
      "paid",
    );
  });

  await t.test("13 Atualizacao da pagina durante a contratacao", () => {
    assert.equal(shouldReconcileBillingOperation("provider_created"), true);
    assert.equal(shouldReconcileBillingOperation("ambiguous"), true);
    assert.equal(shouldReconcileBillingOperation("failed"), false);
  });

  await t.test("14 Cancelamento e reenvio de cobranca", () => {
    assert.equal(reduceCheckoutStatus("pending", "cancelled"), "cancelled");
    assert.equal(reduceCheckoutStatus("pending", "expired"), "expired");
    assert.equal(
      reduceCheckoutStatus("paid", "cancelled", "2026-10-13T12:00:00Z", "2026-10-13T11:00:00Z"),
      "paid",
    );
    assert.equal(billingDueDateError("2026-10-16", "2026-10-13"), null);
    assert.match(billingDueDateError("2026-10-12", "2026-10-13") || "", /passado/);
  });

  await t.test("15 Assinatura concluida com pagamento pendente", () => {
    assert.deepEqual(
      contractActivationDecision({
        paymentStatus: "pending",
        signatureStatus: "signed",
        policyStatus: "issued_pending",
      }),
      { activate: false, reason: "payment_not_confirmed" },
    );
  });

  await t.test("16 Confirmacao financeira ativa quando todos requisitos forem cumpridos", () => {
    assert.deepEqual(
      contractActivationDecision({
        paymentStatus: "paid",
        signatureStatus: "signed",
        policyStatus: "issued_pending",
      }),
      { activate: true, reason: "requirements_met" },
    );
    assert.deepEqual(
      contractActivationDecision({
        paymentStatus: "paid",
        signatureStatus: "signed",
        policyStatus: "cancelled",
      }),
      { activate: false, reason: "policy_cancelled" },
    );
  });
});

test("inquilino nao gerencia cobranca quando a imobiliaria e a pagadora", () => {
  const contract = {
    profile_id_solicitante: "agency-user",
    billing_responsible_user_id: "agency-user",
    tenant_user_id: "tenant-user",
    payment_type: "imobiliaria",
    billing_responsible_role: "imobiliaria",
  };
  assert.equal(hasDirectBillingOwnership(contract, "tenant-user"), false);
  assert.equal(hasDirectBillingOwnership(contract, "agency-user"), true);
});

test("validacao de vencimento rejeita formato invalido e data impossivel", () => {
  assert.match(billingDueDateError("13/10/2026", "2026-10-13") || "", /YYYY-MM-DD/);
  assert.match(billingDueDateError("2026-02-30", "2026-01-01") || "", /valida/);
  assert.equal(billingDueDateError("2026-10-13", "2026-10-13"), null);
});
