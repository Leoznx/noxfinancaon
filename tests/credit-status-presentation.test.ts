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

test("exibe estados sem decisão como em análise sem fabricar resultado", () => {
  for (const status of [null, "pendente", "processando", "erro", "requer_verificacao"]) {
    assert.equal(
      resolveCreditStatusPresentation({ status, resultado: null }),
      "em_analise",
      String(status),
    );
  }

  assert.equal(
    resolveCreditStatusPresentation({ status: "aprovado", resultado: "erro" }),
    "em_analise",
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
