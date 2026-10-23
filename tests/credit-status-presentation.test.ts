import assert from "node:assert/strict";
import test from "node:test";
import { resolveCreditStatusPresentation } from "../src/lib/credit-status-presentation";

test("mantém decisões reais da Loft", () => {
  assert.equal(
    resolveCreditStatusPresentation({ status: "processando", resultado: "aprovado" }),
    "aprovado",
  );
  assert.equal(
    resolveCreditStatusPresentation({ status: "pendente", resultado: "recusado" }),
    "recusado",
  );
  assert.equal(
    resolveCreditStatusPresentation({ status: "em_analise", resultado: "em_analise" }),
    "em_analise",
  );
});

test("exibe revisão manual como Em análise e mantém a fila como Consultando", () => {
  assert.equal(resolveCreditStatusPresentation({ status: null, resultado: null }), "pendente");
  assert.equal(resolveCreditStatusPresentation({ status: "pendente" }), "pendente");
  assert.equal(resolveCreditStatusPresentation({ status: "processando" }), "processando");
  assert.equal(resolveCreditStatusPresentation({ status: "erro" }), "erro");
  assert.equal(
    resolveCreditStatusPresentation({ status: "requer_verificacao" }),
    "em_analise",
  );
  assert.equal(
    resolveCreditStatusPresentation({ status: "aprovado", resultado: "erro" }),
    "aprovado",
  );
});

test("detalha as etapas gravadas pelo worker", () => {
  assert.equal(
    resolveCreditStatusPresentation({
      status: "processando",
      technical_status: "processing",
      automation_step: "aguardando_autenticacao",
    }),
    "aguardando_autenticacao",
  );
  assert.equal(
    resolveCreditStatusPresentation({
      status: "processando",
      technical_status: "waiting_provider",
      automation_step: "aguardando_resultado",
    }),
    "processando",
  );
  assert.equal(
    resolveCreditStatusPresentation({
      status: "pendente",
      technical_status: "queued",
      automation_step: "aguardando_liberacao_parceiro",
    }),
    "aguardando_servico_externo",
  );
  assert.equal(
    resolveCreditStatusPresentation({ status: "cancelada", technical_status: "cancelled" }),
    "cancelada",
  );
});

test("preserva falta de documentos e etapas aprovadas legadas", () => {
  assert.equal(
    resolveCreditStatusPresentation({
      status: "em_analise",
      resultado: "em_analise",
      substatus: "falta_documentos",
    }),
    "falta_documentos",
  );
  assert.equal(
    resolveCreditStatusPresentation({ status: "aguardando_ativacao", resultado: null }),
    "aprovado",
  );
});
