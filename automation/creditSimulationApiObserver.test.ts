import assert from "node:assert/strict";
import test from "node:test";
import {
  isCreditSimulationRequest,
  parseCreditSimulationResponsePayload,
} from "./creditSimulationApiObserver";

test("captura o id técnico devolvido pelo BFF atual no mesmo objeto do status", () => {
  assert.deepEqual(
    parseCreditSimulationResponsePayload({
      id: "4789594",
      fiancaRiskAnalysisStatus: "APROVADA",
    }),
    {
      status: "aprovado",
      proposalId: "4789594",
    },
  );
});

test("não promove um id genérico quando o objeto não contém um status de análise válido", () => {
  assert.equal(parseCreditSimulationResponsePayload({ id: "4789594", status: "created" }), null);
});

test("não promove id genérico quando existe apenas um status genérico aprovado", () => {
  assert.deepEqual(
    parseCreditSimulationResponsePayload({
      id: "123456",
      status: "APPROVED",
      data: { proposalId: "4789594" },
    }),
    {
      status: "aprovado",
      proposalId: null,
    },
  );
});

test("reconhece o POST do formulário atual da Loft", () => {
  assert.equal(
    isCreditSimulationRequest(
      "https://app.loft.com.br/fianca-aluguel/imobiliaria/api/solicitacao/simulacao",
      "POST",
    ),
    true,
  );
  assert.equal(
    isCreditSimulationRequest(
      "https://app.loft.com.br/api/internal-rental-guarantee/simulation",
      "POST",
    ),
    true,
  );
  assert.equal(
    isCreditSimulationRequest(
      "https://app.loft.com.br/fianca-aluguel/imobiliaria/api/solicitacao/simulacao",
      "GET",
    ),
    false,
  );
});

test("captura status e id no contrato atual com analise aninhada", () => {
  assert.deepEqual(
    parseCreditSimulationResponsePayload({
      data: {
        id: 4789594,
        analise: { status: "Aprovada" },
      },
    }),
    { status: "aprovado", proposalId: "4789594" },
  );
});
