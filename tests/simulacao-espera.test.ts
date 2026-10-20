import assert from "node:assert/strict";
import test from "node:test";
import {
  MENSAGEM_ERRO_PADRAO,
  TEMPO_LIMITE_ACOMPANHAMENTO_MS,
  TEMPO_PARA_SEGUNDO_PLANO_MS,
  etapaDeEsperaLonga,
  proximoPassoSimulacao,
} from "../src/lib/simulacao-espera";

test("recém-enfileirada continua no modal em vez de abrir a tela de status", () => {
  assert.deepEqual(proximoPassoSimulacao({ status: "pendente", technical_status: "received" }), {
    tipo: "aguardar",
  });
  assert.deepEqual(proximoPassoSimulacao({ status: "pendente", technical_status: "queued" }), {
    tipo: "aguardar",
  });
  assert.deepEqual(proximoPassoSimulacao({ status: null }), { tipo: "aguardar" });
});

test("todas as etapas do worker mantêm o corretor aguardando", () => {
  for (const automation_step of ["abrindo", "preenchendo", "enviando"]) {
    assert.deepEqual(proximoPassoSimulacao({ status: "processando", automation_step }), {
      tipo: "aguardar",
    });
  }
  assert.deepEqual(
    proximoPassoSimulacao({
      status: "processando",
      technical_status: "waiting_provider",
      automation_step: "aguardando_resultado",
    }),
    { tipo: "aguardar" },
  );
  assert.deepEqual(
    proximoPassoSimulacao({
      status: "pendente",
      technical_status: "queued",
      automation_step: "aguardando_autenticacao",
    }),
    { tipo: "aguardar" },
  );
  assert.deepEqual(
    proximoPassoSimulacao({
      status: "pendente",
      technical_status: "queued",
      automation_step: "aguardando_liberacao_parceiro",
    }),
    { tipo: "aguardar" },
  );
  assert.deepEqual(
    proximoPassoSimulacao({
      status: "pendente",
      technical_status: "queued",
      automation_step: "recuperada_automaticamente",
    }),
    { tipo: "aguardar" },
  );
});

test("só abre o status quando existe decisão real do provedor", () => {
  assert.deepEqual(proximoPassoSimulacao({ status: "aprovado", resultado: "aprovado" }), {
    tipo: "abrir_status",
  });
  assert.deepEqual(proximoPassoSimulacao({ status: "recusado", resultado: "recusado" }), {
    tipo: "abrir_status",
  });
  assert.deepEqual(proximoPassoSimulacao({ status: "em_analise", resultado: "em_analise" }), {
    tipo: "abrir_status",
  });
  assert.deepEqual(
    proximoPassoSimulacao({ status: "processando", resultado: "aprovado" }),
    { tipo: "abrir_status" },
  );
});

test("quarentena técnica continua aguardando e cancelamento abre o status", () => {
  assert.deepEqual(
    proximoPassoSimulacao({ status: "requer_verificacao", technical_status: "requires_verification" }),
    { tipo: "aguardar" },
  );
  assert.deepEqual(
    proximoPassoSimulacao({ status: "cancelada", technical_status: "cancelled" }),
    { tipo: "abrir_status" },
  );
});

test("falha técnica definitiva aparece no modal com a mensagem gravada", () => {
  assert.deepEqual(
    proximoPassoSimulacao({
      status: "erro",
      technical_status: "technical_failure",
      error_message: "O portal recusou a consulta.",
      mensagem: "ignorada",
    }),
    { tipo: "erro", mensagem: "O portal recusou a consulta." },
  );
  assert.deepEqual(proximoPassoSimulacao({ status: "erro", mensagem: "Falha ao consultar." }), {
    tipo: "erro",
    mensagem: "Falha ao consultar.",
  });
  assert.deepEqual(proximoPassoSimulacao({ status: "erro" }), {
    tipo: "erro",
    mensagem: MENSAGEM_ERRO_PADRAO,
  });
});

test("esperas longas do serviço externo liberam o segundo plano de imediato", () => {
  assert.equal(etapaDeEsperaLonga("aguardando_autenticacao"), true);
  assert.equal(etapaDeEsperaLonga("aguardando_liberacao_parceiro"), true);
  for (const etapa of ["preparando_envio", "pendente", "abrindo", "enviando", null, undefined]) {
    assert.equal(etapaDeEsperaLonga(etapa), false);
  }
});

test("os limites de espera são coerentes", () => {
  assert.ok(TEMPO_PARA_SEGUNDO_PLANO_MS < TEMPO_LIMITE_ACOMPANHAMENTO_MS);
  // O limite do worker é de 7 minutos; o acompanhamento precisa durar mais.
  assert.ok(TEMPO_LIMITE_ACOMPANHAMENTO_MS > 7 * 60_000);
});
