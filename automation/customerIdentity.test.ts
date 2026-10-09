import assert from "node:assert/strict";
import { test } from "node:test";
import { primeiroNomeCliente, nomeClienteValido, somenteDigitos } from "./customerIdentity";
import { extrairClienteInfo } from "./credpagoParser";

test("aceita nomes retornados pelos rótulos atuais do portal", () => {
  assert.deepEqual(
    extrairClienteInfo("Resultado aprovado\nNome do cliente\nMaria da Silva\nCPF: 111.444.777-35"),
    { nome: "Maria da Silva", documento: "11144477735" },
  );
  assert.deepEqual(
    extrairClienteInfo("Cliente: JOÃO DA SILVA\nCPF: 111.444.777-35"),
    { nome: "JOÃO DA SILVA", documento: "11144477735" },
  );
  assert.deepEqual(
    extrairClienteInfo("Resultado da análise\nMaria Oliveira\nCPF: 111.444.777-35"),
    { nome: "Maria Oliveira", documento: "11144477735" },
  );
});

test("não confunde CPF ou rótulos com o nome do cliente", () => {
  assert.equal(nomeClienteValido("111.444.777-35"), null);
  assert.equal(nomeClienteValido("s"), null);
  assert.equal(nomeClienteValido("Cliente: CPF: 111.444.777-35"), null);
  assert.equal(primeiroNomeCliente("CPF: 111.444.777-35", "Ana Souza"), "Ana Souza");
  assert.equal(somenteDigitos("111.444.777-35"), "11144477735");
});

test("não interpreta o plural Inquilinos como o nome s", () => {
  assert.deepEqual(
    extrairClienteInfo("Resultado aprovado\nInquilinos\nMaria da Silva\nCPF: 111.444.777-35"),
    { nome: "Maria da Silva", documento: "11144477735" },
  );
});

test("remove o texto jurídico ao redor do nome retornado pela Loft", () => {
  assert.equal(
    nomeClienteValido("O , ANA BEATRIZ BENVENUTTI, portador do"),
    "ANA BEATRIZ BENVENUTTI",
  );
  assert.deepEqual(
    extrairClienteInfo(
      "Crédito aprovado\nO , ANA BEATRIZ BENVENUTTI, portador do\nCPF: 073.950.269-77",
    ),
    { nome: "ANA BEATRIZ BENVENUTTI", documento: "07395026977" },
  );
});
