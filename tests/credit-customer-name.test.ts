import assert from "node:assert/strict";
import { test } from "node:test";

import {
  extractCreditCustomerName,
  normalizeCreditCustomerName,
  resolveCreditCustomerName,
} from "../src/lib/credit-customer-name";

test("recupera o nome de resultados aprovados antigos", () => {
  assert.equal(
    extractCreditCustomerName({
      textoCapturado: "Crédito aprovado\nNome do cliente\nMaria da Silva\nCPF: [DOCUMENT_REDACTED]",
    }),
    "Maria da Silva",
  );
  assert.equal(
    extractCreditCustomerName({
      textoCapturado: "Resultado aprovado\nCliente: João de Souza\nCPF: [DOCUMENT_REDACTED]",
    }),
    "João de Souza",
  );
  assert.equal(
    extractCreditCustomerName({
      textoCapturado: "Resultado aprovado\nANA OLIVEIRA\nCPF: [DOCUMENT_REDACTED]",
    }),
    "ANA OLIVEIRA",
  );
});

test("não transforma documento ou rótulo do portal em nome", () => {
  assert.equal(normalizeCreditCustomerName("064.097.487-28"), null);
  assert.equal(normalizeCreditCustomerName("s"), null);
  assert.equal(
    extractCreditCustomerName({
      textoCapturado: "Crédito aprovado\nCliente:\nCPF: [DOCUMENT_REDACTED]",
    }),
    null,
  );
  assert.equal(
    extractCreditCustomerName({
      textoCapturado: "Resultado da análise\nCrédito aprovado\nCPF: [DOCUMENT_REDACTED]",
    }),
    null,
  );
});

test("ignora o plural Inquilinos e recupera o nome antes do documento", () => {
  assert.equal(
    extractCreditCustomerName({
      textoCapturado: "Resultado aprovado\nInquilinos\nMaria da Silva\nCPF: [DOCUMENT_REDACTED]",
    }),
    "Maria da Silva",
  );
});

test("prioriza tenant_name e usa o resumo técnico somente como fallback", () => {
  assert.equal(
    resolveCreditCustomerName({
      tenantName: "Paula Martins",
      rawResponse: { textoCapturado: "Cliente: Nome antigo\nCPF: [DOCUMENT_REDACTED]" },
    }),
    "Paula Martins",
  );
  assert.equal(
    resolveCreditCustomerName({
      tenantName: "s",
      rawResponse: { textoCapturado: "Nome: Carla Mendes\nCPF: [DOCUMENT_REDACTED]" },
    }),
    "Carla Mendes",
  );
});
