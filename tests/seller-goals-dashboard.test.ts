import assert from "node:assert/strict";
import test from "node:test";
import {
  sellerGoalMetricsForType,
  sellerGoalPercentage,
  sellerGoalProgressValue,
  sellerGoalTargetField,
  sellerOverallProgress,
  sellerRewardCriterion,
  sellerRewardCurrent,
} from "../src/lib/seller-goals-dashboard";
import type { SellerGoalProgress, SellerMonthlyProgress } from "../src/lib/seller-progress";

const progress: SellerMonthlyProgress = {
  seller_id: "seller-1",
  target_meetings: 20,
  target_clients: 10,
  target_contracts: 5,
  meetings_completed: 10,
  clients_registered: 10,
  contracts_closed: 1,
};

test("progresso geral calcula a média das três metas e limita cada uma a 100%", () => {
  assert.equal(sellerOverallProgress(progress), 57);
  assert.equal(sellerGoalPercentage(12, 10), 100);
  assert.equal(sellerGoalPercentage(0, null), 0);
});

test("recompensas usam o indicador configurado", () => {
  assert.equal(sellerRewardCurrent(progress, "meetings"), 10);
  assert.equal(sellerRewardCurrent(progress, "clients"), 10);
  assert.equal(sellerRewardCurrent(progress, "contracts"), 1);
});

test("critério da recompensa respeita singular e plural", () => {
  assert.equal(sellerRewardCriterion("contracts", 1), "1 contrato fechado");
  assert.equal(sellerRewardCriterion("clients", 3), "3 clientes cadastrados");
});

const goalProgress: SellerGoalProgress = {
  seller_id: "seller-1",
  seller_type: "sdr",
  month: 9,
  year: 2026,
  target_clients_daily: 2,
  target_clients_weekly: 8,
  target_clients_monthly: 20,
  target_meetings_scheduled_daily: 1,
  target_meetings_scheduled_weekly: 5,
  target_meetings_scheduled_monthly: 15,
  target_meetings_completed_daily: null,
  target_meetings_completed_weekly: null,
  target_meetings_completed_monthly: null,
  clients_registered_daily: 1,
  clients_registered_weekly: 4,
  clients_registered_monthly: 10,
  meetings_scheduled_daily: 2,
  meetings_scheduled_weekly: 5,
  meetings_scheduled_monthly: 12,
  meetings_completed_daily: 0,
  meetings_completed_weekly: 0,
  meetings_completed_monthly: 0,
};

test("metas periódicas só aparecem para o tipo de vendedor correto", () => {
  assert.deepEqual(sellerGoalMetricsForType("sdr"), ["clients", "meetings_scheduled"]);
  assert.deepEqual(sellerGoalMetricsForType("closer"), ["clients", "meetings_completed"]);
});

test("campo de meta combina a métrica com o período", () => {
  assert.equal(sellerGoalTargetField("clients", "daily"), "target_clients_daily");
  assert.equal(sellerGoalTargetField("meetings_completed", "monthly"), "target_meetings_completed_monthly");
});

test("progresso periódico lê o par meta/realizado certo e limita a 100%", () => {
  assert.deepEqual(sellerGoalProgressValue(goalProgress, "clients", "daily"), {
    current: 1,
    target: 2,
    percentage: 50,
  });
  assert.deepEqual(sellerGoalProgressValue(goalProgress, "meetings_scheduled", "weekly"), {
    current: 5,
    target: 5,
    percentage: 100,
  });
  // Meta batida além do alvo continua limitada a 100%.
  assert.equal(sellerGoalProgressValue(goalProgress, "meetings_scheduled", "daily").percentage, 100);
  // Sem meta definida (Closer não tem meta de reunião agendada configurada aqui).
  assert.deepEqual(sellerGoalProgressValue(goalProgress, "meetings_completed", "monthly"), {
    current: 0,
    target: null,
    percentage: 0,
  });
});
