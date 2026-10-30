import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildBillingKey,
  buildBillingSchedule,
  buildSubscriptionNotificationPlan,
  billingDueDateError,
  calculateBillingAmounts,
  canManageIndividualInvoiceAction,
  checkoutStatusFromEvent,
  contractActivationDecision,
  contractAwaitingSignatureProjection,
  paymentEventTypeFromProviderStatus,
  hasDirectBillingOwnership,
  planInitialBilling,
  reduceCheckoutStatus,
  reduceConsolidatedBatchStatus,
  reducePaymentStatus,
  reduceSubscriptionStatus,
  resolveCheckoutPaymentResponsible,
  shouldAttemptNotification,
  shouldDispatchContractAfterPayment,
  shouldReconcileBillingOperation,
  shouldSwitchInitialPaymentMethod,
  subscriptionStatusFromEvent,
  webhookEventCanBeClaimed,
} from "../supabase/functions/_shared/billing-state";

import {
  BOLETO_ISSUANCE_LEAD_DAYS,
  initialBoletoDueDate,
  monthlyDueDate,
  normalizeBillingDueDay,
  nextContractBillingDueDate,
  normalizeContractBillingDueDay,
  scheduledBoletoIssueDate,
  shouldMaterializeScheduledBoleto,
} from "../supabase/functions/_shared/billing-automation";

test("conciliação converte o snapshot financeiro no evento semântico do Asaas", () => {
  assert.equal(paymentEventTypeFromProviderStatus("RECEIVED"), "PAYMENT_RECEIVED");
  assert.equal(paymentEventTypeFromProviderStatus("RECEIVED_IN_CASH"), "PAYMENT_RECEIVED");
  assert.equal(paymentEventTypeFromProviderStatus("CONFIRMED"), "PAYMENT_CONFIRMED");
  assert.equal(paymentEventTypeFromProviderStatus("OVERDUE"), "PAYMENT_OVERDUE");
  assert.equal(paymentEventTypeFromProviderStatus("PENDING"), "PAYMENT_UPDATED");
});

test("pagamento conciliado remove a espera financeira sem antecipar a assinatura", () => {
  assert.deepEqual(contractAwaitingSignatureProjection("paid"), {
    status: "aguardando_ativacao",
    substatus: "aguardando_assinatura_d4sign",
    activation_status: "aguardando_assinatura",
    signature_status: "sent",
    policy_status: "issued_pending",
  });
  assert.equal(
    contractAwaitingSignatureProjection("pending").activation_status,
    "aguardando_pagamento_e_assinatura",
  );
});

test("troca o meio da cobrança inicial somente enquanto ela está aberta", () => {
  assert.equal(
    shouldSwitchInitialPaymentMethod({
      currentMethod: "boleto",
      requestedMethod: "pix",
      status: "pending",
    }),
    true,
  );
  assert.equal(
    shouldSwitchInitialPaymentMethod({
      currentMethod: "pix",
      requestedMethod: "credit_card",
      status: "overdue",
    }),
    true,
  );
  assert.equal(
    shouldSwitchInitialPaymentMethod({
      currentMethod: "boleto",
      requestedMethod: "boleto",
      status: "pending",
    }),
    false,
  );
  assert.equal(
    shouldSwitchInitialPaymentMethod({
      currentMethod: "boleto",
      requestedMethod: "pix",
      status: "confirmed",
    }),
    false,
  );
});

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
    assert.equal(decision.createIndividualProviderCharge, true, JSON.stringify(scenario));
    assert.equal(decision.invoiceStatus, "pending", JSON.stringify(scenario));
    assert.deepEqual(decision.notificationChannels, ["email", "whatsapp"]);
    assert.equal(decision.dispatchPendingDocuments, true);
  }
});

test("matriz de pagador preserva a escolha e so envia cartao remoto ao inquilino", () => {
  const scenarios = [
    ["agency", "pix", null, "agency"],
    ["agency", "boleto", null, "agency"],
    ["agency", "credit_card", "direct", "agency"],
    ["agency", "credit_card", "checkout", "tenant"],
    ["tenant", "pix", null, "tenant"],
    ["tenant", "boleto", null, "tenant"],
    ["tenant", "credit_card", "direct", "tenant"],
    ["tenant", "credit_card", "checkout", "tenant"],
  ] as const;

  for (const [selectedPayer, paymentMethod, cardMode, expected] of scenarios) {
    assert.equal(
      resolveCheckoutPaymentResponsible({ selectedPayer, paymentMethod, cardMode }),
      expected,
      JSON.stringify({ selectedPayer, paymentMethod, cardMode }),
    );
  }
});

test("cobranca individual da imobiliaria permite reenvio e segunda via", () => {
  assert.equal(
    canManageIndividualInvoiceAction(
      { payment_responsible: "agency", status: "pending", consolidated_item_id: null },
      "resend_whatsapp",
    ),
    true,
  );
  assert.equal(
    canManageIndividualInvoiceAction(
      { payment_responsible: "agency", status: "awaiting_consolidation" },
      "reissue",
    ),
    false,
  );
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

test("vencimento escolhido aceita somente as seis opcoes e usa a proxima ocorrencia", () => {
  for (const dueDay of [5, 10, 15, 20, 25, 28]) {
    assert.equal(normalizeContractBillingDueDay(dueDay), dueDay);
  }
  assert.equal(normalizeContractBillingDueDay(18), null);
  assert.equal(normalizeContractBillingDueDay("invalido"), null);
  assert.equal(nextContractBillingDueDate("2026-10-16", 20), "2026-10-20");
  assert.equal(nextContractBillingDueDate("2026-10-20", 20), "2026-10-20");
  assert.equal(nextContractBillingDueDate("2026-10-21", 20), "2026-11-20");
  assert.equal(nextContractBillingDueDate("2026-12-29", 5), "2027-01-05");
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

test("novo prazo preserva a chave inicial e versiona apenas as mensalidades futuras", () => {
  const consultationId = "22222222-2222-4222-8222-222222222222";
  const firstSchedule = buildBillingSchedule({
    consultationId,
    months: 3,
    initialDueDate: "2026-10-20",
  });
  const revisedSchedule = buildBillingSchedule({
    consultationId,
    months: 6,
    initialDueDate: "2026-10-20",
    contractPeriodRevision: 1,
  });

  assert.equal(revisedSchedule[0].billingKey, firstSchedule[0].billingKey);
  assert.equal(firstSchedule[1].billingKey, `${buildBillingKey(consultationId, "monthly", 2)}`);
  assert.equal(revisedSchedule[1].billingKey, `${buildBillingKey(consultationId, "monthly", "2-r1")}`);
  assert.notEqual(revisedSchedule[1].billingKey, firstSchedule[1].billingKey);
});

test("boleto inicial e mensalidades futuras respeitam antecedencia de sete dias", () => {
  const now = new Date("2026-10-14T15:00:00.000Z");
  assert.equal(BOLETO_ISSUANCE_LEAD_DAYS, 7);
  assert.equal(initialBoletoDueDate(now), "2026-10-21");
  assert.equal(scheduledBoletoIssueDate("2026-11-19"), "2026-11-12");
  assert.equal(
    shouldMaterializeScheduledBoleto("2026-11-19", new Date("2026-11-12T15:00:00.000Z")),
    true,
  );
  assert.equal(
    shouldMaterializeScheduledBoleto("2026-11-19", new Date("2026-11-11T15:00:00.000Z")),
    false,
  );
});

test("plano agenda boleto futuro e o worker materializa sem liberar acao manual", () => {
  assert.equal(canManageIndividualInvoiceAction({ status: "scheduled" }, "refresh"), false);
  assert.equal(canManageIndividualInvoiceAction({ status: "scheduled" }, "reissue"), false);
  const installmentPlan = readFileSync(
    new URL("../supabase/functions/asaas-create-installment-plan/index.ts", import.meta.url),
    "utf8",
  );
  const scheduler = readFileSync(
    new URL(
      "../supabase/functions/process-scheduled-invoice-notifications/index.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(installmentPlan, /status: "scheduled"/);
  assert.match(installmentPlan, /shouldMaterializeScheduledBoleto/);
  assert.match(scheduler, /materializeScheduledBoletoInvoice/);
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

test("cartao libera o contrato somente depois do pagamento e da recorrencia", () => {
  assert.equal(
    shouldDispatchContractAfterPayment({ paymentStatus: "pending", recurringReady: true }),
    false,
  );
  assert.equal(
    shouldDispatchContractAfterPayment({ paymentStatus: "confirmed", recurringReady: false }),
    false,
  );
  assert.equal(
    shouldDispatchContractAfterPayment({ paymentStatus: "confirmed", recurringReady: true }),
    true,
  );
  assert.equal(
    shouldDispatchContractAfterPayment({ paymentStatus: "paid", recurringReady: true }),
    true,
  );
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
    assert.equal(result.invoiceStatus, "pending");
    assert.equal(result.createIndividualProviderCharge, true);
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
    assert.equal(result.createIndividualProviderCharge, true);
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
