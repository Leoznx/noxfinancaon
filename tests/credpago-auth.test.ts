import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import {
  detectAuthenticationState,
  isLoginPage,
  loginWithCredentials,
} from "../automation/credpagoSelectors";

test("detecta a nova porta de entrada Login Loft", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent('<button type="button">Login Loft</button>');
    assert.equal(await isLoginPage(page), true);
    assert.equal(await detectAuthenticationState(page, 1_000), "login");
  } finally {
    await browser.close();
  }
});

test("renova a sessão pelo formulário atual do Login Loft", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.route("https://credpago.com/imobiliaria/proposta", async (route) => {
      await route.fulfill({
        contentType: "text/html",
        body: `
          <button id="login-loft" type="button">Login Loft</button>
          <script>
            document.querySelector("#login-loft").addEventListener("click", () => {
              document.body.innerHTML = \`
                <label>E-mail ou telefone
                  <input aria-label="E-mail ou telefone" />
                </label>
                <label>Senha
                  <input aria-label="Senha" placeholder="********" type="password" />
                </label>
                <button id="entrar" type="button">Entrar</button>
              \`;
              document.querySelector("#entrar").addEventListener("click", () => {
                window.__loginRecebido = document.querySelector(
                  '[aria-label="E-mail ou telefone"]'
                ).value;
                window.__senhaRecebida = document.querySelector('[aria-label="Senha"]').value;
                document.body.innerHTML = "<main>Área da imobiliária autenticada</main>";
              });
            });
          </script>
        `,
      });
    });

    await page.goto("https://credpago.com/imobiliaria/proposta");
    await loginWithCredentials(page, "conta@nox.test", "senha-segura", 2_000);

    const submitted = await page.evaluate(() => ({
      login: (window as typeof window & { __loginRecebido?: string }).__loginRecebido,
      password: (window as typeof window & { __senhaRecebida?: string }).__senhaRecebida,
    }));
    assert.deepEqual(submitted, {
      login: "conta@nox.test",
      password: "senha-segura",
    });
    assert.equal(await detectAuthenticationState(page, 1_000), "authenticated");
  } finally {
    await browser.close();
  }
});
