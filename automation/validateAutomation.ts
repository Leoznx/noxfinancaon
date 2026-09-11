import { chromium } from "playwright";
import { validateSimulationFormReady } from "./credpagoSelectors";
import { env } from "./env";
import { logStructured } from "./logger";
import { collectSystemDiagnostics } from "./systemDiagnostics";

async function main(): Promise<void> {
  const diagnostics = await collectSystemDiagnostics();
  if (!diagnostics.databaseReachable) throw new Error("Supabase/fila indisponivel.");
  if (!diagnostics.creditWorkerReachable) throw new Error("Worker de credito sem resposta.");
  if (!diagnostics.portalReachable) throw new Error("Portal de credito sem resposta.");
  if (!env.storageStatePath) throw new Error("CREDPAGO_STORAGE_STATE_PATH nao configurado.");

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      storageState: env.storageStatePath,
      viewport: { width: 1366, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(env.credpagoUrl, {
      waitUntil: "domcontentloaded",
      timeout: Math.min(env.repairValidationTimeoutMs, 45_000),
    });
    const selectors = await validateSimulationFormReady(page);
    logStructured("automation_safe_validation_succeeded", {
      selectors,
      submitted: false,
      databaseReachable: diagnostics.databaseReachable,
      creditWorkerReachable: diagnostics.creditWorkerReachable,
    });
    await context.close();
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Validacao segura falhou.");
  process.exit(1);
});
