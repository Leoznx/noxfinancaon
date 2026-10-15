import assert from "node:assert/strict";
import test from "node:test";

import { buildPlanSelectionUpdate } from "../src/lib/plan-selection";

const extras = {
  external_painting_enabled: false,
  external_painting_total: 0,
  external_painting_installment: 0,
  activation_fee_enabled: true,
  activation_fee_amount: 100,
  activation_fee_commission: 50,
};

test("ao retomar proposta salva altera somente o período e preserva o status", () => {
  const result = buildPlanSelectionUpdate(
    {
      plano_id: "plano-fit",
      contract_period_months: 12,
      valor_premio_mensal: "270.00",
      valor_anual: 3240,
      status: "aguardando_pagamento",
      documentos: { dados_preenchidos: true, extras },
    },
    {
      planId: "plano-fit",
      contractPeriodMonths: 6,
      monthlyAmount: 270,
      annualAmount: 3240,
      extras,
      calculatedPlan: { nome: "NOX Fit" },
    },
  );

  assert.deepEqual(result, {
    payload: { contract_period_months: 6 },
    resumed: true,
    periodChanged: true,
  });
});

test("seleção realmente alterada atualiza plano, valores e extras", () => {
  const result = buildPlanSelectionUpdate(
    {
      plano_id: "plano-fit",
      contract_period_months: 12,
      valor_premio_mensal: 270,
      valor_anual: 3240,
      status: "pendente_documentacao",
      documentos: { marcador: "preservado", extras },
    },
    {
      planId: "plano-smart",
      contractPeriodMonths: 24,
      monthlyAmount: 315,
      annualAmount: 3780,
      extras,
      calculatedPlan: { nome: "NOX Smart" },
    },
  );

  assert.equal(result.resumed, false);
  assert.equal(result.periodChanged, true);
  assert.deepEqual(result.payload, {
    plano_id: "plano-smart",
    contract_period_months: 24,
    valor_premio_mensal: 315,
    valor_anual: 3780,
    status: "pendente_documentacao",
    documentos: {
      marcador: "preservado",
      extras,
      plano_calculado: { nome: "NOX Smart" },
    },
  });
});
