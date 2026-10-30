import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTvRanking, sellerGoalPercentage } from "../src/lib/tv-sales-dashboard";

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
