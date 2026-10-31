/**
 * Prepara, na área de transferência, um comando de UMA LINHA para COLAR no terminal do navegador
 * da Hostinger (hPanel → VPS → Terminal). Não precisa de SSH no seu computador.
 *
 *   npm run automation:copy-vps-command -- deploy    atualiza o código e recria o worker
 *   npm run automation:copy-vps-command -- session   instala a sessão da Loft (login manual)
 *
 * Uma linha só, de propósito: colar várias linhas num terminal web é pouco confiável (cada
 * quebra de linha vira um Enter), e o comando de uma linha é o formato que sabidamente funciona.
 *
 * O comando "session" contém os cookies da sessão (comprimidos): ele vai SOMENTE para a área de
 * transferência (nunca é impresso aqui). Depois de colar, copie qualquer outro texto para limpá-la.
 * O arquivo vem de `npm run automation:interactive-login` (automation/data/credpago-session.json).
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sessionFile = path.resolve(process.env.SESSION_FILE || path.join(here, "data", "credpago-session.json"));
const mode = (process.argv[2] || "").toLowerCase();

const CONTAINER = "nox-automacao-credpago";
// O diretório do compose é descoberto pelo próprio Docker: não depende de onde o checkout está.
const COMPOSE_DIR = `$(docker inspect ${CONTAINER} --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}')`;

function deployCommand() {
  return `cd "${COMPOSE_DIR}" && git pull --ff-only && bash ./deployVps.sh`;
}

function sessionCommand(raw) {
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
  // Comprimido (~4x menor). O hash conferido na VPS é do arquivo já descomprimido, então uma colagem
  // truncada ou alterada é recusada e nada é instalado.
  const gz = zlib.gzipSync(bytes, { level: 9 });
  const b64 = gz.toString("base64");
  const incoming = '"$D/credpago-session.json.incoming"';
  const command = [
    `D="${COMPOSE_DIR}/data"`,
    // Cada etapa só roda se a anterior deu certo; qualquer falha cai no `||` final, que limpa o
    // arquivo parcial e avisa. O dono é ajustado ANTES do rename: o worker observa o arquivo e
    // nunca pode ver uma versão que ele não consiga ler.
    `[ -d "$D" ] && echo '${b64}' | base64 -d | gunzip > ${incoming}` +
      ` && echo "${sha256}  $D/credpago-session.json.incoming" | sha256sum -c - >/dev/null` +
      ` && chmod 600 ${incoming}` +
      ` && docker exec -u root ${CONTAINER} chown nox:nox /app/data/credpago-session.json.incoming` +
      ` && { [ ! -f "$D/credpago-session.json" ] || cp -p "$D/credpago-session.json" "$D/credpago-session.json.pre-$(date +%Y%m%d-%H%M%S)"; }` +
      ` && mv -f ${incoming} "$D/credpago-session.json"` +
      ` && echo "SESSAO_INSTALADA em $D/credpago-session.json"` +
      ` || { rm -f ${incoming}; echo "FALHOU: a colagem veio incompleta ou algo deu errado; nada foi instalado"; }`,
  ].join("; ");
  // O espaço inicial mantém o comando fora do histórico (o Ubuntu usa HISTCONTROL=ignoreboth).
  return {
    command: ` ${command}`,
    summary: {
      cookies: parsed.cookies.length,
      sha256: sha256.slice(0, 12),
      bytes: bytes.length,
      sent: gz.length,
      line: command.length,
    },
  };
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
  text = deployCommand();
  summary = "comando de implantação (sem segredos)";
} else {
  if (!fs.existsSync(sessionFile)) fail(`Sessão não encontrada: ${sessionFile}. Rode automation:interactive-login.`);
  try {
    const built = sessionCommand(fs.readFileSync(sessionFile, "utf8"));
    text = built.command;
    summary = `instalador da sessão em uma linha (${built.summary.cookies} cookies, ${built.summary.bytes} bytes → ${built.summary.sent} comprimidos, ${built.summary.line} caracteres, sha256 ${built.summary.sha256}…)`;
  } catch (error) {
    fail(error.message);
  }
}

if (!/^[\x20-\x7e]*$/.test(text)) fail("O comando gerado contém quebra de linha ou caracteres não ASCII; abortado.");

// Alternativa sem área de transferência (e usada nos testes): grava o comando em um arquivo 0600.
if (process.env.OUTPUT_FILE) {
  fs.writeFileSync(path.resolve(process.env.OUTPUT_FILE), text, { mode: 0o600 });
  console.log(`✔ Comando gravado em ${path.resolve(process.env.OUTPUT_FILE)}: ${summary}.`);
  process.exit(0);
}

if (!copyToClipboard(text)) fail("Não foi possível usar a área de transferência deste computador.");

console.log(`✔ Copiado para a área de transferência: ${summary}.`);
console.log("  Cole no terminal da Hostinger (hPanel → VPS → Terminal) e aperte Enter.");
if (mode === "session") {
  console.log("  A linha é longa e o terminal mostra muito texto ao colar: é normal. O sucesso é a frase SESSAO_INSTALADA.");
  console.log("  Depois de colar, copie qualquer outro texto para limpar a área de transferência.");
}
