import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import { parseResultado } from "./credpagoParser";

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
    }, 80);
  });

  let recliques = 0;
  const resultado = await parseResultado(page, {
    timeoutMs: 40,
    processingTimeoutMs: 250,
    pollIntervalMs: 10,
    retryAfterMs: 20,
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

test("mantém o reclique de recuperação quando o formulário realmente fica parado", async () => {
  const page = await browser.newPage();
  await page.setContent("<main><button>Simular Crédito</button></main>");

  let recliques = 0;
  const resultado = await parseResultado(page, {
    timeoutMs: 90,
    processingTimeoutMs: 200,
    pollIntervalMs: 10,
    retryAfterMs: 20,
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
    }, 30);
  });

  let recliques = 0;
  const inicio = Date.now();
  const resultado = await parseResultado(page, {
    timeoutMs: 60,
    processingTimeoutMs: 500,
    pollIntervalMs: 10,
    providerResetStableMs: 30,
    onRetryClick: async () => {
      recliques += 1;
    },
  });

  assert.equal(resultado.status, "erro");
  assert.match(resultado.mensagem, /encerrou a análise/i);
  assert.equal(resultado.rawSummary.motivoTecnico, "provider_returned_to_form");
  assert.equal(recliques, 0);
  assert.ok(Date.now() - inicio < 250);
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
