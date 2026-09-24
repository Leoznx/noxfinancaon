import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import {
  detectAuthenticationState,
  fillCep,
  fillDocumento,
  fillPessoa,
  fillTipoImovel,
  fillValores,
  hasVisibleCaptchaChallenge,
  isCreditSimulationUrl,
  isErpCreditSimulationUrl,
  submitSimulation,
  validateSimulationFormReady,
} from "./credpagoSelectors";
import {
  assertCreditSimulationAvailable,
  CredPagoAccountBlockedError,
  isCreditSimulationAccountBlockedText,
} from "./credpagoAvailability";

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
    "<main><button>Pessoa Física</button><label>CPF<input /></label><button>Simular Crédito</button></main>",
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
    "<main><button>Pessoa Física</button><label>CPF<input /></label><button>Simular Crédito</button></main>",
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

test("preenche e valida o formulário ERP incluindo o CEP abaixo da dobra", async () => {
  const url = "https://app.loft.com.br/erp/proposta/analise-de-credito";
  const page = await pageWithHtml(
    url,
    `<main>
      <h1>Análise de crédito</h1>
      <section aria-label="Dados do Inquilino">
        <button type="button">Pessoa física</button>
        <button type="button">Pessoa jurídica</button>
        <label>CPF*<input /></label>
      </section>
      <section aria-label="Dados do Imóvel">
        <span>Tipo do imóvel *</span>
        <button type="button">Residencial</button>
        <button type="button">Comercial</button>
        <label>CEP<input placeholder="00000-000" /></label>
        <label>Valor Aluguel<input placeholder="R$ 0.000,00" /></label>
      </section>
      <button type="button" onclick="document.body.dataset.submitted='true'">Simular análise de crédito</button>
    </main>`,
  );

  assert.equal(isCreditSimulationUrl(url), true);
  assert.equal(isErpCreditSimulationUrl(url), true);
  assert.equal(await detectAuthenticationState(page, 300), "authenticated");
  assert.deepEqual(await validateSimulationFormReady(page), {
    documento: true,
    cep: true,
    aluguel: true,
    simular: true,
  });

  await fillPessoa(page, "PF");
  await fillDocumento(page, "11144477735", "PF");
  await fillTipoImovel(page, "Residencial");
  await fillCep(page, "01001000");
  await fillValores(page, { aluguel: 1750, condominio: 0, taxas: 0 });
  await submitSimulation(page);

  assert.equal(await page.getByLabel(/cpf/i).inputValue(), "11144477735");
  assert.equal(await page.getByLabel(/cep/i).inputValue(), "01001000");
  assert.equal(await page.getByLabel(/valor aluguel/i).inputValue(), "1750,00");
  assert.equal(await page.locator("body").getAttribute("data-submitted"), "true");
  await page.close();
});

test("envia pelo botão Fazer análise sem clicar no texto explicativo que contém simular o crédito", async () => {
  const url = "https://app.loft.com.br/erp/proposta/analise-de-credito";
  const page = await pageWithHtml(
    url,
    `<main>
      <p>Preencha os dados do imóvel e do inquilino para simular o crédito.</p>
      <button type="button" onclick="document.body.dataset.submitted='true'">Fazer análise</button>
    </main>`,
  );

  await submitSimulation(page);

  assert.equal(await page.locator("body").getAttribute("data-submitted"), "true");
  await page.close();
});

test("aguarda o botão Fazer análise ficar habilitado antes de enviar", async () => {
  const url = "https://app.loft.com.br/erp/proposta/analise-de-credito";
  const page = await pageWithHtml(
    url,
    `<main>
      <button type="button" disabled onclick="document.body.dataset.submitted='true'">Fazer análise</button>
      <script>setTimeout(() => document.querySelector('button').disabled = false, 100)</script>
    </main>`,
  );

  await submitSimulation(page);

  assert.equal(await page.locator("body").getAttribute("data-submitted"), "true");
  await page.close();
});

test("preenche a máscara monetária em reais sem reduzir o valor em cem vezes", async () => {
  const url = "https://app.loft.com.br/erp/proposta/analise-de-credito";
  const page = await pageWithHtml(
    url,
    `<main>
      <label>Valor mensal do aluguel<input id="aluguel" placeholder="R$ 0.000,00" /></label>
      <button id="submit" type="button" disabled>Fazer análise</button>
      <script>
        document.querySelector('#aluguel').addEventListener('input', (event) => {
          const input = event.currentTarget;
          const cents = Number(input.value.replace(/\\D/g, ''));
          input.value = new Intl.NumberFormat('pt-BR', {
            style: 'currency', currency: 'BRL'
          }).format(cents / 100);
          document.querySelector('#submit').disabled = cents < 10000;
        });
      </script>
    </main>`,
  );

  await fillValores(page, { aluguel: 1880, condominio: 0, taxas: 0 });

  assert.equal(await page.getByLabel(/aluguel/i).inputValue(), "R$ 1.880,00");
  assert.equal(await page.getByRole("button", { name: /fazer análise/i }).isEnabled(), true);
  await page.close();
});

test("preenche aluguel, condomínio e IPTU separadamente quando as coberturas ERP estão ligadas", async () => {
  const url = "https://app.loft.com.br/erp/proposta/analise-de-credito";
  const page = await pageWithHtml(
    url,
    `<main>
      <label>Valor mensal do aluguel<input id="aluguel" placeholder="R$ 0.000,00" /></label>
      <label data-testid="property-condominium-coverage-toggle">
        Incluir cobertura<input id="condominio-toggle" type="checkbox" checked />
      </label>
      <label>Condomínio<input data-testid="property-condominium-value" id="condominio" placeholder="R$ 0.000,00" /></label>
      <label data-testid="property-iptu-coverage-toggle">
        Incluir cobertura<input id="iptu-toggle" type="checkbox" checked />
      </label>
      <label>IPTU<input data-testid="property-iptu-value" id="iptu" placeholder="R$ 0.000,00" /></label>
    </main>`,
  );

  await fillValores(page, { aluguel: 1500, condominio: 380, taxas: 460 });

  assert.equal(await page.locator("#aluguel").inputValue(), "1500,00");
  assert.equal(await page.locator("#condominio").inputValue(), "380,00");
  assert.equal(await page.locator("#iptu").inputValue(), "460,00");
  assert.equal(await page.locator("#condominio-toggle").isChecked(), true);
  assert.equal(await page.locator("#iptu-toggle").isChecked(), true);
  await page.close();
});

test("desliga coberturas ERP sem valor para liberar o formulário", async () => {
  const url = "https://app.loft.com.br/erp/proposta/analise-de-credito";
  const page = await pageWithHtml(
    url,
    `<main>
      <label>Valor mensal do aluguel<input id="aluguel" placeholder="R$ 0.000,00" /></label>
      <label data-testid="property-condominium-coverage-toggle">
        Incluir cobertura<input id="condominio-toggle" type="checkbox" onchange="if (!this.checked) document.querySelector('#condominio').disabled = true" />
      </label>
      <label>Condomínio<input data-testid="property-condominium-value" id="condominio" placeholder="R$ 0.000,00" /></label>
      <label data-testid="property-iptu-coverage-toggle">
        Incluir cobertura<input id="iptu-toggle" type="checkbox" onchange="if (!this.checked) document.querySelector('#iptu').disabled = true" />
      </label>
      <label>IPTU<input data-testid="property-iptu-value" id="iptu" placeholder="R$ 0.000,00" /></label>
    </main>`,
  );

  await fillValores(page, { aluguel: 1880, condominio: 0, taxas: 0 });

  assert.equal(await page.locator("#aluguel").inputValue(), "1880,00");
  assert.equal(await page.locator("#condominio").isEnabled(), false);
  assert.equal(await page.locator("#iptu").isEnabled(), false);
  assert.equal(await page.locator("#condominio").inputValue(), "");
  assert.equal(await page.locator("#iptu").inputValue(), "");
  await page.close();
});

test("ajusta switches internos do portal novo mesmo quando o campo de valor continua habilitado", async () => {
  const url = "https://app.loft.com.br/erp/proposta/analise-de-credito";
  const page = await pageWithHtml(
    url,
    `<main>
      <label>Valor mensal do aluguel<input id="aluguel" placeholder="R$ 0.000,00" /></label>
      <div data-testid="property-condominium-coverage-toggle">
        Incluir cobertura de condomínio
        <button id="condominio-toggle" type="button" role="switch" aria-checked="true"
          onclick="this.setAttribute('aria-checked', String(this.getAttribute('aria-checked') !== 'true'))">Alternar</button>
      </div>
      <label>Condomínio<input data-testid="property-condominium-value" id="condominio" placeholder="R$ 0.000,00" /></label>
      <div data-testid="property-iptu-coverage-toggle">
        Incluir cobertura de IPTU
        <button id="iptu-toggle" type="button" role="switch" aria-checked="true"
          onclick="this.setAttribute('aria-checked', String(this.getAttribute('aria-checked') !== 'true'))">Alternar</button>
      </div>
      <label>IPTU<input data-testid="property-iptu-value" id="iptu" placeholder="R$ 0.000,00" /></label>
    </main>`,
  );

  await fillValores(page, { aluguel: 1880, condominio: 0, taxas: 0 });

  assert.equal(await page.locator("#aluguel").inputValue(), "1880,00");
  assert.equal(await page.locator("#condominio-toggle").getAttribute("aria-checked"), "false");
  assert.equal(await page.locator("#iptu-toggle").getAttribute("aria-checked"), "false");
  assert.equal(await page.locator("#condominio").isEnabled(), true);
  assert.equal(await page.locator("#iptu").isEnabled(), true);
  await page.close();
});

test("só sinaliza envio quando o botão Fazer análise realmente será clicado", async () => {
  const url = "https://app.loft.com.br/erp/proposta/analise-de-credito";
  const page = await pageWithHtml(
    url,
    `<main><button type="button" onclick="document.body.dataset.submitted='true'">Fazer análise</button></main>`,
  );
  let beforeClickCalled = false;

  await submitSimulation(page, {
    onBeforeClick: () => {
      beforeClickCalled = true;
    },
  });

  assert.equal(beforeClickCalled, true);
  assert.equal(await page.locator("body").getAttribute("data-submitted"), "true");
  await page.close();
});

test("não reconhece uma URL externa parecida como tela de simulação", () => {
  assert.equal(isCreditSimulationUrl("https://example.com/erp/proposta/analise-de-credito"), false);
});

test("reconhece o bloqueio comercial da Loft antes de procurar seletores", async () => {
  const aviso =
    "Liberação necessária para criar contratos. A plataforma de fiança está bloqueada para criação de contratos nesta conta. Para continuar, solicite a liberação ao time comercial da Loft.";
  assert.equal(isCreditSimulationAccountBlockedText(aviso), true);

  const page = await pageWithHtml(
    "https://app.loft.com.br/fianca-aluguel/imobiliaria/cr/index.php",
    `<main><h1>Liberação necessária para criar contratos</h1><p>${aviso}</p></main>`,
  );
  await assert.rejects(() => assertCreditSimulationAvailable(page), CredPagoAccountBlockedError);
  await page.close();
});

test("não confunde o aviso legal do reCAPTCHA com um desafio ativo", async () => {
  const page = await pageWithHtml(
    "https://sso.loft.com.br/realms/loft/login",
    "<main><p>Confira a Política de Privacidade e os Termos por usarmos o reCAPTCHA.</p></main>",
  );
  assert.equal(await hasVisibleCaptchaChallenge(page), false);
  await page.close();
});

test("reconhece um desafio visual real do reCAPTCHA", async () => {
  const page = await pageWithHtml(
    "https://sso.loft.com.br/realms/loft/login",
    '<main><iframe title="reCAPTCHA challenge expires in two minutes"></iframe></main>',
  );
  assert.equal(await hasVisibleCaptchaChallenge(page), true);
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
