import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isDirectDIdentityNotFound,
  normalizeDirectDBirthDate,
  normalizeDirectDIdentity,
  sanitizeDirectDIdentityResponse,
  type DirectDIdentityResponse,
} from "../supabase/functions/_shared/directd-identity.ts";

test("normaliza nome e nascimento retornados pelo cadastro de pessoa física", () => {
  const response: DirectDIdentityResponse = {
    metaDados: { consultaUid: "cadastro-pf-1" },
    retorno: {
      cpf: "12345678901",
      nome: "  Maria   da Silva  ",
      dataNascimento: "29/02/2000",
    },
  };

  assert.deepEqual(normalizeDirectDIdentity(response, 11), {
    customerName: "Maria da Silva",
    birthDate: "2000-02-29",
    providerExternalId: "cadastro-pf-1",
  });
});

test("usa razão social e não inventa data de nascimento para pessoa jurídica", () => {
  const response: DirectDIdentityResponse = {
    retorno: {
      cnpj: "12345678000190",
      nome: "Contato Comercial",
      razaoSocial: "Empresa Exemplo Ltda",
      nomeFantasia: "Exemplo",
      dataNascimento: "01/01/2000",
    },
  };

  assert.deepEqual(normalizeDirectDIdentity(response, 14), {
    customerName: "Empresa Exemplo Ltda",
    birthDate: null,
    providerExternalId: null,
  });
});

test("rejeita nomes genéricos, documentos e datas impossíveis", () => {
  assert.equal(normalizeDirectDIdentity({ retorno: { nome: "CPF: 123.456.789-00" } }, 11), null);
  assert.equal(normalizeDirectDIdentity({ retorno: { nome: "Nome não informado" } }, 11), null);
  assert.equal(normalizeDirectDBirthDate("31/02/2000"), null);
  assert.equal(normalizeDirectDBirthDate("2999-01-01"), null);
});

test("reconhece documento ausente mesmo quando a Direct Data responde HTTP 200", () => {
  assert.equal(
    isDirectDIdentityNotFound({
      metaDados: {
        resultadoId: 6,
        resultado: "Documento Entidade Não Encontrada",
        mensagem: "Documento Entidade Não Encontrada",
      },
      retorno: null,
    }),
    true,
  );
  assert.equal(
    isDirectDIdentityNotFound({
      metaDados: { resultadoId: 1, resultado: "Sucesso", mensagem: "Consulta realizada" },
      retorno: { nome: "Maria da Silva" },
    }),
    false,
  );
});

test("persiste somente identidade mínima da resposta cadastral", () => {
  const raw = {
    metaDados: { consultaUid: "cadastro-1", usuario: "segredo", ip: "127.0.0.1" },
    retorno: {
      cpf: "12345678901",
      nome: "Maria da Silva",
      dataNascimento: "2000-02-29",
      telefones: [{ telefoneComDDD: "11999999999" }],
      emails: [{ enderecoEmail: "privado@example.com" }],
      enderecos: [{ logradouro: "Rua Privada" }],
      nomeMae: "Dado não necessário",
    },
  } as DirectDIdentityResponse & {
    metaDados: Record<string, unknown>;
    retorno: Record<string, unknown>;
  };

  const sanitized = JSON.stringify(sanitizeDirectDIdentityResponse(raw, 11));
  assert.match(sanitized, /Maria da Silva/);
  for (const forbidden of [
    "12345678901",
    "segredo",
    "127.0.0.1",
    "11999999999",
    "privado@example.com",
    "Rua Privada",
    "Dado não necessário",
  ]) {
    assert.equal(sanitized.includes(forbidden), false);
  }
});

test("migração remove a exigência manual e audita a busca cadastral separadamente", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20261023160000_directd_cadastral_identity.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /VALUES \('directd-cadastro', true, 16\)/);
  assert.match(migration, /p_tenant_type, NULL, p_tenant_document/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.save_official_credit_identity/);
  assert.match(migration, /identity_billed_cents = v_cost/);
  assert.match(migration, /SET tenant_name = v_name/);
  assert.doesNotMatch(migration, /Nome completo ou razão social é obrigatório/);
});

test("migração torna documento não localizado terminal e sem nova cobrança", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20261023183000_directd_identity_not_found.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /'failed_billed'/);
  assert.match(migration, /DIRECTD_IDENTITY_NOT_FOUND/);
  assert.match(migration, /technical_status = 'technical_failure'/);
  assert.match(migration, /normalize_official_credit_customer_name\(consultation\.tenant_name\)/);
});

test("score continua quando a fonte cadastral não conhece o documento", () => {
  const implementation = readFileSync(
    new URL("../supabase/functions/simulate-credit-official/index.ts", import.meta.url),
    "utf8",
  );

  assert.match(implementation, /let identityNotFound = false/);
  assert.match(implementation, /identityNotFound = true/);
  assert.match(implementation, /!identity && !identityNotFound/);
  assert.match(implementation, /directd_cadastro_not_found/);
});
