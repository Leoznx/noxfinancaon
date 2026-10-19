import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { chromium } from "playwright";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDirectory, ".env") });
dotenv.config({ path: path.resolve(scriptDirectory, "..", ".env") });

const currentCreditSimulationUrl = "https://app.loft.com.br/erp/proposta/analise-de-credito";
const configuredCreditSimulationUrl = process.env.CREDPAGO_URL?.trim() || "";
const credpagoUrl =
  !configuredCreditSimulationUrl ||
  /^(?:https?:\/\/)?(?:www\.)?(?:credpago\.com\/imobiliaria\/proposta|app\.loft\.com\.br\/fianca-aluguel\/imobiliaria(?:\/proposta)?)[/?#]?$/i.test(
    configuredCreditSimulationUrl,
  )
    ? currentCreditSimulationUrl
    : configuredCreditSimulationUrl;
const storageStatePath =
  process.env.CREDPAGO_STORAGE_STATE_PATH || path.resolve(scriptDirectory, "credpago-session.json");
const otpFile =
  process.env.CREDPAGO_OTP_FILE || path.resolve(path.dirname(storageStatePath), "credpago-otp.txt");
const login = process.env.CREDPAGO_LOGIN;
const password = process.env.CREDPAGO_PASSWORD;
const otpTimeoutMs = Number(process.env.AUTH_OTP_TIMEOUT_MS) || 10 * 60 * 1000;
const interactiveTimeoutMs = Number(process.env.AUTH_INTERACTIVE_TIMEOUT_MS) || 10 * 60 * 1000;
const interactiveHeadless = process.env.INTERACTIVE_HEADLESS === "true";

if (Boolean(login) !== Boolean(password)) {
  throw new Error("CREDPAGO_LOGIN e CREDPAGO_PASSWORD precisam ser configuradas juntas.");
}

// Este utilitário existe justamente para desafios que exigem uma pessoa (captcha/OTP).
// O worker de produção continua headless e nunca tenta contornar essas verificações.
const browser = await chromium.launch({
  headless: interactiveHeadless,
});
const contextOptions = { viewport: { width: 1366, height: 900 } };
if (
  await fs
    .access(storageStatePath)
    .then(() => true)
    .catch(() => false)
) {
  contextOptions.storageState = storageStatePath;
}
let context;
try {
  context = await browser.newContext(contextOptions);
} catch (error) {
  // Um arquivo anterior corrompido não pode impedir um novo login.
  console.log(`Sessão anterior ignorada (${error?.message?.split("\n")[0] ?? "inválida"}).`);
  delete contextOptions.storageState;
  context = await browser.newContext(contextOptions);
}
const page = await context.newPage();

// Rotas do SSO/login (inclusive o callback OIDC, que ainda é transitório) nunca são "autenticado".
const loginRoute = /(?:^|\/)login(?:\.php)?(?:\/|$)|\/oidc\/|\/realms\//i;
// Áreas internas renderizadas pelo servidor: sem sessão o portal redireciona para o login,
// então a URL (sem nenhuma tela de login visível) é um sinal confiável.
const serverRenderedInternalRoute = /\/imobiliaria\/(?:cr|dashboard|home|view)(?:\/|$)/i;
const erpAnalysisRoute = /\/erp\/proposta\/analise-de-credito(?:\/|$)/i;
const fiancaProposalRoute = /\/fianca-aluguel\/imobiliaria\/proposta(?:\/|$)/i;
const publicLandingText = /[áa]rea da imobili[áa]ria|[áa]rea do inquilino/i;

async function visible(locator) {
  return locator
    .first()
    .isVisible()
    .catch(() => false);
}

/**
 * O shell das SPAs (ERP e Fiança Aluguel) carrega com a mesma URL mesmo SEM sessão, antes de
 * redirecionar ao SSO. Por isso essas rotas só contam como autenticadas quando o conteúdo
 * real do formulário está visível — uma checagem só por URL salvava uma sessão deslogada.
 */
async function isAuthenticated() {
  let url;
  try {
    url = new URL(page.url());
  } catch {
    return false;
  }
  const credPagoHost = url.hostname === "credpago.com" || url.hostname.endsWith(".credpago.com");
  const loftAppHost = url.hostname === "app.loft.com.br";
  if (!credPagoHost && !loftAppHost) {
    return false;
  }
  if (loginRoute.test(url.pathname)) return false;

  if (await visible(page.getByRole("button", { name: /login\s+loft/i }))) return false;
  if (await visible(page.getByLabel(/senha|password/i))) return false;

  const text = await page
    .locator("body")
    .innerText()
    .then((value) => value.replace(/\s+/g, " ").trim())
    .catch(() => "");
  // A vitrine pública do portal também pode aparecer sem o botão de login por instantes.
  if (publicLandingText.test(text) && /login\s+loft/i.test(text)) return false;

  if (serverRenderedInternalRoute.test(url.pathname)) return text.length > 0;

  if (erpAnalysisRoute.test(url.pathname)) {
    const markers = await Promise.all([
      visible(page.getByRole("heading", { name: /an[aá]lise\s+de\s+cr[ée]dito/i })),
      visible(page.getByText(/dados\s+do\s+inquilino/i)),
      visible(page.getByRole("button", { name: /fazer\s+an[aá]lise/i })),
    ]);
    return markers.filter(Boolean).length >= 2;
  }

  if (fiancaProposalRoute.test(url.pathname)) {
    const markers = await Promise.all([
      visible(page.getByRole("heading", { name: /informe\s+os\s+dados\s+para\s+an[aá]lise/i })),
      visible(page.getByText(/dados\s+do\s+inquilino/i)),
      visible(page.getByText(/dados\s+da\s+loca[cç][aã]o/i)),
      visible(page.getByRole("button", { name: /simular(?:\s+an[aá]lise\s+de)?\s+cr[ée]dito/i })),
    ]);
    return markers.filter(Boolean).length >= 2;
  }

  // Qualquer outra rota interna conhecida do ERP só conta com o shell logado visível.
  if (/\/erp(?:\/|$)/i.test(url.pathname)) return text.length > 300;

  return visible(page.getByRole("button", { name: /simular(?:\s+an[aá]lise\s+de)?\s+cr[ée]dito/i }));
}

// O módulo Fiança Aluguel mantém cookies próprios. Na primeira visita depois do login o
// portal pode devolver ao painel; a segunda navegação abre o formulário de proposta.
const fiancaModuleUrl = "https://app.loft.com.br/fianca-aluguel/imobiliaria/proposta";

async function initializeFiancaModule() {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await page.goto(fiancaModuleUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2_500);
    if (/\/fianca-aluguel\/imobiliaria\/proposta/i.test(new URL(page.url()).pathname)) {
      return await isAuthenticated();
    }
  }
  return false;
}

async function waitForManualAuthentication(timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isAuthenticated()) return true;
    await page.waitForTimeout(1_000);
  }
  return false;
}

async function persistAndFinish() {
  console.log(
    (await initializeFiancaModule()) ? "FIANCA_MODULE_READY" : "FIANCA_MODULE_NOT_CONFIRMED",
  );
  await fs.mkdir(path.dirname(storageStatePath), { recursive: true });
  // Grava em arquivo temporário e troca por rename: o worker da VPS recarrega este arquivo
  // assim que ele muda e nunca pode ler uma cópia pela metade.
  const temporaryPath = `${storageStatePath}.tmp-${process.pid}`;
  await context.storageState({ path: temporaryPath });
  await fs.rename(temporaryPath, storageStatePath);
  console.log("AUTH_SUCCESS");
  console.log(`SESSION_FILE=${storageStatePath}`);
}

async function waitForOtpCode() {
  console.log("OTP_REQUIRED");
  const startedAt = Date.now();
  while (Date.now() - startedAt < otpTimeoutMs) {
    try {
      const code = (await fs.readFile(otpFile, "utf8")).replace(/\D/g, "");
      if (code.length === 6) {
        await fs.rm(otpFile, { force: true });
        return code;
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await page.waitForTimeout(1_000);
  }
  throw new Error("Tempo esgotado aguardando o código de verificação.");
}

try {
  await page.goto(credpagoUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(2_000);

  if (await isAuthenticated()) {
    await persistAndFinish();
    process.exitCode = 0;
  } else {
    const loginLoftButton = page.getByRole("button", { name: /login\s+loft/i });
    if (
      await loginLoftButton
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await loginLoftButton.first().click();
      await Promise.race([
        waitForManualAuthentication(60_000),
        page
          .getByLabel(/e-?mail ou telefone|e-?mail|telefone/i)
          .first()
          .waitFor({ state: "visible", timeout: 60_000 }),
      ]).catch(() => {});
      await page.waitForTimeout(2_000);
    }

    if (await isAuthenticated()) {
      await persistAndFinish();
      process.exitCode = 0;
    } else if (!login || !password) {
      console.log("MANUAL_LOGIN_REQUIRED");
      console.log(
        "Preencha o login e conclua CAPTCHA/OTP na janela. A sessão será salva automaticamente.",
      );
      if (!(await waitForManualAuthentication(interactiveTimeoutMs))) {
        throw new Error("Tempo esgotado aguardando a autenticação manual do portal.");
      }
      await page.goto(credpagoUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(2_000);
      if (!(await isAuthenticated())) {
        throw new Error("A sessão ainda não foi reconhecida pela CredPago.");
      }
      await persistAndFinish();
      process.exitCode = 0;
    } else {
      const loginField = page.getByLabel(/e-?mail ou telefone|e-?mail|telefone/i);
      const passwordField = page.getByLabel(/senha|password/i);
      await loginField.first().waitFor({ state: "visible", timeout: 30_000 });
      await passwordField.first().waitFor({ state: "visible", timeout: 30_000 });
      const loginInput = loginField.first();
      const passwordInput = passwordField.first();

      // O campo controlado do SSO interpreta `fill()` como telefone e trunca
      // e-mails. Eventos reais de teclado mantêm o valor completo no React.
      await loginInput.click();
      await loginInput.press("Control+A");
      await loginInput.press("Backspace");
      await loginInput.pressSequentially(login, { delay: 20 });

      await passwordInput.click();
      await passwordInput.press("Control+A");
      await passwordInput.press("Backspace");
      await passwordInput.pressSequentially(password, { delay: 20 });
      await passwordInput.press("Tab");

      const enterButton = page.getByRole("button", { name: /^entrar$/i });
      if (
        await enterButton
          .first()
          .isDisabled()
          .catch(() => true)
      ) {
        throw new Error("O portal não habilitou o botão Entrar após o preenchimento.");
      }
      await enterButton.first().click({ timeout: 60_000 });

      const captcha = page.locator(
        'iframe[src*="recaptcha"], iframe[title*="captcha" i], [class*="captcha" i]',
      );
      if (
        await captcha
          .first()
          .isVisible()
          .catch(() => false)
      ) {
        console.log("CAPTCHA_MANUAL_REQUIRED");
        console.log(
          "Conclua a verificação na janela do navegador. A sessão será salva automaticamente.",
        );
      }

      await Promise.race([
        waitForManualAuthentication(interactiveTimeoutMs),
        page
          .getByText(/insira o c[oó]digo enviado/i)
          .first()
          .waitFor({ state: "visible", timeout: interactiveTimeoutMs })
          .catch(() => {}),
      ]);
      await page.waitForTimeout(2_000);

      if (!(await isAuthenticated())) {
        const otpHeading = page.getByText(/insira o c[oó]digo enviado/i);
        if (
          !(await otpHeading
            .first()
            .isVisible()
            .catch(() => false))
        ) {
          throw new Error("O portal não avançou para a verificação esperada.");
        }

        if (!interactiveHeadless) {
          console.log("OTP_MANUAL_REQUIRED");
          console.log(
            "Digite o código diretamente na janela e conclua o acesso. A sessão será salva automaticamente.",
          );
          if (!(await waitForManualAuthentication(interactiveTimeoutMs))) {
            throw new Error("Tempo esgotado aguardando a confirmação manual do portal.");
          }
        } else {
          const code = await waitForOtpCode();
          const visibleInputs = page.locator("input:visible");
          const inputCount = await visibleInputs.count();
          if (inputCount === 1) {
            await visibleInputs.first().fill(code);
          } else if (inputCount >= 6) {
            for (let index = 0; index < 6; index += 1) {
              await visibleInputs.nth(index).fill(code[index]);
            }
          } else {
            throw new Error(`Quantidade inesperada de campos do código: ${inputCount}.`);
          }

          const continueButton = page.getByRole("button", { name: /^continuar$/i });
          await continueButton.first().click({ timeout: 30_000 });
          if (!(await waitForManualAuthentication(60_000))) {
            throw new Error("O portal não confirmou o código de verificação.");
          }
        }
      }

      await page.goto(credpagoUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(2_000);
      if (!(await isAuthenticated())) {
        throw new Error("A sessão ainda não foi reconhecida pela CredPago.");
      }
      await persistAndFinish();
    }
  }
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
