/**
 * Renova a sessão da Loft usada pelo worker da VPS, de ponta a ponta, a partir do SEU computador:
 *
 *   1. abre uma janela do Chromium para VOCÊ entrar na Loft (CAPTCHA/código incluídos);
 *   2. envia o arquivo de sessão para a VPS por scp (canal SSH que você já usa);
 *   3. ajusta o dono do arquivo e o troca de forma atômica;
 *   4. aguarda o worker recarregá-lo sozinho e confirma `auth: "ok"` no /health.
 *
 * O worker observa o arquivo e recarrega o navegador em poucos segundos — não há reinício
 * de container. Nenhuma senha é lida, gravada ou enviada por este script.
 *
 * Uso:   npm run automation:refresh-vps-session
 *
 * Configure no SEU terminal (nunca no repositório):
 *   VPS_SSH_TARGET     obrigatório. Ex.: usuario@IP_DA_VPS (ou um alias do seu ~/.ssh/config)
 *   VPS_DATA_DIR       obrigatório. Pasta ./data do compose na VPS. Ex.: /opt/noxfinancaon/automation/data
 *   VPS_COMPOSE_DIR    opcional. Pasta do docker-compose.yml na VPS (padrão: pasta pai de VPS_DATA_DIR)
 *   AUTOMATION_HEALTH_URL  opcional. Padrão: https://automacao.noxfianca.com/health
 *   SKIP_INTERACTIVE_LOGIN=true  reaproveita automation/data/credpago-session.json já gerado
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const localSession = path.resolve(here, "data", "credpago-session.json");
const target = process.env.VPS_SSH_TARGET?.trim();
const dataDir = process.env.VPS_DATA_DIR?.trim().replace(/\/+$/, "");
const composeDir = process.env.VPS_COMPOSE_DIR?.trim().replace(/\/+$/, "") ||
  (dataDir ? dataDir.replace(/\/[^/]+$/, "") : "");
const healthUrl = process.env.AUTOMATION_HEALTH_URL?.trim() || "https://automacao.noxfianca.com/health";

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) fail(`Não foi possível executar ${command}: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} terminou com código ${result.status}.`);
}

/** Aspas simples seguras para o shell remoto. */
const quote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

if (!target || !dataDir) {
  fail(
    "Defina VPS_SSH_TARGET (ex.: usuario@IP_DA_VPS) e VPS_DATA_DIR (ex.: /opt/noxfinancaon/automation/data) " +
      "no seu terminal e rode de novo.",
  );
}
if (!/^[\w.@:-]+$/.test(target)) fail("VPS_SSH_TARGET contém caracteres inesperados.");

if (process.env.SKIP_INTERACTIVE_LOGIN !== "true") {
  console.log("1/4  Abrindo o Chromium: entre na Loft na janela que vai aparecer...");
  run(process.execPath, [path.resolve(here, "interactiveLogin.mjs")], {
    env: {
      ...process.env,
      CREDPAGO_STORAGE_STATE_PATH: localSession,
      AUTH_INTERACTIVE_TIMEOUT_MS: process.env.AUTH_INTERACTIVE_TIMEOUT_MS || String(30 * 60 * 1000),
    },
  });
} else {
  console.log("1/4  Reaproveitando a sessão local já gerada.");
}
if (!fs.existsSync(localSession)) fail(`Arquivo de sessão não encontrado: ${localSession}`);
try {
  const parsed = JSON.parse(fs.readFileSync(localSession, "utf8"));
  if (!Array.isArray(parsed.cookies) || parsed.cookies.length === 0) throw new Error("sem cookies");
} catch (error) {
  fail(`O arquivo de sessão local é inválido (${error.message}). Refaça o login.`);
}

const incoming = `${dataDir}/credpago-session.json.incoming`;
const finalPath = `${dataDir}/credpago-session.json`;

console.log("2/4  Enviando a sessão para a VPS (scp)...");
run("scp", ["-q", localSession, `${target}:${incoming}`]);

console.log("3/4  Instalando o arquivo na VPS (troca atômica + dono correto)...");
const remote = [
  "set -e",
  `chmod 600 ${quote(incoming)}`,
  `mv -f ${quote(incoming)} ${quote(finalPath)}`,
  // O worker roda como o usuário "nox" dentro do container; sem isso ele não consegue ler o arquivo.
  `cd ${quote(composeDir)} && docker compose exec -T -u root credpago-worker chown nox:nox /app/data/credpago-session.json`,
].join(" && ");
run("ssh", [target, remote]);

console.log("4/4  Aguardando o worker recarregar a sessão...");
const deadline = Date.now() + 3 * 60 * 1000;
let last = "";
while (Date.now() < deadline) {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(8000) });
    const health = await response.json();
    const line = `auth=${health.auth} pronto=${health.ready} precisaDePessoa=${health.authRequiresHuman ?? "?"}`;
    if (line !== last) console.log("     " + line);
    last = line;
    if (health.auth === "ok") {
      console.log(
        health.ready
          ? "\n✔ Sessão renovada: o worker está autenticado e pronto para a fila."
          : "\n✔ Sessão renovada: o worker está autenticado. Falta apenas a prontidão da fila/cancelamento (veja o /ready).",
      );
      process.exit(0);
    }
  } catch {
    // O /health pode oscilar durante a recarga; continua aguardando.
  }
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
fail(
  "O worker não confirmou a nova sessão em 3 minutos. Veja `docker compose logs --tail=100 credpago-worker` na VPS.",
);
