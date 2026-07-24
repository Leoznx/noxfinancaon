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
  healthPort: Number(process.env.HEALTH_PORT) || 3000,
  pollIntervalMs: Number(process.env.AUTOMATION_POLL_INTERVAL_MS) || 5000,
  credpagoUrl: process.env.CREDPAGO_URL || "https://credpago.com/imobiliaria/proposta",
  /** Credenciais exclusivas do servidor para renovar automaticamente a sessão do Login Loft. */
  credpagoLogin,
  credpagoPassword,
  /** Mantém a sessão aquecida e detecta expiração antes de retirar uma consulta da fila. */
  authCheckIntervalMs: Number(process.env.AUTH_CHECK_INTERVAL_MS) || 4 * 60 * 1000,
  /** Intervalo entre tentativas de recuperar uma autenticação indisponível. */
  authRetryIntervalMs: Number(process.env.AUTH_RETRY_INTERVAL_MS) || 60 * 1000,
  /** Teto para o redirecionamento e confirmação do Login Loft. */
  authLoginTimeoutMs: Number(process.env.AUTH_LOGIN_TIMEOUT_MS) || 45 * 1000,
  keepBrowserOpen: process.env.AUTOMATION_KEEP_BROWSER_OPEN === "true",
  /** Quantas consultas podem rodar em paralelo, cada uma na sua própria aba do mesmo perfil/contexto. */
  maxConcurrentConsultas: Math.max(1, Number(process.env.MAX_CONCURRENT_CONSULTAS) || 3),
  /** Tempo máximo (ms) para uma consulta individual antes de ser marcada como erro. */
  consultaTimeoutMs: Number(process.env.CONSULTA_TIMEOUT_MS) || 90000,
  /**
   * Chrome invisível. Login manual exige uma janela visível — se HEADLESS=true e a sessão
   * expirar, o worker falha com uma mensagem clara em vez de travar esperando um Enter que
   * ninguém consegue responder. Rode com HEADLESS=false uma vez para logar, depois volte.
   */
  headless: process.env.HEADLESS === "true",
};
