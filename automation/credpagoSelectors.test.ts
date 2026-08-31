import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import { detectAuthenticationState, fillValores } from "./credpagoSelectors";

let browser: Browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser.close();
});

async function pageWithHtml(url: string, html: string) {
  const page = await browser.newPage();
  // charset=utf-8 explícito: sem ele o navegador tenta adivinhar a codificação
  // do body e pode ler "í"/"ç"/"ã" errado (mojibake), quebrando qualquer regex
  // com acento (ex.: /condom[ií]nio/i) mesmo com o HTML de teste correto.
  await page.route(url, (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }),
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

// A tela de simulação migrou de credpago.com para app.loft.com.br (ver CREDPAGO_URL em
// env.ts) — os quatro testes acima continuam cobrindo o hostname antigo (aceito por
// compatibilidade); estes repetem os mesmos casos no hostname novo, que é o real hoje.

test("não confunde a página pública hidratando com uma sessão autenticada (app.loft.com.br)", async () => {
  const page = await pageWithHtml(
    "https://app.loft.com.br/fianca-aluguel/imobiliaria/proposta",
    "<main><h1>Bem-vindo</h1><p>Acesse sua conta para continuar.</p></main>",
  );
  assert.equal(await detectAuthenticationState(page, 300), "unknown");
  await page.close();
});

test("reconhece explicitamente a tela de Login Loft (app.loft.com.br)", async () => {
  const page = await pageWithHtml(
    "https://app.loft.com.br/fianca-aluguel/imobiliaria/proposta",
    '<main><button type="button">Login Loft</button></main>',
  );
  assert.equal(await detectAuthenticationState(page, 300), "login");
  await page.close();
});

test("reconhece o formulário de simulação como sessão autenticada (app.loft.com.br)", async () => {
  const page = await pageWithHtml(
    "https://app.loft.com.br/fianca-aluguel/imobiliaria/proposta",
    '<main><button>Pessoa Física</button><label>CPF<input /></label><button>Simular Crédito</button></main>',
  );
  assert.equal(await detectAuthenticationState(page, 300), "authenticated");
  await page.close();
});

test("reconhece a rota interna autenticada após o SSO (app.loft.com.br)", async () => {
  const page = await pageWithHtml(
    "https://app.loft.com.br/fianca-aluguel/imobiliaria/cr/index.php",
    "<main><h1>Painel da imobiliária</h1></main>",
  );
  assert.equal(await detectAuthenticationState(page, 300), "authenticated");
  await page.close();
});

// Regressão de produção: um link de navegação com aria-label="Ir para Fiança
// Aluguel" no topo da página passou a bater com getByLabel(/aluguel/i) antes
// do campo "Aluguel" de verdade, e a automação tentava preencher o link
// (erro do Playwright: "Element is not an <input>...") em vez do campo —
// toda consulta terminava em "erro" na mesma hora. fillValores precisa achar
// o input de verdade mesmo com esse link ambíguo na página.
test("preenche o campo Aluguel de verdade, mesmo com um link de navegação cujo aria-label também contém 'aluguel'", async () => {
  const page = await pageWithHtml(
    "https://app.loft.com.br/fianca-aluguel/imobiliaria/proposta",
    `<header><a aria-label="Ir para Fiança Aluguel" href="/fianca-aluguel/imobiliaria/cr/index.php">Logo</a></header>
     <main>
       <label>Aluguel<input /></label>
       <label>Condomínio<input /></label>
       <label>Taxas<input /></label>
     </main>`,
  );
  await fillValores(page, { aluguel: 1500, condominio: 200, taxas: 50 });
  const inputs = page.locator("main input");
  assert.equal(await inputs.nth(0).inputValue(), "1500");
  assert.equal(await inputs.nth(1).inputValue(), "200");
  assert.equal(await inputs.nth(2).inputValue(), "50");
  await page.close();
});
