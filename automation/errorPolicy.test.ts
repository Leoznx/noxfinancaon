import assert from "node:assert/strict";
import test from "node:test";
import { isTransientPortalError, validateConsultaForAutomation } from "./errorPolicy";
import type { ConsultaCreditoRow } from "./types";

const consultaValida: ConsultaCreditoRow = {
  id: "00000000-0000-0000-0000-000000000000",
  correlation_id: "NOX-SIM-20260911-TEST0001",
  profile_id_solicitante: "00000000-0000-0000-0000-000000000001",
  created_at: "2026-09-11T10:00:00.000Z",
  tipo_pessoa: "PF",
  documento: "12345678901",
  documento_masked: "123.***.***-01",
  tipo_imovel: "Residencial",
  cep: "01310100",
  valor_aluguel: 2_000,
  valor_condominio: 300,
  valor_taxas: 100,
  status: "pendente",
};

test("reconhece indisponibilidade temporária do portal", () => {
  assert.equal(isTransientPortalError(new Error("page.goto: Timeout 30000ms exceeded")), true);
  assert.equal(isTransientPortalError(new Error("net::ERR_CONNECTION_RESET")), true);
  assert.equal(
    isTransientPortalError(new Error("O portal não informou o estado da autenticação")),
    true,
  );
  assert.equal(isTransientPortalError(new Error("Campo CPF não encontrado")), false);
});

test("valida a consulta antes de abrir o portal", () => {
  assert.equal(validateConsultaForAutomation(consultaValida), null);
  assert.match(
    validateConsultaForAutomation({ ...consultaValida, documento: "123" }) || "",
    /CPF/,
  );
  assert.match(validateConsultaForAutomation({ ...consultaValida, cep: "123" }) || "", /CEP/);
  assert.match(
    validateConsultaForAutomation({ ...consultaValida, valor_aluguel: 0, valor_condominio: 0, valor_taxas: 0 }) || "",
    /valor mensal/,
  );
});
