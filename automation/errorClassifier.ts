import crypto from "node:crypto";
import { formatErrorDetail } from "./logger";
import { redactSensitiveText } from "./redaction";
import type {
  AutomationErrorCategory,
  AutomationErrorSeverity,
  RepairRunbook,
} from "./recoveryTypes";

export interface ClassifiedAutomationError {
  category: AutomationErrorCategory;
  severity: AutomationErrorSeverity;
  message: string;
  stack: string | null;
  code: string | null;
  fingerprint: string;
  diagnosis: string;
  runbook: RepairRunbook;
}

const RULES: Array<{
  category: AutomationErrorCategory;
  severity: AutomationErrorSeverity;
  pattern: RegExp;
  diagnosis: string;
  runbook: RepairRunbook;
}> = [
  { category: "BROWSER_PROFILE_LOCKED", severity: "ERROR", pattern: /profile.*(?:lock|in use)|singleton|credit-automation\.lock/i, diagnosis: "O perfil ou a sessao do navegador aparenta estar em uso por outro processo.", runbook: "RESTART_CREDIT_WORKER" },
  { category: "SESSION_EXPIRED", severity: "WARNING", pattern: /sess[aã]o expirada|session expired|storage.?state.*expir/i, diagnosis: "A sessao autenticada do portal expirou e precisa ser validada novamente.", runbook: "VALIDATE_SESSION" },
  { category: "AUTHENTICATION_ERROR", severity: "ERROR", pattern: /login|autentica[cç][aã]o|credential|senha|c[oó]digo de verifica[cç][aã]o|captcha|recaptcha|otp/i, diagnosis: "A autenticacao do portal nao foi confirmada. Desafios humanos nunca sao contornados.", runbook: "VALIDATE_SESSION" },
  { category: "BROWSER_CRASH", severity: "ERROR", pattern: /browser.*(?:closed|crash|disconnected)|page crashed|target (?:page|context|browser).*closed|protocol error/i, diagnosis: "O Chromium ou o contexto Playwright encerrou inesperadamente.", runbook: "RESTART_CREDIT_WORKER" },
  { category: "PLAYWRIGHT_TIMEOUT", severity: "ERROR", pattern: /playwright.*timeout|timeout .*exceeded|tempo limite|timed out|waiting for/i, diagnosis: "Uma etapa Playwright excedeu o tempo maximo controlado.", runbook: "RESTART_CREDIT_WORKER" },
  { category: "ELEMENT_NOT_VISIBLE", severity: "ERROR", pattern: /element.*not visible|n[aã]o (?:est[aá]|ficou) vis[ií]vel|hidden element/i, diagnosis: "O elemento existe, mas nao ficou utilizavel no layout atual do portal.", runbook: "VALIDATE_SELECTORS" },
  { category: "SELECTOR_NOT_FOUND", severity: "ERROR", pattern: /selector|locator|campo n[aã]o encontrado|bot[aã]o n[aã]o encontrado|layout.*mud/i, diagnosis: "Um seletor conhecido nao encontrou o campo ou botao esperado no portal.", runbook: "VALIDATE_SELECTORS" },
  { category: "DATABASE_ERROR", severity: "CRITICAL", pattern: /supabase|postgres|postgrest|database|relation .* does not exist|23505|23514|42501|pgrst/i, diagnosis: "A persistencia ou fila compartilhada apresentou uma falha de banco/API.", runbook: "CHECK_DATABASE" },
  { category: "NETWORK_ERROR", severity: "ERROR", pattern: /gateway timeout|network|net::|econnreset|econnrefused|enotfound|socket hang up|fetch failed|dns/i, diagnosis: "A comunicacao de rede com uma dependencia falhou.", runbook: "WAIT_EXTERNAL_DEPENDENCY" },
  { category: "CREDPAGO_UNAVAILABLE", severity: "ERROR", pattern: /portal.*indispon|credpago.*indispon|loft.*indispon|status\s*5\d\d|service unavailable/i, diagnosis: "O portal externo de credito aparenta estar indisponivel.", runbook: "WAIT_EXTERNAL_DEPENDENCY" },
  { category: "VPS_HIGH_CPU", severity: "WARNING", pattern: /high cpu|cpu alta|cpu acima/i, diagnosis: "O consumo de CPU da VPS ultrapassou o limite operacional.", runbook: "RESTART_CREDIT_WORKER" },
  { category: "VPS_HIGH_MEMORY", severity: "WARNING", pattern: /high memory|mem[oó]ria alta|out of memory|oom|heap limit/i, diagnosis: "O consumo de memoria ultrapassou o limite operacional.", runbook: "RESTART_CREDIT_WORKER" },
  { category: "VPS_LOW_DISK", severity: "CRITICAL", pattern: /low disk|disco baixo|no space left|enospc/i, diagnosis: "O espaco livre da automacao esta abaixo do limite seguro.", runbook: "CLEAN_OWN_TEMP_ARTIFACTS" },
  { category: "WORKER_OFFLINE", severity: "CRITICAL", pattern: /worker offline|worker.*unreachable|worker.*fora do ar/i, diagnosis: "O processo de credito nao respondeu ao health check.", runbook: "RESTART_CREDIT_WORKER" },
  { category: "VPS_OFFLINE", severity: "CRITICAL", pattern: /vps offline|host unreachable/i, diagnosis: "A VPS nao respondeu ao monitoramento externo.", runbook: "MANUAL_INTERVENTION" },
  { category: "DEPLOY_ERROR", severity: "CRITICAL", pattern: /deploy|image pull|manifest unknown|rollback.*deploy/i, diagnosis: "A versao publicada ou a imagem do servico apresenta falha.", runbook: "MANUAL_INTERVENTION" },
  { category: "DEPENDENCY_ERROR", severity: "CRITICAL", pattern: /module not found|cannot find package|dependency|browser executable.*(?:not found|missing)/i, diagnosis: "Uma dependencia de runtime nao esta disponivel na imagem atual.", runbook: "MANUAL_INTERVENTION" },
  { category: "INTERNAL_SERVER_ERROR", severity: "ERROR", pattern: /internal server error|erro interno|uncaught|unhandled/i, diagnosis: "O processo encontrou uma falha interna nao recuperada no fluxo normal.", runbook: "RESTART_CREDIT_WORKER" },
];

export function classifyAutomationError(error: unknown): ClassifiedAutomationError {
  const detail = formatErrorDetail(error);
  const stack = error instanceof Error && error.stack ? redactSensitiveText(error.stack) : null;
  const message = redactSensitiveText(detail || "Erro sem mensagem.", 4_000);
  const code = error && typeof error === "object" && "code" in error
    ? redactSensitiveText(String((error as { code?: unknown }).code ?? ""), 160) || null
    : null;
  const rule = RULES.find((candidate) => candidate.pattern.test(detail));
  const category = rule?.category ?? "UNKNOWN_ERROR";
  const normalized = message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[uuid]")
    .replace(/\d+/g, "#")
    .slice(0, 1_000);
  const fingerprint = crypto
    .createHash("sha256")
    .update(`${category}|${normalized}`)
    .digest("hex")
    .slice(0, 32);

  return {
    category,
    severity: rule?.severity ?? "ERROR",
    message,
    stack,
    code,
    fingerprint,
    diagnosis: rule?.diagnosis ?? "A causa nao corresponde a um runbook automatico conhecido.",
    runbook: rule?.runbook ?? "MANUAL_INTERVENTION",
  };
}

export function runbookForCategory(category: AutomationErrorCategory): RepairRunbook {
  return RULES.find((rule) => rule.category === category)?.runbook ?? "MANUAL_INTERVENTION";
}
