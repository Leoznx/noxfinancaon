import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canRetryDirectDScoreFailure,
  DIRECTD_DECISION_RULE,
  extractCommitmentPaymentPercentage,
  hasAdversePaymentHistory,
  hasDirectDScoreSuccessPayload,
  normalizeDirectDResult,
  sanitizeDirectDResponse,
  shouldAutomaticallyRetryDirectDScoreFailure,
  type DirectDScoreResponse,
} from "../supabase/functions/_shared/directd-credit.ts";

const FULL_COMMITMENT = "O consumidor paga 100% ou a maioria das suas contas em dia";

function responseFor(
  faixaScore: string,
  score: number | null = null,
  descricaoCompromissoPagamento: string | null = FULL_COMMITMENT,
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
        scoreCompromissoPagamento: 71,
        descricaoCompromissoPagamento,
      },
    },
  };
}

test("reconhece payload de score concluído independentemente do status HTTP", () => {
  const successResponse = {
    ...responseFor("", 700),
    metaDados: {
      consultaUid: "consulta-teste",
      resultadoId: 1,
      resultado: "Sucesso",
    },
  } satisfies DirectDScoreResponse;
  assert.equal(hasDirectDScoreSuccessPayload(successResponse, 11), true);
  assert.equal(
    hasDirectDScoreSuccessPayload({ metaDados: { resultadoId: 1, resultado: "Sucesso" } }, 11),
    false,
  );
  assert.equal(
    hasDirectDScoreSuccessPayload(
      { ...successResponse, metaDados: { resultadoId: 0, resultado: "Falha" } },
      11,
    ),
    false,
  );
});

test("só repete falha transitória de score quando não há recibo do provedor", () => {
  const withoutReceipt = {
    metaDados: { resultadoId: 0, resultado: "Falha" },
  } satisfies DirectDScoreResponse;
  assert.equal(canRetryDirectDScoreFailure(500, withoutReceipt), true);
  assert.equal(canRetryDirectDScoreFailure(503, withoutReceipt), true);
  assert.equal(canRetryDirectDScoreFailure(422, withoutReceipt), false);
  assert.equal(canRetryDirectDScoreFailure(500, responseFor("", 700)), false);
  assert.equal(shouldAutomaticallyRetryDirectDScoreFailure(500, withoutReceipt), true);
  assert.equal(shouldAutomaticallyRetryDirectDScoreFailure(403, withoutReceipt), false);
});

test("não decide automaticamente apenas pelo texto da faixa QUOD", () => {
  for (const faixaScore of [
    "Alto índice de inadimplência",
    "Médio índice de inadimplência",
    "Baixo índice de inadimplência",
  ]) {
    assert.equal(normalizeDirectDResult(responseFor(faixaScore), 11).decision, "em_analise");
  }
});

test("envia faixa sem regra para análise complementar", () => {
  assert.deepEqual(normalizeDirectDResult(responseFor("Faixa experimental", null, null), 11), {
    decision: "em_analise",
    faixaScore: "Faixa experimental",
    score: null,
    commitmentPaymentDescription: "",
    commitmentPaymentPercentage: null,
    message:
      "A análise oficial precisa de conferência complementar porque o score ou o compromisso de pagamento não foi informado.",
  });
});

test("aplica exatamente os limites de score e compromisso definidos pela NOX", () => {
  assert.equal(
    normalizeDirectDResult(responseFor("", 538, "O consumidor paga 47% das contas em dia"), 11)
      .decision,
    "recusado",
  );
  assert.equal(
    normalizeDirectDResult(
      responseFor("", 538.99, "O consumidor paga 47,99% das contas em dia"),
      11,
    ).decision,
    "recusado",
  );
  assert.equal(
    normalizeDirectDResult(responseFor("", 539, "O consumidor paga 47% das contas em dia"), 11)
      .decision,
    "em_analise",
  );
  assert.equal(normalizeDirectDResult(responseFor("", 540), 11).decision, "em_analise");
  assert.equal(
    normalizeDirectDResult(responseFor("", 541, "O consumidor paga 48% das contas em dia"), 11)
      .decision,
    "em_analise",
  );
  assert.equal(
    normalizeDirectDResult(responseFor("", 650, "O consumidor paga 48% das contas em dia"), 11)
      .decision,
    "em_analise",
  );
  assert.equal(
    normalizeDirectDResult(responseFor("", 651, "O consumidor paga 48% das contas em dia"), 11)
      .decision,
    "aprovado",
  );
  assert.equal(normalizeDirectDResult(responseFor("", 1000), 11).decision, "aprovado");
});

test("envia combinações mistas para análise manual", () => {
  assert.equal(
    normalizeDirectDResult(responseFor("", 900, "O consumidor paga 47% das contas em dia"), 11)
      .decision,
    "em_analise",
  );
  assert.equal(
    normalizeDirectDResult(responseFor("", 538, "O consumidor paga 100% das contas em dia"), 11)
      .decision,
    "em_analise",
  );
  assert.equal(
    normalizeDirectDResult(responseFor("", 541, "O consumidor paga 47% das contas em dia"), 11)
      .decision,
    "em_analise",
  );
});

test("reprova automaticamente relatos adversos mesmo com score e percentual altos", () => {
  const exactDescription =
    "O consumidor apresenta ou apresentou alguns atrasos de pagamentos ou pendências financeiras na média dos últimos 12 meses.";

  assert.equal(hasAdversePaymentHistory(exactDescription), true);
  assert.equal(
    normalizeDirectDResult(responseFor("", 900, exactDescription), 11).decision,
    "recusado",
  );
  assert.equal(
    normalizeDirectDResult(
      responseFor("", 900, "Foram identificadas pendências financeiras recentes."),
      11,
    ).decision,
    "recusado",
  );
  assert.equal(
    normalizeDirectDResult(
      responseFor("", 900, "O consumidor apresentou atrasos nos pagamentos."),
      11,
    ).decision,
    "recusado",
  );
});

test("não confunde negação explícita com histórico adverso", () => {
  const positiveDescription =
    "O consumidor não apresenta atrasos de pagamentos nem pendências financeiras e paga 48% das contas em dia.";

  assert.equal(hasAdversePaymentHistory(positiveDescription), false);
  assert.equal(
    normalizeDirectDResult(responseFor("", 651, positiveDescription), 11)
      .decision,
    "aprovado",
  );
  assert.equal(
    hasAdversePaymentHistory(
      "Não apresenta atrasos de pagamento, mas apresentou pendências financeiras recentes.",
    ),
    true,
  );
});

test("extrai o menor percentual descrito pelo provedor", () => {
  assert.equal(extractCommitmentPaymentPercentage(FULL_COMMITMENT), 100);
  assert.equal(extractCommitmentPaymentPercentage("Paga entre 60% e 79,5% das contas"), 60);
  assert.equal(extractCommitmentPaymentPercentage("Sem percentual informado"), null);
  assert.equal(extractCommitmentPaymentPercentage("Compromisso de 101%"), null);
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
  const result = normalizeDirectDResult(responseFor("Baixo índice de inadimplência", null), 11);
  assert.equal(result.score, null);
  assert.equal(result.decision, "em_analise");
});

test("envia descrição ausente ou ilegível para análise complementar", () => {
  assert.equal(normalizeDirectDResult(responseFor("", 900, null), 11).decision, "em_analise");
  assert.equal(
    normalizeDirectDResult(responseFor("", 900, "Compromisso não calculado"), 11).decision,
    "em_analise",
  );
});

test("seleciona pessoa jurídica para CNPJ", () => {
  const response: DirectDScoreResponse = {
    retorno: {
      pessoaFisica: { faixaScore: "Alto índice de inadimplência", score: 1 },
      pessoaJuridica: {
        faixaScore: "Baixo índice de inadimplência",
        score: 900,
        descricaoCompromissoPagamento: "A empresa paga 48% das contas em dia",
      },
    },
  };
  assert.deepEqual(normalizeDirectDResult(response, 14), {
    decision: "aprovado",
    faixaScore: "Baixo índice de inadimplência",
    score: 900,
    commitmentPaymentDescription: "A empresa paga 48% das contas em dia",
    commitmentPaymentPercentage: 48,
    message: "Crédito aprovado pela análise conjunta de score e compromisso de pagamento.",
  });
});

test("resposta publica remove documento, usuário, IP e análise interna", () => {
  const raw = {
    ...responseFor("Baixo índice de inadimplência"),
    metaDados: {
      consultaUid: "consulta-teste",
      usuario: "usuario-sensivel",
      ip: "127.0.0.1",
    },
  } as DirectDScoreResponse & { metaDados: Record<string, unknown> };
  const sanitizedObject = sanitizeDirectDResponse(raw, 11) as {
    retorno: Record<string, unknown>;
  };
  const sanitized = JSON.stringify(sanitizedObject);
  assert.equal(sanitized.includes("00000000000"), false);
  assert.equal(sanitized.includes("usuario-sensivel"), false);
  assert.equal(sanitized.includes("127.0.0.1"), false);
  assert.equal("score" in sanitizedObject.retorno, false);
  assert.equal("scoreCompromissoPagamento" in sanitizedObject.retorno, false);
  assert.equal("descricaoCompromissoPagamento" in sanitizedObject.retorno, false);
  assert.equal("percentualCompromissoPagamento" in sanitizedObject.retorno, false);
  assert.equal(sanitizedObject.retorno.regraDecisao, DIRECTD_DECISION_RULE);
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

test("migração reutiliza somente resultados calculados com os dois critérios", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20261105160000_credit_score_and_payment_commitment.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    migration,
    /source\.raw_response #>> '\{retorno,regraDecisao\}'\s*= 'score_descricao_compromisso_v1'/,
  );
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.claim_official_credit_simulation/);
  assert.match(migration, /GRANT EXECUTE[^;]+TO service_role/s);
  assert.doesNotMatch(
    migration,
    /UPDATE public\.consultas_credito\s+SET\s+status[\s\S]+FROM scored/,
  );
});

test("nova regra invalida o cache anterior e mantém a recuperação de falhas transitórias", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20261105190000_credit_score_commitment_48_percent.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const recoveryMigration = readFileSync(
    new URL(
      "../supabase/migrations/20261105170000_directd_transient_score_recovery.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const edgeFunction = readFileSync(
    new URL("../supabase/functions/simulate-credit-official/index.ts", import.meta.url),
    "utf8",
  );

  assert.equal(DIRECTD_DECISION_RULE, "score_descricao_compromisso_v2");
  assert.match(migration, /v_previous_rule constant text := 'score_descricao_compromisso_v1'/);
  assert.match(migration, /v_current_rule constant text := 'score_descricao_compromisso_v2'/);
  assert.match(migration, /pg_get_functiondef\(v_signature\)/);
  assert.match(migration, /EXECUTE v_definition/);
  assert.doesNotMatch(
    migration,
    /UPDATE public\.consultas_credito\s+SET\s+status[\s\S]+FROM scored/,
  );
  assert.match(recoveryMigration, /request\.provider_consulta_uid IS NULL/);
  assert.match(recoveryMigration, /request\.billed_cents IS NULL/);
  assert.match(edgeFunction, /DIRECTD_SCORE_MAX_HTTP_ATTEMPTS = 3/);
  assert.match(edgeFunction, /shouldAutomaticallyRetryDirectDScoreFailure/);
  assert.match(edgeFunction, /"finish_official_credit_simulation_v2"/);
});

test("análise interna fica protegida e fora do retorno legível pelo solicitante", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20261105173000_admin_internal_credit_analysis.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /ADD COLUMN IF NOT EXISTS commitment_payment_percentage numeric/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_internal_credit_analyses/);
  assert.match(migration, /profile\.role::text IN \('admin', 'admin_master'\)/);
  assert.match(migration, /public\.has_internal_role\([\s\S]+?'admin_master'/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_internal_credit_analyses\(uuid\[\]\)/);
  assert.match(migration, /public\.strip_internal_credit_analysis\(raw_response\)/);
  assert.match(migration, /automacao_credpago_resultado[\s\S]+?- 'score'/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.finish_official_credit_simulation_v2/);

  const edgeFunction = readFileSync(
    new URL("../supabase/functions/simulate-credit-official/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(edgeFunction, /"finish_official_credit_simulation_v2"/);
  const publicResultStart = edgeFunction.indexOf(
    "return json({",
    edgeFunction.indexOf("simulacao_credito_quod_concluida"),
  );
  const publicResultEnd = edgeFunction.indexOf("\n  } catch", publicResultStart);
  assert.notEqual(publicResultStart, -1);
  assert.notEqual(publicResultEnd, -1);
  const publicResult = edgeFunction.slice(publicResultStart, publicResultEnd);
  assert.doesNotMatch(publicResult, /score:\s*result\.score/);
  assert.doesNotMatch(publicResult, /percentualCompromissoPagamento/);
});
