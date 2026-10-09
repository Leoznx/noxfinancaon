import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import dotenv from "dotenv";
import { isLoftCancellationReason, type LoftCancellationReason } from "./loftCancellation";

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

function percentage(name: string, fallback: number): number {
  const value = positiveNumber(name, fallback, 1);
  if (value > 100) throw new Error(`${name} precisa ficar entre 1 e 100.`);
  return value;
}

const credpagoLogin = process.env.CREDPAGO_LOGIN?.trim() || "";
const credpagoPassword = process.env.CREDPAGO_PASSWORD || "";
if (Boolean(credpagoLogin) !== Boolean(credpagoPassword)) {
  throw new Error(
    "CREDPAGO_LOGIN e CREDPAGO_PASSWORD precisam ser configuradas juntas em automation/.env.",
  );
}

const loftOauthClientId = process.env.LOFT_OAUTH_CLIENT_ID?.trim() || "";
const loftOauthClientSecret = process.env.LOFT_OAUTH_CLIENT_SECRET || "";
if (Boolean(loftOauthClientId) !== Boolean(loftOauthClientSecret)) {
  throw new Error(
    "LOFT_OAUTH_CLIENT_ID e LOFT_OAUTH_CLIENT_SECRET precisam ser configuradas juntas.",
  );
}
const configuredCancellationReason = process.env.LOFT_CANCELLATION_REASON?.trim() || "";
if (configuredCancellationReason && !isLoftCancellationReason(configuredCancellationReason)) {
  throw new Error("LOFT_CANCELLATION_REASON não corresponde a um motivo oficial da API da Loft.");
}
if (configuredCancellationReason && !loftOauthClientId) {
  throw new Error(
    "LOFT_CANCELLATION_REASON exige LOFT_OAUTH_CLIENT_ID e LOFT_OAUTH_CLIENT_SECRET.",
  );
}
const loftCancellationReason = configuredCancellationReason
  ? (configuredCancellationReason as LoftCancellationReason)
  : null;

const storageStatePath = process.env.CREDPAGO_STORAGE_STATE_PATH || "";
const profileDir =
  process.env.CREDPAGO_PROFILE_DIR || path.resolve(__dirname, "chrome-profile-credpago");
const dataDir = storageStatePath ? path.dirname(storageStatePath) : path.resolve(__dirname, "data");
const CURRENT_CREDIT_SIMULATION_URL = "https://app.loft.com.br/erp/proposta/analise-de-credito";
const configuredCreditSimulationUrl = process.env.CREDPAGO_URL?.trim() || "";
const usesLegacyCreditSimulationUrl =
  /^(?:https?:\/\/)?(?:www\.)?(?:credpago\.com\/imobiliaria\/proposta|app\.loft\.com\.br\/fianca-aluguel\/imobiliaria(?:\/proposta)?)[/?#]?$/i.test(
    configuredCreditSimulationUrl,
  );

// O portal mantém o andamento da análise no storage da sessão autenticada. Abas
// paralelas no mesmo BrowserContext sobrescrevem esse estado e podem devolver ambas
// ao formulário sem resultado. A fila da NOX continua aceitando qualquer volume,
// mas a conta compartilhada do parceiro precisa ser consumida sequencialmente.
const requestedMaxConcurrentConsultas = positiveNumber("MAX_CONCURRENT_CONSULTAS", 1);
const SAFE_PROVIDER_CONCURRENCY = 1;

export const env = {
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  /** Evita que uma conexão degradada com a fila congele o loop do worker. */
  supabaseRequestTimeoutMs: positiveNumber("SUPABASE_REQUEST_TIMEOUT_MS", 15_000, 3_000),
  profileDir,
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
  storageStatePath,
  /** Porta do servidor HTTP só com /health — não expõe nenhuma rota de negócio. */
  healthPort: positiveNumber("HEALTH_PORT", 3000),
  repairHealthPort: positiveNumber("REPAIR_HEALTH_PORT", 3001),
  repairPollIntervalMs: positiveNumber("REPAIR_POLL_INTERVAL_MS", 3000, 500),
  repairValidationTimeoutMs: positiveNumber("REPAIR_VALIDATION_TIMEOUT_MS", 60_000, 10_000),
  repairAutoEnabled: process.env.REPAIR_AUTO_ENABLED !== "false",
  repairHealthToken: process.env.REPAIR_HEALTH_TOKEN || "",
  automationEnvironment: process.env.AUTOMATION_ENVIRONMENT || "production",
  automationVersion:
    process.env.AUTOMATION_VERSION || process.env.VERCEL_GIT_COMMIT_SHA || "unknown",
  deployVersion: process.env.DEPLOY_VERSION || process.env.AUTOMATION_VERSION || "unknown",
  vpsId: process.env.VPS_ID || os.hostname(),
  automationLockPath:
    process.env.AUTOMATION_LOCK_PATH || path.join(dataDir, "credit-automation.lock"),
  errorSpoolDir: process.env.ERROR_SPOOL_DIR || path.join(dataDir, "error-spool"),
  repairArtifactDir: process.env.REPAIR_ARTIFACT_DIR || path.join(dataDir, "repair-artifacts"),
  highCpuPercent: percentage("VPS_HIGH_CPU_PERCENT", 90),
  highMemoryPercent: percentage("VPS_HIGH_MEMORY_PERCENT", 90),
  lowDiskUsedPercent: percentage("VPS_LOW_DISK_USED_PERCENT", 90),
  pollIntervalMs: positiveNumber("AUTOMATION_POLL_INTERVAL_MS", 5000, 500),
  credpagoUrl:
    !configuredCreditSimulationUrl || usesLegacyCreditSimulationUrl
      ? CURRENT_CREDIT_SIMULATION_URL
      : configuredCreditSimulationUrl,
  /** Credenciais exclusivas do servidor para renovar automaticamente a sessão do Login Loft. */
  credpagoLogin,
  credpagoPassword,
  /** API oficial da parceria, usada apenas no backend para cancelar propostas vencidas. */
  loftApiBaseUrl: process.env.LOFT_API_BASE_URL?.trim() || "https://api.loft.com.br",
  loftOauthTokenUrl:
    process.env.LOFT_OAUTH_TOKEN_URL?.trim() || "https://auth.loft.com.br/v2/oauth/token",
  loftOauthClientId,
  loftOauthClientSecret,
  loftOauthScope: process.env.LOFT_OAUTH_SCOPE?.trim() || "loft-aluguel",
  loftOauthAuthorizationDetails: process.env.LOFT_OAUTH_AUTHORIZATION_DETAILS?.trim() || "",
  loftCancellationReason,
  loftCancellationComment: (process.env.LOFT_CANCELLATION_COMMENT?.trim() || "").slice(0, 500),
  loftCancellationDelayMs: positiveNumber("LOFT_CANCELLATION_DELAY_MS", 30 * 60 * 1000, 60_000),
  loftCancellationRequestTimeoutMs: positiveNumber(
    "LOFT_CANCELLATION_REQUEST_TIMEOUT_MS",
    15_000,
    3_000,
  ),
  loftCancellationEnabled: Boolean(
    loftOauthClientId && loftOauthClientSecret && loftCancellationReason,
  ),
  /** Mantém a sessão aquecida e detecta expiração antes de retirar uma consulta da fila. */
  authCheckIntervalMs: positiveNumber("AUTH_CHECK_INTERVAL_MS", 4 * 60 * 1000, 10_000),
  /** Intervalo entre tentativas de recuperar uma autenticação indisponível. */
  authRetryIntervalMs: positiveNumber("AUTH_RETRY_INTERVAL_MS", 30 * 1000, 5_000),
  /** Teto TOTAL para todas as tentativas de redirecionamento e Login Loft. */
  authLoginTimeoutMs: positiveNumber("AUTH_LOGIN_TIMEOUT_MS", 75 * 1000, 10_000),
  /** Watchdog externo ao fluxo de login: fecha a aba mesmo se o Playwright/SSO não responder. */
  authValidationTimeoutMs: positiveNumber("AUTH_VALIDATION_TIMEOUT_MS", 90 * 1000, 15_000),
  /** Reinicia contexto+navegador depois de falhas seguidas, sem derrubar o processo. */
  authFailuresBeforeBrowserRestart: positiveNumber("AUTH_FAILURES_BEFORE_BROWSER_RESTART", 2),
  keepBrowserOpen: process.env.AUTOMATION_KEEP_BROWSER_OPEN === "true",
  /** Valor informado no ambiente, exposto apenas para diagnóstico operacional. */
  requestedMaxConcurrentConsultas,
  /**
   * A conta do parceiro compartilha o estado da proposta entre abas. Por segurança,
   * somente uma análise é enviada por vez; as demais permanecem na fila do Supabase.
   */
  maxConcurrentConsultas: Math.min(requestedMaxConcurrentConsultas, SAFE_PROVIDER_CONCURRENCY),
  /** Tempo máximo (ms) para uma consulta individual antes de ser marcada como erro. */
  consultaTimeoutMs: positiveNumber("CONSULTA_TIMEOUT_MS", 420_000, 10_000),
  /** Recupera leases "processando" deixados por queda/reinício do worker. */
  // Deve ser maior que CONSULTA_TIMEOUT_MS: nunca recupera uma consulta que ainda
  // está persistindo o resultado depois de uma resposta lenta do portal.
  staleConsultaMs: positiveNumber("STALE_CONSULTA_MS", 10 * 60 * 1000, 60_000),
  staleRecoveryIntervalMs: positiveNumber("STALE_RECOVERY_INTERVAL_MS", 60 * 1000, 10_000),
  /**
   * Chrome invisível. Login manual exige uma janela visível — se HEADLESS=true e a sessão
   * expirar, o worker falha com uma mensagem clara em vez de travar esperando um Enter que
   * ninguém consegue responder. Rode com HEADLESS=false uma vez para logar, depois volte.
   */
  headless: process.env.HEADLESS === "true",
};
