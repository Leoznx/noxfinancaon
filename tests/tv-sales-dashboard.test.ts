import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeTvRanking,
  rankDailyCompetition,
  sellerGoalPercentage,
  summarizeDailyTeam,
} from "../src/lib/tv-sales-dashboard";
import type { TeamGoalProgress } from "../src/lib/admin-team-goals";

test("normaliza e separa o ranking por especialidade e posição", () => {
  const rows = normalizeTvRanking([
    {
      vendedor_id: "closer-2",
      nome: "Closer B",
      seller_type: "closer",
      total_leads: "3",
      contratos_fechados: "2",
      em_atendimento: "1",
      posicao: "2",
    },
    {
      vendedor_id: "sdr-1",
      nome: "SDR A",
      seller_type: "sdr",
      total_leads: "8",
      contratos_fechados: "1",
      em_atendimento: "4",
      posicao: "1",
    },
    {
      vendedor_id: "closer-1",
      nome: "Closer A",
      seller_type: "closer",
      total_leads: "5",
      contratos_fechados: "4",
      em_atendimento: "2",
      posicao: "1",
    },
  ]);

  assert.deepEqual(
    rows.map((row) => `${row.sellerType}:${row.position}:${row.name}`),
    ["closer:1:Closer A", "closer:2:Closer B", "sdr:1:SDR A"],
  );
  assert.equal(rows[0]?.contracts, 4);
});

test("calcula progresso sem dividir por meta ausente", () => {
  assert.equal(sellerGoalPercentage(7, 10), 70);
  assert.equal(sellerGoalPercentage(12, 10), 120);
  assert.equal(sellerGoalPercentage(3, 0), null);
  assert.equal(sellerGoalPercentage(3, null), null);
});

const emptyGoal = {
  target_clients_daily: null,
  target_clients_weekly: null,
  target_clients_monthly: null,
  target_calls_daily: null,
  target_leads_contacted_daily: null,
  target_meetings_scheduled_daily: null,
  target_meetings_scheduled_weekly: null,
  target_meetings_scheduled_monthly: null,
  target_meetings_completed_daily: null,
  target_meetings_completed_weekly: null,
  target_meetings_completed_monthly: null,
  clients_registered_daily: 0,
  clients_registered_weekly: 0,
  clients_registered_monthly: 0,
  meetings_scheduled_daily: 0,
  meetings_scheduled_weekly: 0,
  meetings_scheduled_monthly: 0,
  meetings_completed_daily: 0,
  meetings_completed_weekly: 0,
  meetings_completed_monthly: 0,
} satisfies Omit<TeamGoalProgress, "seller_id" | "seller_name" | "seller_type">;

test("reordena a arena pelo desempenho diário, não pela posição mensal", () => {
  const sellers = normalizeTvRanking([
    {
      vendedor_id: "sdr-mensal",
      nome: "Líder mensal",
      seller_type: "sdr",
      total_leads: 30,
      contratos_fechados: 0,
      em_atendimento: 4,
      posicao: 1,
    },
    {
      vendedor_id: "sdr-hoje",
      nome: "Líder hoje",
      seller_type: "sdr",
      total_leads: 12,
      contratos_fechados: 0,
      em_atendimento: 2,
      posicao: 2,
    },
  ]);
  const goals: TeamGoalProgress[] = [
    {
      ...emptyGoal,
      seller_id: "sdr-mensal",
      seller_name: "Líder mensal",
      seller_type: "sdr",
      target_clients_daily: 4,
      target_meetings_scheduled_daily: 2,
      clients_registered_daily: 1,
      meetings_scheduled_daily: 0,
    },
    {
      ...emptyGoal,
      seller_id: "sdr-hoje",
      seller_name: "Líder hoje",
      seller_type: "sdr",
      target_clients_daily: 4,
      target_meetings_scheduled_daily: 2,
      clients_registered_daily: 4,
      meetings_scheduled_daily: 2,
    },
  ];

  const ranked = rankDailyCompetition(sellers, goals);
  assert.deepEqual(
    ranked.map((row) => [row.dailyPosition, row.name, row.dailyScore]),
    [
      [1, "Líder hoje", 100],
      [2, "Líder mensal", 13],
    ],
  );
});

test("soma as metas individuais para mostrar a corrida diária da equipe", () => {
  const sellers = normalizeTvRanking([
    { vendedor_id: "c1", nome: "A", seller_type: "closer", posicao: 1 },
    { vendedor_id: "c2", nome: "B", seller_type: "closer", posicao: 2 },
  ]);
  const goals: TeamGoalProgress[] = [
    {
      ...emptyGoal,
      seller_id: "c1",
      seller_name: "A",
      seller_type: "closer",
      target_meetings_completed_daily: 2,
      target_clients_daily: 1,
      meetings_completed_daily: 2,
      clients_registered_daily: 1,
    },
    {
      ...emptyGoal,
      seller_id: "c2",
      seller_name: "B",
      seller_type: "closer",
      target_meetings_completed_daily: 2,
      target_clients_daily: 1,
      meetings_completed_daily: 1,
      clients_registered_daily: 0,
    },
  ];

  assert.deepEqual(summarizeDailyTeam(sellers, goals), {
    primaryCurrent: 3,
    primaryTarget: 4,
    secondaryCurrent: 1,
    secondaryTarget: 2,
    score: 63,
  });
});
