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
  lookupLegacyProposalResult,
  openLegacyCreditSimulation,
  submitSimulation,
  validateLegacySimulationFormReady,
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
        <label>CNPJ*<input /></label>
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
    cnpj: true,
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

test("envia pelo botão Iniciar análise usado na versão atual do portal", async () => {
  const url = "https://app.loft.com.br/erp/proposta/analise-de-credito";
  const page = await pageWithHtml(
    url,
    `<main>
      <button type="button" onclick="document.body.dataset.submitted='true'">Iniciar análise</button>
    </main>`,
  );

  await submitSimulation(page);

  assert.equal(await page.locator("body").getAttribute("data-submitted"), "true");
  await page.close();
});

test("inicializa a sessão legada e preenche todos os controles reais de CNPJ", async () => {
  const businessUrl = "https://app.loft.com.br/fianca-aluguel/imobiliaria/proposta";
  const dashboardUrl = "https://app.loft.com.br/fianca-aluguel/imobiliaria/cr/index.php";
  const page = await browser.newPage();
  let acessosAoFormulario = 0;
  await page.route(dashboardUrl, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: "<main><h1>Painel da imobiliária</h1></main>",
    }),
  );
  await page.route(businessUrl, (route) => {
    acessosAoFormulario += 1;
    if (acessosAoFormulario === 1) {
      return route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: `<script>window.location.replace(${JSON.stringify(dashboardUrl)})</script>`,
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<main>
        <h1>Informe os dados para análise</h1>
        <fieldset>
          <legend>Dados do inquilino</legend>
          <label><input type="radio" name="dadosPessoa.tipoPessoa" value="PF" onclick="setPerson('PF')" />Pessoa física</label>
          <label><input type="radio" name="dadosPessoa.tipoPessoa" value="PJ" onclick="setPerson('PJ')" />Pessoa jurídica</label>
          <label id="document-label">CPF<input id="document" name="dadosPessoa.pessoas.0.documento" aria-label="CPF" placeholder="000.000.000-00" /></label>
        </fieldset>
        <fieldset>
          <legend>Dados da locação</legend>
          <label><input type="radio" name="dadosImovel.tipoImovel" value="Residencial" />Residencial</label>
          <label><input type="radio" name="dadosImovel.tipoImovel" value="Comercial" />Comercial</label>
          <label>CEP do local *<input id="cep" aria-label="CEP do local" placeholder="00.000-000" /></label>
          <label>Valor mensal do aluguel<input id="nova-simulacao-aluguel" aria-label="Valor mensal do aluguel" placeholder="0,00" /></label>
          <label><input id="nova-simulacao-coverage-switch-condominio-Label" type="checkbox" />Incluir condomínio</label>
          <label>Valor mensal do condomínio<input id="nova-simulacao-coverage-input-condominio" aria-label="Valor mensal do condomínio" placeholder="0,00" /></label>
          <label><input id="nova-simulacao-coverage-switch-iptu-Label" type="checkbox" />Incluir IPTU</label>
          <label>Valor mensal do IPTU e taxas adicionais<input id="nova-simulacao-coverage-input-iptu" aria-label="Valor mensal do IPTU e taxas adicionais" placeholder="0,00" /></label>
        </fieldset>
        <button type="button" onclick="document.body.dataset.submitted='true'">Fazer análise</button>
        <script>
          function setPerson(type) {
            const label = document.querySelector('#document-label');
            const input = document.querySelector('#document');
            const title = type === 'PJ' ? 'CNPJ' : 'CPF';
            label.firstChild.textContent = title;
            input.setAttribute('aria-label', title);
            input.placeholder = type === 'PJ' ? '00.000.000/0000-00' : '000.000.000-00';
          }
          for (const input of document.querySelectorAll('input[placeholder="0,00"]')) {
            input.addEventListener('input', (event) => {
              const digits = event.currentTarget.value.replace(/\\D/g, '');
              event.currentTarget.value = digits
                ? Number(digits).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
                : '';
            });
          }
        </script>
      </main>`,
    });
  });

  await openLegacyCreditSimulation(page, businessUrl, 4_000);
  assert.equal(acessosAoFormulario, 2);
  assert.equal(page.url(), businessUrl);
  assert.deepEqual(await validateLegacySimulationFormReady(page), {
    pessoaFisica: true,
    pessoaJuridica: true,
    documento: true,
    residencial: true,
    comercial: true,
    cep: true,
    aluguel: true,
    condominio: true,
    iptu: true,
    simular: true,
  });
  await fillPessoa(page, "PJ");
  await fillDocumento(page, "12936344000196", "PJ");
  await fillTipoImovel(page, "Comercial");
  await fillCep(page, "88340001");
  await fillValores(page, { aluguel: 3000, condominio: 0, taxas: 0 });
  await submitSimulation(page);

  assert.equal(await page.getByLabel(/cnpj/i).inputValue(), "12936344000196");
  assert.equal(await page.getByLabel(/cep/i).inputValue(), "88340001");
  assert.equal(await page.getByLabel(/aluguel/i).inputValue(), "3.000,00");
  assert.equal(
    await page.locator("#nova-simulacao-coverage-switch-condominio-Label").isChecked(),
    true,
  );
  assert.equal(await page.locator("#nova-simulacao-coverage-switch-iptu-Label").isChecked(), true);
  assert.equal(await page.locator("body").getAttribute("data-submitted"), "true");
  await page.close();
});

test("recupera da lista o resultado criado pelo formulário legado", async () => {
  const proposalsUrl = "https://app.loft.com.br/fianca-aluguel/imobiliaria/view/index.php";
  const page = await browser.newPage();
  await page.route(proposalsUrl, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<main>
        <label>Proposta, nome/razão social, CPF/CNPJ ou tag
          <input placeholder="Proposta, nome/razão social, CPF/CNPJ ou tag" />
        </label>
        <button type="button">Pesquisar</button>
        <table><tbody><tr>
          <td><a href="/fianca-aluguel/imobiliaria/proposta/4783753">4783753</a></td>
          <td>Empresa teste<br />CNPJ: 12.936.344/0001-96</td>
          <td>Rascunho • Aprovado</td>
        </tr></tbody></table>
      </main>`,
    }),
  );

  assert.deepEqual(await lookupLegacyProposalResult(page, "12.936.344/0001-96", 2_000), {
    status: "aprovado",
    proposalId: "4783753",
    clienteNome: "Empresa teste",
  });
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

test("não alterna novamente um switch sem estado semântico observável", async () => {
  const url = "https://app.loft.com.br/erp/proposta/analise-de-credito";
  const page = await pageWithHtml(
    url,
    `<main>
      <label>Valor mensal do aluguel<input id="aluguel" placeholder="R$ 0.000,00" /></label>
      <div data-testid="property-condominium-coverage-toggle">
        <button id="condominio-toggle" type="button"
          onclick="this.dataset.clickCount = String(Number(this.dataset.clickCount || 0) + 1)">Alternar condomínio</button>
      </div>
      <label>Condomínio<input data-testid="property-condominium-value" id="condominio" /></label>
      <div data-testid="property-iptu-coverage-toggle">
        <button id="iptu-toggle" type="button"
          onclick="this.dataset.clickCount = String(Number(this.dataset.clickCount || 0) + 1)">Alternar IPTU</button>
      </div>
      <label>IPTU<input data-testid="property-iptu-value" id="iptu" /></label>
    </main>`,
  );

  await fillValores(page, { aluguel: 1880, condominio: 0, taxas: 0 });

  assert.equal(await page.locator("#condominio-toggle").getAttribute("data-click-count"), "1");
  assert.equal(await page.locator("#iptu-toggle").getAttribute("data-click-count"), "1");
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
