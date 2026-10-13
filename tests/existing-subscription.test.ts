import assert from "node:assert/strict";
import test from "node:test";

import {
  buildImportedMonthlySchedule,
  countMonthlyInstallments,
  isCompatibleSubscriptionAmount,
  selectCustomerByDocument,
  selectNoxCardSubscriptions,
  subscriptionInstallmentCount,
} from "../supabase/functions/_shared/existing-subscription.ts";

test("seleciona cliente pelo documento e somente assinatura NOX mensal ativa no cartao", () => {
  const customers = selectCustomerByDocument(
    {
      data: [
        { id: "cus_1", cpfCnpj: "064.097.487-28" },
        { id: "cus_2", cpfCnpj: "1" },
      ],
    },
    "06409748728",
  );
  assert.deepEqual(
    customers.map((item) => item.id),
    ["cus_1"],
  );

  const subscriptions = selectNoxCardSubscriptions(
    {
      data: [
        {
          id: "sub_1",
          customer: "cus_1",
          billingType: "CREDIT_CARD",
          cycle: "MONTHLY",
          status: "ACTIVE",
          description: "NOX FIANÇA",
        },
        {
          id: "sub_2",
          customer: "cus_1",
          billingType: "BOLETO",
          cycle: "MONTHLY",
          status: "ACTIVE",
          description: "NOX FIANÇA",
        },
        {
          id: "sub_3",
          customer: "cus_1",
          billingType: "CREDIT_CARD",
          cycle: "MONTHLY",
          status: "INACTIVE",
          description: "NOX FIANÇA",
        },
      ],
    },
    "cus_1",
  );
  assert.deepEqual(
    subscriptions.map((item) => item.id),
    ["sub_1"],
  );
});

test("confere doze competencias e ancora o mesmo dia de vencimento", () => {
  assert.equal(countMonthlyInstallments("2026-10-14", "2027-09-14"), 12);
  assert.equal(
    subscriptionInstallmentCount({
      subscription: { endDate: "2027-09-14" },
      firstDueDate: "2026-10-14",
    }),
    12,
  );
  const schedule = buildImportedMonthlySchedule({
    firstDueDate: "2026-10-14",
    totalInstallments: 12,
  });
  assert.equal(schedule[0]?.dueDate, "2026-10-14");
  assert.equal(schedule[11]?.dueDate, "2027-09-14");
});

test("aceita acrescimo operacional pequeno sem alterar o premio contratual", () => {
  assert.equal(isCompatibleSubscriptionAmount(146.75, 141.75), true);
  assert.equal(isCompatibleSubscriptionAmount(120, 141.75), false);
  assert.equal(isCompatibleSubscriptionAmount(200, 141.75), false);
});
