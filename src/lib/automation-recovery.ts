import { supabase } from "@/integrations/supabase/client";

export type AutomationErrorStatus =
  | "NOVO"
  | "ANALISANDO"
  | "CORRIGINDO"
  | "VALIDANDO"
  | "CORRIGIDO"
  | "FALHOU"
  | "ROLLBACK_REALIZADO"
  | "INTERVENCAO_NECESSARIA";

export interface AutomationErrorView {
  id: string;
  correlation_id: string;
  simulation_id: string | null;
  environment: string;
  service: string;
  category: string;
  severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  status: AutomationErrorStatus;
  automation_step: string | null;
  last_successful_step: string | null;
  message_redacted: string;
  stack_trace_redacted: string | null;
  error_code: string | null;
  attempt_count: number;
  occurrence_count: number;
  initial_diagnosis: string | null;
  deploy_version: string | null;
  automation_version: string | null;
  vps_id: string | null;
  runtime: string | null;
  duration_ms: number | null;
  metadata: Record<string, unknown> | null;
  artifacts: Record<string, unknown> | null;
  current_repair_job_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
}

export interface RepairJobView {
  id: string;
  error_id: string;
  status: string;
  progress: number;
  stage_message: string;
  runbook: string | null;
  diagnosis: string | null;
  snapshot: Record<string, unknown> | null;
  result_summary: string | null;
  failure_reason: string | null;
  rollback_reason: string | null;
  rollback_available: boolean;
  attempt_count: number;
  max_attempts: number;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RepairStepView {
  id: string;
  job_id: string;
  sequence: number;
  stage: string;
  status: string;
  progress: number;
  message: string;
  details: Record<string, unknown> | null;
  started_at: string;
  finished_at: string | null;
}

export interface SystemHealthView {
  id: string;
  service: string;
  component: string;
  environment: string;
  status: "ONLINE" | "UNSTABLE" | "OFFLINE" | "UNKNOWN";
  summary: string;
  metrics: Record<string, unknown> | null;
  version: string | null;
  consecutive_failures: number;
  last_success_at: string | null;
  checked_at: string;
}

export interface RecoveryDashboardData {
  errors: AutomationErrorView[];
  jobs: RepairJobView[];
  steps: RepairStepView[];
  health: SystemHealthView[];
}

export async function loadRecoveryDashboard(): Promise<RecoveryDashboardData> {
  const client = supabase as any;
  const [errorsResult, jobsResult, healthResult] = await Promise.all([
    client.from("automation_errors").select("*").order("last_seen_at", { ascending: false }).limit(250),
    client.from("repair_jobs").select("*").order("created_at", { ascending: false }).limit(250),
    client.from("system_health").select("*").order("checked_at", { ascending: false }).limit(30),
  ]);
  const failure = errorsResult.error || jobsResult.error || healthResult.error;
  if (failure) throw failure;

  const jobs = (jobsResult.data ?? []) as RepairJobView[];
  const jobIds = jobs.map((job) => job.id);
  let steps: RepairStepView[] = [];
  if (jobIds.length) {
    const stepsResult = await client
      .from("repair_steps")
      .select("*")
      .in("job_id", jobIds)
      .order("sequence", { ascending: true });
    if (stepsResult.error) throw stepsResult.error;
    steps = (stepsResult.data ?? []) as RepairStepView[];
  }

  return {
    errors: (errorsResult.data ?? []) as AutomationErrorView[],
    jobs,
    steps,
    health: (healthResult.data ?? []) as SystemHealthView[],
  };
}

export async function startAutomationRepair(errorId: string): Promise<RepairJobView> {
  const { data, error } = await (supabase as any).rpc("start_automation_repair", {
    p_error_id: errorId,
  });
  if (error) throw error;
  if (!data?.id) throw new Error("O servidor não retornou o job de reparo.");
  return data as RepairJobView;
}

export async function getArtifactUrl(path: string): Promise<string> {
  if (!path || path.includes("..") || path.startsWith("/")) {
    throw new Error("Caminho de artefato inválido.");
  }
  const { data, error } = await supabase.storage
    .from("automation-error-artifacts")
    .createSignedUrl(path, 60);
  if (error || !data?.signedUrl) throw error ?? new Error("Artefato indisponível.");
  return data.signedUrl;
}

export function subscribeToRecoveryDashboard(onChange: () => void): () => void {
  const channel = supabase
    .channel(`automation-recovery-center-${crypto.randomUUID()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "automation_errors" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "repair_jobs" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "repair_steps" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "system_health" }, onChange)
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
