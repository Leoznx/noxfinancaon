import assert from "node:assert/strict";
import test from "node:test";
import {
  sellerGoalPercentage,
  sellerOverallProgress,
  sellerRewardCriterion,
  sellerRewardCurrent,
} from "../src/lib/seller-goals-dashboard";
import type { SellerMonthlyProgress } from "../src/lib/seller-progress";

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
