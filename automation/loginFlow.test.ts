import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { LoftLoginChallengeError, loginWithCredentials } from "./credpagoSelectors";

let browser: Browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser.close();
});

const LOGIN_URL = "https://app.loft.com.br/fianca-aluguel/imobiliaria/login.php";
const HOME_URL = "https://app.loft.com.br/fianca-aluguel/imobiliaria/cr/index.php";

/**
 * Serve uma tela de Login Loft simulada e a área autenticada. `submitSection` é o
 * trecho do formulário que envia o login; `script` define o comportamento da página.
 */
async function loginPage(options: { submitSection: string; script: string }): Promise<Page> {
  const page = await browser.newPage();
  await page.route("**/*", (route) => {
    const { pathname } = new URL(route.request().url());
    const body = pathname.endsWith("/cr/index.php")
      ? "<main><h1>Painel da imobiliária</h1></main>"
      : `<main>
          <form id="login">
            <label>E-mail ou telefone <input type="text" name="login" autocomplete="username" /></label>
            <label>Senha <input type="password" name="senha" placeholder="********" /></label>
            ${options.submitSection}
          </form>
          <p id="mensagem"></p>
        </main>
        <script>
          window.submissoes = 0;
          ${options.script}
        </script>`;
    return route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body,
    });
  });
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
  return page;
}

const successScript = `
  function enviar() { window.submissoes += 1; location.href = "${HOME_URL}"; }
  document.getElementById("login").addEventListener("submit", (e) => { e.preventDefault(); enviar(); });
`;

test("entra no Login Loft pelo botão de envio com um rótulo dentro de um elemento interno", async () => {
  const page = await loginPage({
    submitSection: '<button type="submit"><span>Entrar</span></button>',
    script: successScript,
  });

  await loginWithCredentials(page, "equipe@exemplo.com.br", "senha-de-teste", 20_000);

  assert.equal(page.url(), HOME_URL);
  await page.close();
});

test("aguarda o botão ser montado depois do preenchimento em vez de falhar na primeira checagem", async () => {
  const page = await loginPage({
    submitSection: '<div id="area-botao"></div>',
    script: `
      ${successScript}
      // O botão só aparece algum tempo depois, como num formulário React que ainda valida os campos.
      setTimeout(() => {
        document.getElementById("area-botao").innerHTML = '<button type="submit">Entrar</button>';
      }, 1500);
    `,
  });

  await loginWithCredentials(page, "equipe@exemplo.com.br", "senha-de-teste", 25_000);

  assert.equal(page.url(), HOME_URL);
  await page.close();
});

test("usa Enter no campo de senha quando o portal não expõe nenhum botão de envio", async () => {
  const page = await loginPage({
    submitSection: "",
    script: `
      ${successScript}
      document.querySelector('input[type="password"]').addEventListener("keydown", (e) => {
        if (e.key === "Enter") enviar();
      });
    `,
  });

  await loginWithCredentials(page, "equipe@exemplo.com.br", "senha-de-teste", 30_000);

  assert.equal(page.url(), HOME_URL);
  await page.close();
});

test("aguarda o botão ser habilitado pela validação do formulário", async () => {
  const page = await loginPage({
    submitSection: '<button type="submit" id="entrar" disabled>Entrar</button>',
    script: `
      ${successScript}
      const senha = document.querySelector('input[type="password"]');
      senha.addEventListener("input", () => {
        if (senha.value.length > 3) setTimeout(() => { document.getElementById("entrar").disabled = false; }, 600);
      });
    `,
  });

  await loginWithCredentials(page, "equipe@exemplo.com.br", "senha-de-teste", 25_000);

  assert.equal(page.url(), HOME_URL);
  await page.close();
});

test("não insiste no login quando o provedor pede uma verificação humana", async () => {
  const page = await loginPage({
    submitSection: '<button type="submit">Entrar</button>',
    script: `
      document.getElementById("login").addEventListener("submit", (e) => {
        e.preventDefault();
        window.submissoes += 1;
        document.getElementById("mensagem").textContent = "Confirme que você não é um robô.";
      });
    `,
  });

  await assert.rejects(
    loginWithCredentials(page, "equipe@exemplo.com.br", "senha-de-teste", 20_000),
    (error: unknown) => error instanceof LoftLoginChallengeError && error.kind === "captcha",
  );

  // Uma única tentativa: reenviar o formulário só acumularia tentativas contra a conta.
  assert.equal(await page.evaluate(() => (window as unknown as { submissoes: number }).submissoes), 1);
  await page.close();
});

test("distingue credencial recusada de CAPTCHA", async () => {
  const page = await loginPage({
    submitSection: '<button type="submit">Entrar</button>',
    script: `
      document.getElementById("login").addEventListener("submit", (e) => {
        e.preventDefault();
        window.submissoes += 1;
        document.getElementById("mensagem").textContent = "Credenciais inválidas. Tente novamente.";
      });
    `,
  });

  await assert.rejects(
    loginWithCredentials(page, "equipe@exemplo.com.br", "senha-errada", 20_000),
    (error: unknown) =>
      error instanceof LoftLoginChallengeError && error.kind === "invalid_credentials",
  );
  assert.equal(await page.evaluate(() => (window as unknown as { submissoes: number }).submissoes), 1);
  await page.close();
});
