import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizeDirectDResult,
  sanitizeDirectDResponse,
  type DirectDScoreResponse,
} from "../supabase/functions/_shared/directd-credit.ts";

function responseFor(faixaScore: string, score: number | null = null): DirectDScoreResponse {
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

test("aplica os limites comerciais contínuos definidos pela NOX", () => {
  assert.equal(normalizeDirectDResult(responseFor("", 0), 11).decision, "recusado");
  assert.equal(normalizeDirectDResult(responseFor("", 540), 11).decision, "recusado");
  assert.equal(normalizeDirectDResult(responseFor("", 541), 11).decision, "em_analise");
  assert.equal(normalizeDirectDResult(responseFor("", 650), 11).decision, "em_analise");
  assert.equal(normalizeDirectDResult(responseFor("", 651), 11).decision, "aprovado");
  assert.equal(normalizeDirectDResult(responseFor("", 1000), 11).decision, "aprovado");
});

test("o score prevalece quando o texto do provedor diverge da regra NOX", () => {
  const medio = normalizeDirectDResult(responseFor("Alto índice de inadimplência", 551), 11);
  assert.equal(medio.decision, "em_analise");
  assert.equal(medio.faixaScore, "Médio índice de inadimplência");

  const aprovado = normalizeDirectDResult(responseFor("Médio índice de inadimplência", 698), 11);
  assert.equal(aprovado.decision, "aprovado");
  assert.equal(aprovado.faixaScore, "Baixo índice de inadimplência");
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

test("migração exige identidade e aplica as faixas comerciais no histórico", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20261023133000_credit_score_thresholds_and_required_identity.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /IF v_valid_name IS NULL THEN/);
  assert.match(migration, /Nome completo ou razão social é obrigatório/);
  assert.match(migration, /request\.score BETWEEN 0 AND 540 THEN 'recusado'/);
  assert.match(migration, /request\.score BETWEEN 541 AND 650 THEN 'em_analise'/);
  assert.match(migration, /request\.score BETWEEN 651 AND 1000 THEN 'aprovado'/);
  assert.match(migration, /conciliacao_mesmo_documento/);

  const legacyShutdown = readFileSync(
    new URL(
      "../supabase/migrations/20261023143000_disable_direct_legacy_credit_enqueue.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(legacyShutdown, /FROM PUBLIC, anon, authenticated/);
  assert.match(legacyShutdown, /TO service_role/);
});
