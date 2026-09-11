export const AUTOMATION_ERROR_CATEGORIES = [
  "SESSION_EXPIRED",
  "BROWSER_CRASH",
  "BROWSER_PROFILE_LOCKED",
  "PLAYWRIGHT_TIMEOUT",
  "SELECTOR_NOT_FOUND",
  "ELEMENT_NOT_VISIBLE",
  "CREDPAGO_UNAVAILABLE",
  "AUTHENTICATION_ERROR",
  "NETWORK_ERROR",
  "VPS_OFFLINE",
  "VPS_HIGH_CPU",
  "VPS_HIGH_MEMORY",
  "VPS_LOW_DISK",
  "WORKER_OFFLINE",
  "DATABASE_ERROR",
  "DEPLOY_ERROR",
  "DEPENDENCY_ERROR",
  "INTERNAL_SERVER_ERROR",
  "UNKNOWN_ERROR",
] as const;

export type AutomationErrorCategory = (typeof AUTOMATION_ERROR_CATEGORIES)[number];
export type AutomationErrorSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export const REPAIR_JOB_STATUSES = [
  "QUEUED",
  "COLLECTING_CONTEXT",
  "DIAGNOSING",
  "SNAPSHOTTING",
  "REPAIRING",
  "RESTARTING",
  "VALIDATING",
  "SUCCESS",
  "FAILED",
  "ROLLING_BACK",
  "ROLLED_BACK",
  "MANUAL_REQUIRED",
] as const;

export type RepairJobStatus = (typeof REPAIR_JOB_STATUSES)[number];
export type HealthStatus = "ONLINE" | "UNSTABLE" | "OFFLINE" | "UNKNOWN";

export type RepairRunbook =
  | "AI_DIAGNOSE_AND_RECOVER"
  | "VALIDATE_SESSION"
  | "RESTART_CREDIT_WORKER"
  | "WAIT_EXTERNAL_DEPENDENCY"
  | "VALIDATE_SELECTORS"
  | "CHECK_DATABASE"
  | "CLEAN_OWN_TEMP_ARTIFACTS";

export interface AutomationErrorRecord {
  id: string;
  correlation_id: string;
  simulation_id: string | null;
  initiating_user_id: string | null;
  environment: string;
  service: string;
  category: AutomationErrorCategory;
  severity: AutomationErrorSeverity;
  status: string;
  automation_step: string | null;
  last_successful_step: string | null;
  message_redacted: string;
  initial_diagnosis: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  last_seen_at: string;
}

export interface RepairJobRecord {
  id: string;
  error_id: string;
  service: string;
  worker_id: string | null;
  status: RepairJobStatus;
  progress: number;
  stage_message: string;
  runbook: RepairRunbook | null;
  diagnosis: string | null;
  snapshot: Record<string, unknown> | null;
  result_summary: string | null;
  failure_reason: string | null;
  rollback_reason: string | null;
  rollback_available: boolean;
  attempt_count: number;
  max_attempts: number;
  created_at: string;
  updated_at: string;
}

export interface DiagnosticSnapshot {
  collectedAt: string;
  environment: string;
  vpsId: string;
  automationVersion: string;
  runtime: string;
  cpuPercent: number | null;
  memoryPercent: number | null;
  memoryUsedBytes: number | null;
  memoryLimitBytes: number | null;
  diskUsedPercent: number | null;
  diskFreeBytes: number | null;
  creditWorkerReachable: boolean;
  creditWorkerReady: boolean;
  creditWorkerHealth: Record<string, unknown>;
  databaseReachable: boolean;
  portalReachable: boolean;
  activeConsultations: number;
  sessionLock: Record<string, unknown>;
}

export interface SafeErrorArtifacts {
  url?: string;
  pageTitle?: string;
  sanitizedDomText?: string;
  screenshot?: Buffer;
  screenshotSkippedReason?: string;
}

export interface AutomationErrorEvent {
  correlationId: string;
  simulationId?: string | null;
  initiatingUserId?: string | null;
  environment: string;
  service?: string;
  step?: string | null;
  lastSuccessfulStep?: string | null;
  error: unknown;
  errorCode?: string | null;
  attemptCount?: number;
  deployVersion?: string;
  automationVersion?: string;
  vpsId?: string;
  runtime?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
  artifacts?: SafeErrorArtifacts;
}
