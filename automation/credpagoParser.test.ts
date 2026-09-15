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
