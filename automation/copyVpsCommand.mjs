/**
 * Prepara, na área de transferência, um bloco para COLAR no terminal do navegador da Hostinger
 * (hPanel → VPS → Terminal). Não precisa de SSH no seu computador.
 *
 *   npm run automation:copy-vps-command -- deploy    atualiza o código e recria o worker
 *   npm run automation:copy-vps-command -- session   instala a sessão da Loft (login manual)
 *
 * O bloco "session" contém os cookies da sessão: ele vai SOMENTE para a área de transferência
 * (nunca é impresso aqui). Depois de colar, copie qualquer outro texto para limpá-la.
 * O arquivo vem de `npm run automation:interactive-login` (automation/data/credpago-session.json).
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sessionFile = path.resolve(process.env.SESSION_FILE || path.join(here, "data", "credpago-session.json"));
const mode = (process.argv[2] || "").toLowerCase();

const CONTAINER = "nox-automacao-credpago";
// O diretório do compose é descoberto pelo próprio Docker: não depende de onde o checkout está.
const FIND_COMPOSE_DIR =
  `"$(docker inspect ${CONTAINER} --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}')"`;

function deployBlock() {
  return [
    "bash <<'NOX_DEPLOY'",
    "set -eu",
    `AUTO_DIR=${FIND_COMPOSE_DIR}`,
    '[ -d "$AUTO_DIR" ] || { echo "ERRO: pasta do compose nao encontrada" >&2; exit 1; }',
    'cd "$AUTO_DIR"',
    'echo "== pasta: $PWD"',
    "git pull --ff-only </dev/null",
    "bash ./deployVps.sh",
    "NOX_DEPLOY",
    "",
  ].join("\n");
}

function sessionBlock(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`O arquivo de sessão não é um JSON válido (${error.message}).`);
  }
  if (!Array.isArray(parsed.cookies) || parsed.cookies.length === 0) {
    throw new Error("O arquivo de sessão não tem cookies: refaça o login (automation:interactive-login).");
  }
  const bytes = Buffer.from(raw, "utf8");
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  // Linhas curtas: o terminal limita cada linha digitada (~4 KB) e a colagem não pode ser truncada.
  const wrapped = bytes.toString("base64").match(/.{1,76}/g).join("\n");
  const block = [
    // Sem histórico: o comando colado contém a sessão e não deve ir para ~/.bash_history.
    "set +o history; HISTFILE=/dev/null",
    "bash <<'NOX_INSTALL'",
    "set -eu",
    `CONTAINER=${CONTAINER}`,
    `DATA_DIR=${FIND_COMPOSE_DIR}/data`,
    '[ -d "$DATA_DIR" ] || { echo "ERRO: pasta data do compose nao encontrada: $DATA_DIR" >&2; exit 1; }',
    'cd "$DATA_DIR"',
    'if [ -f credpago-session.json ]; then cp -p credpago-session.json "credpago-session.json.pre-$(date +%Y%m%d-%H%M%S)"; fi',
    "base64 -d > credpago-session.json.incoming <<'NOX_SESSION_EOF'",
    wrapped,
    "NOX_SESSION_EOF",
    `echo "${sha256}  credpago-session.json.incoming" | sha256sum -c - >/dev/null || { echo "ERRO: a sessao colada esta incompleta; nada foi instalado" >&2; rm -f credpago-session.json.incoming; exit 1; }`,
    "chmod 600 credpago-session.json.incoming",
    // O dono é ajustado ANTES do rename: o worker observa o arquivo e não pode ver uma versão ilegível.
    'docker exec -u root "$CONTAINER" chown nox:nox /app/data/credpago-session.json.incoming',
    "mv -f credpago-session.json.incoming credpago-session.json",
    'echo "SESSAO_INSTALADA em $DATA_DIR/credpago-session.json ($(stat -c %s credpago-session.json) bytes)"',
    "NOX_INSTALL",
    "set -o history",
    "",
  ].join("\n");
  return { block, summary: { cookies: parsed.cookies.length, sha256: sha256.slice(0, 12), bytes: bytes.length } };
}

function copyToClipboard(text) {
  const attempts =
    process.platform === "win32"
      ? [["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Set-Clipboard -Value ([Console]::In.ReadToEnd())"]]]
      : process.platform === "darwin"
        ? [["pbcopy", []]]
        : [
            ["wl-copy", []],
            ["xclip", ["-selection", "clipboard"]],
            ["xsel", ["--clipboard", "--input"]],
          ];
  for (const [command, args] of attempts) {
    const result = spawnSync(command, args, { input: text, encoding: "utf8" });
    if (!result.error && result.status === 0) return true;
  }
  return false;
}

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

if (mode !== "deploy" && mode !== "session") {
  fail("Uso: npm run automation:copy-vps-command -- deploy|session");
}

let text;
let summary = "";
if (mode === "deploy") {
  text = deployBlock();
  summary = "bloco de implantação (sem segredos)";
} else {
  if (!fs.existsSync(sessionFile)) fail(`Sessão não encontrada: ${sessionFile}. Rode automation:interactive-login.`);
  try {
    const built = sessionBlock(fs.readFileSync(sessionFile, "utf8"));
    text = built.block;
    summary = `instalador da sessão (${built.summary.cookies} cookies, ${built.summary.bytes} bytes, sha256 ${built.summary.sha256}…)`;
  } catch (error) {
    fail(error.message);
  }
}

if (!/^[\x09\x0a\x20-\x7e]*$/.test(text)) fail("O bloco gerado contém caracteres não ASCII; abortado.");

// Alternativa sem área de transferência (e usada nos testes): grava o bloco em um arquivo 0600.
if (process.env.OUTPUT_FILE) {
  fs.writeFileSync(path.resolve(process.env.OUTPUT_FILE), text, { mode: 0o600 });
  console.log(`✔ Bloco gravado em ${path.resolve(process.env.OUTPUT_FILE)}: ${summary}.`);
  process.exit(0);
}

if (!copyToClipboard(text)) fail("Não foi possível usar a área de transferência deste computador.");

console.log(`✔ Copiado para a área de transferência: ${summary}.`);
console.log("  Cole no terminal da Hostinger (hPanel → VPS → Terminal) com Ctrl+V e aperte Enter se precisar.");
if (mode === "session") {
  console.log("  Depois de colar, copie qualquer outro texto para limpar a área de transferência.");
}
