import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import { parseResultado } from "./credpagoParser";
import { observeCreditSimulationApi } from "./creditSimulationApiObserver";

let browser: Browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser.close();
});

test("aguarda a análise ativa além do prazo inicial sem repetir o clique", async () => {
  const page = await browser.newPage();
  await page.setContent("<main>Analisando crédito</main>");
  await page.evaluate(() => {
    setTimeout(() => {
      document.body.innerHTML = "<main>Crédito aprovado</main>";
    }, 150);
  });

  let recliques = 0;
  const resultado = await parseResultado(page, {
    timeoutMs: 2_000,
    processingTimeoutMs: 5_000,
    pollIntervalMs: 50,
    retryAfterMs: 300,
    onRetryClick: async () => {
      recliques += 1;
    },
  });

  assert.equal(resultado.status, "aprovado");
  assert.equal(recliques, 0);
  await page.close();
});

test("reconhece a análise complementar do novo portal como em análise", async () => {
  const page = await browser.newPage();
  await page.setContent("<main><h1>Análise complementar necessária</h1></main>");

  const resultado = await parseResultado(page, {
    timeoutMs: 100,
    processingTimeoutMs: 100,
    pollIntervalMs: 10,
  });

  assert.equal(resultado.status, "em_analise");
  await page.close();
});

test("reconhece os textos atuais de aprovado e análise complementar do portal", async () => {
  const approvedPage = await browser.newPage();
  await approvedPage.setContent(
    "<main>Cliente com excelente histórico de crédito identificado.</main>",
  );
  const approved = await parseResultado(approvedPage, {
    timeoutMs: 100,
    processingTimeoutMs: 100,
    pollIntervalMs: 10,
  });
  assert.equal(approved.status, "aprovado");
  await approvedPage.close();

  const pendingPage = await browser.newPage();
  await pendingPage.setContent(
    "<main>Cliente com necessidade de análise complementar devido a pontos de atenção identificados no histórico de crédito.</main>",
  );
  const pending = await parseResultado(pendingPage, {
    timeoutMs: 100,
    processingTimeoutMs: 100,
    pollIntervalMs: 10,
  });
  assert.equal(pending.status, "em_analise");
  await pendingPage.close();
});

test("mantém a consulta ativa com as novas mensagens de processamento", async () => {
  const page = await browser.newPage();
  await page.setContent(
    "<main><h1>Análise em andamento</h1><p>A Loft está consultando os principais birôs de crédito.</p></main>",
  );
  await page.evaluate(() => {
    setTimeout(() => {
      document.body.innerHTML = "<main>Fiança aprovada</main>";
    }, 150);
  });

  const resultado = await parseResultado(page, {
    timeoutMs: 100,
    processingTimeoutMs: 1_000,
    pollIntervalMs: 25,
  });

  assert.equal(resultado.status, "aprovado");
  await page.close();
});

test("usa o status explícito da API para CPF mesmo se o texto da tela mudar", async () => {
  const page = await browser.newPage();
  await page.route("**/api/internal-rental-guarantee/simulation", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ fiancaRiskAnalysisStatus: "APROVADA" }),
    }),
  );
  await page.setContent("<main>Processando os dados enviados...</main>");
  const observer = observeCreditSimulationApi(page);
  void page.evaluate(() =>
    fetch("https://portal.test/api/internal-rental-guarantee/simulation", { method: "POST" }),
  );

  const resultado = await parseResultado(page, {
    timeoutMs: 100,
    processingTimeoutMs: 1_000,
    pollIntervalMs: 25,
    readObservedResult: observer.read,
    hasObservedRequest: observer.hasStarted,
  });

  assert.equal(resultado.status, "aprovado");
  assert.equal(resultado.rawSummary.resultadoCapturadoVia, "resposta_api");
  observer.dispose();
  await page.close();
});

test("usa o status explícito da API para CNPJ sem depender do layout", async () => {
  const page = await browser.newPage();
  await page.route("**/api/internal-rental-guarantee/simulation", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { fiancaRiskAnalysisStatus: "REPROVADA" } }),
    }),
  );
  await page.setContent("<main>Resultado da pessoa jurídica</main>");
  const observer = observeCreditSimulationApi(page);
  void page.evaluate(() =>
    fetch("https://portal.test/api/internal-rental-guarantee/simulation", { method: "POST" }),
  );

  const resultado = await parseResultado(page, {
    timeoutMs: 100,
    processingTimeoutMs: 1_000,
    pollIntervalMs: 25,
    readObservedResult: observer.read,
    hasObservedRequest: observer.hasStarted,
  });

  assert.equal(resultado.status, "recusado");
  observer.dispose();
  await page.close();
});

test("trata o redirecionamento empresarial de CNPJ como análise complementar", async () => {
  const page = await browser.newPage();
  await page.route("https://app.loft.com.br/erp/proposta/nova-proposta?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<main><h1>Complemente sua proposta</h1></main>",
    }),
  );
  await page.goto(
    "https://app.loft.com.br/erp/proposta/nova-proposta?creditAnalysisOrigin=1&customerTaxId=12345678000190",
  );

  const resultado = await parseResultado(page, {
    timeoutMs: 100,
    processingTimeoutMs: 100,
    pollIntervalMs: 10,
  });

  assert.equal(resultado.status, "em_analise");
  assert.match(resultado.mensagem, /CNPJ.*análise complementar/i);
  assert.equal(resultado.rawSummary.motivoTecnico, "provider_cnpj_business_flow");
  assert.doesNotMatch(JSON.stringify(resultado.rawSummary), /12345678000190/);
  await page.close();
});

test("não persiste a marca do provedor nem dados sensíveis no resumo técnico", async () => {
  const page = await browser.newPage();
  await page.setContent(
    "<main>Fiança aprovada pela Loft para Cliente: MARIA DA SILVA CPF: 111.444.777-35</main>",
  );

  const resultado = await parseResultado(page, {
    timeoutMs: 100,
    processingTimeoutMs: 100,
    pollIntervalMs: 10,
  });
  const resumo = JSON.stringify(resultado.rawSummary);

  assert.equal(resultado.status, "aprovado");
  assert.doesNotMatch(resumo, /loft/i);
  assert.doesNotMatch(resumo, /111[.]444[.]777-35/);
  assert.match(resumo, /parceiro de crédito/i);
  assert.match(resumo, /DOCUMENT_REDACTED/);
  await page.close();
});

test("captura o identificador da proposta gerado pelo portal", async () => {
  const page = await browser.newPage();
  await page.setContent("<main>Crédito aprovado — Proposta nº 4775289</main>");

  const resultado = await parseResultado(page, {
    timeoutMs: 100,
    processingTimeoutMs: 100,
    pollIntervalMs: 10,
  });

  assert.equal(resultado.status, "aprovado");
  assert.equal(resultado.proposalId, "4775289");
  await page.close();
});

test("mantém o reclique de recuperação quando o formulário realmente fica parado", async () => {
  const page = await browser.newPage();
  await page.setContent("<main><button>Simular Crédito</button></main>");

  let recliques = 0;
  const resultado = await parseResultado(page, {
    timeoutMs: 2_500,
    processingTimeoutMs: 3_000,
    pollIntervalMs: 50,
    retryAfterMs: 300,
    maxRetryClicks: 2,
    onRetryClick: async () => {
      recliques += 1;
    },
  });

  assert.equal(resultado.status, "erro");
  assert.ok(recliques >= 1);
  await page.close();
});

test("encerra rápido quando o portal volta ao formulário após confirmar a análise", async () => {
  const page = await browser.newPage();
  await page.setContent("<main>Analisando crédito</main>");
  await page.evaluate(() => {
    setTimeout(() => {
      document.body.innerHTML = "<main><button>Fazer análise</button></main>";
    }, 150);
  });

  let recliques = 0;
  const inicio = Date.now();
  const resultado = await parseResultado(page, {
    timeoutMs: 2_000,
    processingTimeoutMs: 5_000,
    pollIntervalMs: 50,
    providerResetStableMs: 300,
    onRetryClick: async () => {
      recliques += 1;
    },
  });

  assert.equal(resultado.status, "erro");
  assert.match(resultado.mensagem, /encerrou a análise/i);
  assert.equal(resultado.rawSummary.motivoTecnico, "provider_returned_to_form");
  assert.equal(recliques, 0);
  assert.ok(Date.now() - inicio < 4_000);
  await page.close();
});

test("identifica o erro interno do parceiro para permitir uma recuperação controlada", async () => {
  const page = await browser.newPage();
  await page.setContent(
    "<main><button>Fazer análise</button><p>Ocorreu um erro interno. Por favor, tente novamente mais tarde.</p></main>",
  );

  const resultado = await parseResultado(page, {
    timeoutMs: 200,
    processingTimeoutMs: 200,
    pollIntervalMs: 10,
  });

  assert.equal(resultado.status, "erro");
  assert.equal(resultado.rawSummary.motivoTecnico, "provider_internal_error");
  assert.match(resultado.mensagem, /instabilidade interna/i);
  await page.close();
});
