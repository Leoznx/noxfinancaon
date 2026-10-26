import assert from "node:assert/strict";
import { test } from "node:test";

import {
  extractCreditCustomerName,
  normalizeCreditCustomerName,
  resolveCreditCustomerDisplayName,
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

test("exibe somente o nome quando a Loft retorna o texto jurídico de portador", () => {
  assert.equal(
    normalizeCreditCustomerName("O , ANA BEATRIZ BENVENUTTI, portador do"),
    "ANA BEATRIZ BENVENUTTI",
  );
  assert.equal(
    resolveCreditCustomerName({
      tenantName: null,
      rawResponse: {
        textoCapturado:
          "Crédito aprovado\nO , ANA BEATRIZ BENVENUTTI, portador do\nCPF: [DOCUMENT_REDACTED]",
      },
    }),
    "ANA BEATRIZ BENVENUTTI",
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

test("mostra documento não localizado sem inventar nome de cliente", () => {
  assert.equal(
    resolveCreditCustomerDisplayName({
      tenantName: "08025215920",
      document: "080.252.159-20",
      errorCategory: "DIRECTD_IDENTITY_NOT_FOUND",
    }),
    "CPF não localizado",
  );
  assert.equal(
    resolveCreditCustomerDisplayName({
      tenantName: "12345678000195",
      document: "12.345.678/0001-95",
      errorCategory: "DIRECTD_IDENTITY_NOT_FOUND",
    }),
    "CNPJ não localizado",
  );
  assert.equal(
    resolveCreditCustomerDisplayName({
      tenantName: "16833608938",
      document: "168.336.089-38",
      rawResponse: {
        identity: { status: "not_found", errorCode: "DIRECTD_IDENTITY_NOT_FOUND" },
      },
    }),
    "CPF não localizado",
  );
  assert.equal(
    resolveCreditCustomerDisplayName({
      tenantName: "48765009000155",
      document: "48.765.009/0001-55",
      rawResponse: {
        identity: { status: "unavailable", errorCode: "DIRECTD_IDENTITY_NAME_MISSING" },
      },
    }),
    "Razão social indisponível",
  );
});
