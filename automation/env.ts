import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// automation/.env (variáveis exclusivas do worker, ex.: service role key) tem
// prioridade; o .env da raiz do projeto entra como fallback para valores
// compartilhados com o frontend (ex.: SUPABASE_URL).
dotenv.config({ path: path.resolve(__dirname, ".env") });
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variável de ambiente obrigatória ausente: ${name}. Configure automation/.env (veja automation/.env.example).`,
    );
  }
  return value;
}

function positiveNumber(name: string, fallback: number, minimum = 1): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`${name} precisa ser um número maior ou igual a ${minimum}.`);
  }
  return value;
}

const credpagoLogin = process.env.CREDPAGO_LOGIN?.trim() || "";
const credpagoPassword = process.env.CREDPAGO_PASSWORD || "";
if (Boolean(credpagoLogin) !== Boolean(credpagoPassword)) {
  throw new Error(
    "CREDPAGO_LOGIN e CREDPAGO_PASSWORD precisam ser configuradas juntas em automation/.env.",
  );
}

export const env = {
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  /** Evita que uma conexão degradada com a fila congele o loop do worker. */
  supabaseRequestTimeoutMs: positiveNumber("SUPABASE_REQUEST_TIMEOUT_MS", 15_000, 3_000),
  profileDir:
    process.env.CREDPAGO_PROFILE_DIR || path.resolve(__dirname, "chrome-profile-credpago"),
  /**
   * Caminho de um arquivo de sessão portátil (Playwright storageState — cookies +
   * localStorage em JSON puro, sem a criptografia OS-level do perfil do Chrome).
   * Quando definido, o worker usa chromium.launch()+newContext({storageState}) em vez
   * do perfil persistente — é o único jeito de levar uma sessão já logada localmente
   * (Windows) para um servidor Linux, porque o perfil persistente criptografa os
   * cookies com DPAPI do Windows, que não decodifica em outro SO/usuário. Gerado por
   * `npm run automation:export-session`. Se vazio, mantém o comportamento local de
   * sempre (perfil persistente em profileDir).
   */
  storageStatePath: process.env.CREDPAGO_STORAGE_STATE_PATH || "",
  /** Porta do servidor HTTP só com /health — não expõe nenhuma rota de negócio. */
  healthPort: positiveNumber("HEALTH_PORT", 3000),
  pollIntervalMs: positiveNumber("AUTOMATION_POLL_INTERVAL_MS", 5000, 500),
  credpagoUrl:
    process.env.CREDPAGO_URL || "https://app.loft.com.br/fianca-aluguel/imobiliaria/proposta",
  /** Credenciais exclusivas do servidor para renovar automaticamente a sessão do Login Loft. */
  credpagoLogin,
  credpagoPassword,
  /** Mantém a sessão aquecida e detecta expiração antes de retirar uma consulta da fila. */
  authCheckIntervalMs: positiveNumber("AUTH_CHECK_INTERVAL_MS", 4 * 60 * 1000, 10_000),
  /** Intervalo entre tentativas de recuperar uma autenticação indisponível. */
  authRetryIntervalMs: positiveNumber("AUTH_RETRY_INTERVAL_MS", 30 * 1000, 5_000),
  /** Teto TOTAL para todas as tentativas de redirecionamento e Login Loft. */
  authLoginTimeoutMs: positiveNumber("AUTH_LOGIN_TIMEOUT_MS", 75 * 1000, 10_000),
  /** Watchdog externo ao fluxo de login: fecha a aba mesmo se o Playwright/SSO não responder. */
  authValidationTimeoutMs: positiveNumber("AUTH_VALIDATION_TIMEOUT_MS", 90 * 1000, 15_000),
  /** Reinicia contexto+navegador depois de falhas seguidas, sem derrubar o processo. */
  authFailuresBeforeBrowserRestart: positiveNumber(
    "AUTH_FAILURES_BEFORE_BROWSER_RESTART",
    2,
  ),
  keepBrowserOpen: process.env.AUTOMATION_KEEP_BROWSER_OPEN === "true",
  /**
   * Quantas consultas podem rodar em paralelo, cada uma na sua própria aba do mesmo
   * perfil/contexto. Padrão 10 — dá pra 10 corretores simularem ao mesmo tempo sem fila.
   * Suba com cautela: cada aba é uma sessão real batendo no site da Loft com o mesmo login;
   * um valor muito alto pode esbarrar em limites do próprio site ou nos recursos da máquina
   * que roda o worker antes de qualquer coisa no código.
   */
  maxConcurrentConsultas: positiveNumber("MAX_CONCURRENT_CONSULTAS", 10),
  /** Tempo máximo (ms) para uma consulta individual antes de ser marcada como erro. */
  consultaTimeoutMs: positiveNumber("CONSULTA_TIMEOUT_MS", 90_000, 10_000),
  /** Recupera leases "processando" deixados por queda/reinício do worker. */
  staleConsultaMs: positiveNumber("STALE_CONSULTA_MS", 3 * 60 * 1000, 60_000),
  staleRecoveryIntervalMs: positiveNumber(
    "STALE_RECOVERY_INTERVAL_MS",
    60 * 1000,
    10_000,
  ),
  /**
   * Chrome invisível. Login manual exige uma janela visível — se HEADLESS=true e a sessão
   * expirar, o worker falha com uma mensagem clara em vez de travar esperando um Enter que
   * ninguém consegue responder. Rode com HEADLESS=false uma vez para logar, depois volte.
   */
  headless: process.env.HEADLESS === "true",
};
