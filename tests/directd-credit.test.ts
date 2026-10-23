import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizeDirectDResult,
  sanitizeDirectDResponse,
  type DirectDScoreResponse,
} from "../supabase/functions/_shared/directd-credit.ts";

function responseFor(faixaScore: string, score: number | null = 700): DirectDScoreResponse {
  return {
    metaDados: {
      consultaUid: "consulta-teste",
      apiVersao: "v3",
    },
    retorno: {
      documentoConsultado: "00000000000",
      pessoaFisica: { faixaScore, score },
    },
  };
}

test("mapeia as três faixas QUOD para a regra comercial da NOX", () => {
  assert.equal(
    normalizeDirectDResult(responseFor("Alto índice de inadimplência"), 11)?.decision,
    "recusado",
  );
  assert.equal(
    normalizeDirectDResult(responseFor("Médio índice de inadimplência"), 11)?.decision,
    "em_analise",
  );
  assert.equal(
    normalizeDirectDResult(responseFor("Baixo índice de inadimplência"), 11)?.decision,
    "aprovado",
  );
});

test("envia faixa sem regra para análise complementar", () => {
  assert.deepEqual(normalizeDirectDResult(responseFor("Faixa experimental", null), 11), {
    decision: "em_analise",
    faixaScore: "Faixa experimental",
    score: null,
    message: "A análise oficial precisa de conferência complementar.",
  });
});

test("usa os intervalos oficiais quando o provedor omite o texto da faixa", () => {
  assert.equal(normalizeDirectDResult(responseFor("", 600), 11).decision, "recusado");
  assert.equal(normalizeDirectDResult(responseFor("", 601), 11).decision, "em_analise");
  assert.equal(normalizeDirectDResult(responseFor("", 701), 11).decision, "aprovado");
});

test("preserva score ausente como nulo", () => {
  assert.equal(
    normalizeDirectDResult(responseFor("Baixo índice de inadimplência", null), 11)?.score,
    null,
  );
});

test("seleciona pessoa jurídica para CNPJ", () => {
  const response: DirectDScoreResponse = {
    retorno: {
      pessoaFisica: { faixaScore: "Alto índice de inadimplência", score: 1 },
      pessoaJuridica: { faixaScore: "Baixo índice de inadimplência", score: 900 },
    },
  };
  assert.deepEqual(normalizeDirectDResult(response, 14), {
    decision: "aprovado",
    faixaScore: "Baixo índice de inadimplência",
    score: 900,
    message: "Crédito aprovado pela análise oficial de risco.",
  });
});

test("resposta persistida remove documento, usuário e IP do provedor", () => {
  const raw = {
    ...responseFor("Baixo índice de inadimplência"),
    metaDados: {
      consultaUid: "consulta-teste",
      usuario: "usuario-sensivel",
      ip: "127.0.0.1",
    },
  } as DirectDScoreResponse & { metaDados: Record<string, unknown> };
  const sanitized = JSON.stringify(sanitizeDirectDResponse(raw, 11));
  assert.equal(sanitized.includes("00000000000"), false);
  assert.equal(sanitized.includes("usuario-sensivel"), false);
  assert.equal(sanitized.includes("127.0.0.1"), false);
});

test("migração desliga o claim antigo e registra o custo de R$ 1,98", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20261022153000_directd_quod_credit_api.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /SET enabled = false/);
  assert.match(migration, /VALUES \('directd-quod', true, 198\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.claim_next_credit_simulation/);
  assert.doesNotMatch(migration, /DIRECTD_API_TOKEN\s*=/);

  const billingMigration = readFileSync(
    new URL(
      "../supabase/migrations/20261022160000_directd_confirmed_charge_audit.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(billingMigration, /p_charge_confirmed boolean/);
  assert.match(billingMigration, /SET billed_cents = coalesce\(v_cost, 198\)/);

  const shutdownMigration = readFileSync(
    new URL(
      "../supabase/migrations/20261022162000_disable_legacy_browser_aux_workers.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(shutdownMigration, /claim_next_loft_proposal_cancellation/);
  assert.match(shutdownMigration, /claim_next_repair_job/);
});

test("migração cria todos os campos de auditoria usados pelo fluxo oficial", () => {
  const compatibilityMigration = readFileSync(
    new URL(
      "../supabase/migrations/20261022170000_credit_provider_audit_columns.sql",
      import.meta.url,
    ),
    "utf8",
  );

  for (const column of [
    "external_provider",
    "external_status",
    "external_request_id",
    "external_response",
    "automacao_credpago_status",
    "automacao_credpago_resultado",
    "provider_returned_at",
    "automacao_processed_at",
  ]) {
    assert.match(compatibilityMigration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`));
  }
});
