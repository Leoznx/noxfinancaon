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
  await page.setContent("<main>Estamos fazendo a análise de crédito...</main>");
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
