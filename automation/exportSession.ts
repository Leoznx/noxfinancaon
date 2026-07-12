import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { env } from "./env";
import { log, logErro } from "./logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Roda LOCALMENTE (na máquina onde o perfil já está logado na CredPago) sempre
 * que a sessão precisar ser levada para outro ambiente (ex.: a VPS) ou renovada
 * depois de expirar. Abre o MESMO perfil persistente que o worker usa
 * (env.profileDir), exporta cookies + localStorage como JSON portátil via
 * `context.storageState()` e fecha. Não copia a pasta do perfil inteira (que tem
 * cache, extensões, histórico e é criptografada com DPAPI do Windows — não abre
 * em outro SO/usuário); só o essencial pra sessão logada funcionar em qualquer
 * lugar.
 *
 * Uso: npm run automation:export-session
 * Gera: automation/credpago-session.json (nunca commitar — ver .gitignore)
 */

const OUTPUT_PATH =
  process.env.CREDPAGO_SESSION_EXPORT_PATH || path.resolve(__dirname, "credpago-session.json");

async function main() {
  log(`Abrindo perfil persistente em ${env.profileDir} para exportar a sessão...`);
  const context = await chromium.launchPersistentContext(env.profileDir, {
    headless: false,
    viewport: { width: 1366, height: 900 },
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(env.credpagoUrl, { waitUntil: "domcontentloaded" }).catch(() => {});

    const senhaField = page.getByLabel(/senha|password/i);
    const pareceLogin =
      /login|signin|entrar/i.test(page.url()) ||
      ((await senhaField.count().catch(() => 0)) > 0 &&
        (await senhaField
          .first()
          .isVisible()
          .catch(() => false)));

    if (pareceLogin) {
      logErro(
        "A página ainda mostra a tela de login — este perfil não está autenticado agora. " +
          "Rode `npm run automation:credpago` uma vez, faça login manualmente, feche o worker com Ctrl+C e tente de novo.",
      );
      process.exitCode = 1;
      return;
    }

    await context.storageState({ path: OUTPUT_PATH });
    log(`Sessão exportada para ${OUTPUT_PATH}`);
    log(
      "Transfira esse arquivo pra VPS por um canal seguro (scp/rsync sobre SSH), nunca por e-mail/chat, " +
        "e aponte CREDPAGO_STORAGE_STATE_PATH pra ele no automation/.env do servidor.",
    );
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((err) => {
  logErro("Falha ao exportar sessão", err);
  process.exitCode = 1;
});
