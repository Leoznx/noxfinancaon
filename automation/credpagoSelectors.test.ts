import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import { detectAuthenticationState } from "./credpagoSelectors";

let browser: Browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser.close();
});

async function pageWithHtml(url: string, html: string) {
  const page = await browser.newPage();
  await page.route(url, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: html }),
  );
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return page;
}

test("não confunde a página pública hidratando com uma sessão autenticada", async () => {
  const page = await pageWithHtml(
    "https://credpago.com/imobiliaria/proposta",
    "<main><h1>Bem-vindo à CredPago</h1><p>Acesse sua conta para continuar.</p></main>",
  );
  assert.equal(await detectAuthenticationState(page, 300), "unknown");
  await page.close();
});

test("reconhece explicitamente a tela de Login Loft", async () => {
  const page = await pageWithHtml(
    "https://credpago.com/imobiliaria/proposta",
    '<main><button type="button">Login Loft</button></main>',
  );
  assert.equal(await detectAuthenticationState(page, 300), "login");
  await page.close();
});

test("reconhece o formulário de simulação como sessão autenticada", async () => {
  const page = await pageWithHtml(
    "https://credpago.com/imobiliaria/proposta",
    '<main><button>Pessoa Física</button><label>CPF<input /></label><button>Simular Crédito</button></main>',
  );
  assert.equal(await detectAuthenticationState(page, 300), "authenticated");
  await page.close();
});

test("reconhece a rota interna autenticada após o SSO", async () => {
  const page = await pageWithHtml(
    "https://credpago.com/imobiliaria/cr/index.php",
    "<main><h1>Painel da imobiliária</h1></main>",
  );
  assert.equal(await detectAuthenticationState(page, 300), "authenticated");
  await page.close();
});
