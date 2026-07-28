import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { chromium } from "playwright";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDirectory, ".env") });
dotenv.config({ path: path.resolve(scriptDirectory, "..", ".env") });

const credpagoUrl = process.env.CREDPAGO_URL || "https://credpago.com/imobiliaria/proposta";
const storageStatePath =
  process.env.CREDPAGO_STORAGE_STATE_PATH || path.resolve(scriptDirectory, "credpago-session.json");
const otpFile =
  process.env.CREDPAGO_OTP_FILE || path.resolve(path.dirname(storageStatePath), "credpago-otp.txt");
const login = process.env.CREDPAGO_LOGIN;
const password = process.env.CREDPAGO_PASSWORD;
const otpTimeoutMs = Number(process.env.AUTH_OTP_TIMEOUT_MS) || 10 * 60 * 1000;

if (!login || !password) {
  throw new Error("CREDPAGO_LOGIN e CREDPAGO_PASSWORD precisam estar configuradas.");
}

const browser = await chromium.launch({ headless: true });
const contextOptions = { viewport: { width: 1366, height: 900 } };
if (
  await fs
    .access(storageStatePath)
    .then(() => true)
    .catch(() => false)
) {
  contextOptions.storageState = storageStatePath;
}
const context = await browser.newContext(contextOptions);
const page = await context.newPage();

async function isAuthenticated() {
  const url = new URL(page.url());
  if (url.hostname !== "credpago.com" && !url.hostname.endsWith(".credpago.com")) {
    return false;
  }
  const loginButton = page.getByRole("button", { name: /login\s+loft/i });
  const passwordField = page.getByLabel(/senha|password/i);
  return (
    !(await loginButton
      .first()
      .isVisible()
      .catch(() => false)) &&
    !(await passwordField
      .first()
      .isVisible()
      .catch(() => false))
  );
}

async function persistAndFinish() {
  await fs.mkdir(path.dirname(storageStatePath), { recursive: true });
  await context.storageState({ path: storageStatePath });
  console.log("AUTH_SUCCESS");
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
        page.waitForURL(/\/imobiliaria\/cr\/index\.php/i, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        }),
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
    } else {
      const loginField = page.getByLabel(/e-?mail ou telefone|e-?mail|telefone/i);
      const passwordField = page.getByLabel(/senha|password/i);
      await loginField.first().waitFor({ state: "visible", timeout: 30_000 });
      await passwordField.first().waitFor({ state: "visible", timeout: 30_000 });
      await loginField.first().fill(login);
      await passwordField.first().fill(password);

      const enterButton = page.getByRole("button", { name: /^entrar$/i });
      await enterButton.first().click({ timeout: 60_000 });

      await Promise.race([
        page.waitForURL(/credpago\.com\/imobiliaria/i, { timeout: 60_000 }).catch(() => {}),
        page
          .getByText(/insira o c[oó]digo enviado/i)
          .first()
          .waitFor({ state: "visible", timeout: 60_000 })
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
          throw new Error("O Login Loft não avançou para a verificação esperada.");
        }

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
        await page.waitForURL(/credpago\.com\/imobiliaria/i, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        });
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
