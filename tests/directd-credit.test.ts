import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DIRECTD_CREDIT_RULE_VERSION,
  normalizeDirectDResult,
  sanitizeDirectDResponse,
  type DirectDScoreResponse,
} from "../supabase/functions/_shared/directd-credit.ts";

function responseFor(
  faixaScore: string,
  score: number | null = null,
  scoreCompromissoPagamento: number | null = null,
  descricaoCompromissoPagamento = "Histórico de pagamentos informado pelo provedor",
): DirectDScoreResponse {
  return {
    metaDados: {
      consultaUid: "consulta-teste",
      apiVersao: "v3",
    },
    retorno: {
      documentoConsultado: "00000000000",
      pessoaFisica: {
        faixaScore,
        score,
        scoreCompromissoPagamento,
        descricaoCompromissoPagamento,
      },
    },
  };
}

test("não decide automaticamente apenas pelos textos do provedor", () => {
  for (const faixa of [
    "Alto índice de inadimplência",
    "Médio índice de inadimplência",
    "Baixo índice de inadimplência",
  ]) {
    assert.equal(normalizeDirectDResult(responseFor(faixa), 11).decision, "em_analise");
  }
});

test("envia faixa sem regra para análise complementar", () => {
  assert.deepEqual(normalizeDirectDResult(responseFor("Faixa experimental", null), 11), {
    decision: "em_analise",
    faixaScore: "Faixa experimental",
    score: null,
    scoreCompromissoPagamento: null,
    descricaoCompromissoPagamento: "Histórico de pagamentos informado pelo provedor",
    regraDecisao: DIRECTD_CREDIT_RULE_VERSION,
    message: "A análise oficial precisa de conferência complementar dos dois indicadores.",
  });
});

test("aplica os limites combinados e contínuos definidos pela NOX", () => {
  assert.equal(normalizeDirectDResult(responseFor("", 539, 59), 11).decision, "recusado");
  assert.equal(normalizeDirectDResult(responseFor("", 540, 60), 11).decision, "em_analise");
  assert.equal(normalizeDirectDResult(responseFor("", 595, 71), 11).decision, "em_analise");
  assert.equal(normalizeDirectDResult(responseFor("", 650, 79), 11).decision, "em_analise");
  assert.equal(normalizeDirectDResult(responseFor("", 650, 100), 11).decision, "em_analise");
  assert.equal(normalizeDirectDResult(responseFor("", 651, 79), 11).decision, "em_analise");
  assert.equal(normalizeDirectDResult(responseFor("", 651, 80), 11).decision, "aprovado");
  assert.equal(normalizeDirectDResult(responseFor("", 1000, 100), 11).decision, "aprovado");
});

test("os números prevalecem quando o texto do provedor diverge da regra NOX", () => {
  const medio = normalizeDirectDResult(
    responseFor("Alto índice de inadimplência", 551, 71),
    11,
  );
  assert.equal(medio.decision, "em_analise");
  assert.equal(medio.faixaScore, "Médio índice de inadimplência");

  const aprovado = normalizeDirectDResult(
    responseFor("Médio índice de inadimplência", 698, 80),
    11,
  );
  assert.equal(aprovado.decision, "aprovado");
  assert.equal(aprovado.faixaScore, "Baixo índice de inadimplência");
});

test("reprova quando qualquer requisito mínimo falha", () => {
  assert.equal(normalizeDirectDResult(responseFor("", 900, 59), 11).decision, "recusado");
  assert.equal(normalizeDirectDResult(responseFor("", 539, 100), 11).decision, "recusado");
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
      pessoaFisica: {
        faixaScore: "Alto índice de inadimplência",
        score: 1,
        scoreCompromissoPagamento: 20,
      },
      pessoaJuridica: {
        faixaScore: "Baixo índice de inadimplência",
        score: 900,
        scoreCompromissoPagamento: 95,
      },
    },
  };
  assert.deepEqual(normalizeDirectDResult(response, 14), {
    decision: "aprovado",
    faixaScore: "Baixo índice de inadimplência",
    score: 900,
    scoreCompromissoPagamento: 95,
    descricaoCompromissoPagamento: null,
    regraDecisao: DIRECTD_CREDIT_RULE_VERSION,
    message: "Crédito aprovado pelos critérios de score e compromisso de pagamento.",
  });
});

test("resposta persistida remove documento, usuário e IP do provedor", () => {
  const raw = {
    ...responseFor("Baixo índice de inadimplência", 700, 81),
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
  assert.equal(sanitized.includes('"scoreCompromissoPagamento":81'), true);
  assert.equal(sanitized.includes(DIRECTD_CREDIT_RULE_VERSION), true);
});

test("migração invalida cache antigo e audita compromisso de pagamento", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20261105130000_directd_score_payment_commitment_rule.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /payment_commitment_score numeric\(5,2\)/);
  assert.match(migration, /score_compromisso_v1/);
  assert.match(migration, /DIRECTD_LEGACY_RULE_NO_COMMITMENT/);
  assert.match(migration, /trg_enforce_directd_score_commitment_rule/);
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
