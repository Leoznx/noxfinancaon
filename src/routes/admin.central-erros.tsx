import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  ExternalLink,
  Gauge,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Wrench,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { RouteErrorFallback } from "@/components/RouteErrorFallback";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getArtifactUrl,
  loadRecoveryDashboard,
  startAllAutomationRepairs,
  startAutomationRepair,
  subscribeToRecoveryDashboard,
  type AutomationErrorView,
  type RecoveryDashboardData,
  type RepairJobView,
  type SystemHealthView,
} from "@/lib/automation-recovery";

export const Route = createFileRoute("/admin/central-erros")({
  component: () => (
    <ProtectedRoute roles={["admin", "admin_master"]}>
      <RecoveryCenterPage />
    </ProtectedRoute>
  ),
  errorComponent: RouteErrorFallback,
});

const emptyData: RecoveryDashboardData = { errors: [], jobs: [], steps: [], health: [] };
const activeJobStatuses = new Set([
  "QUEUED",
  "COLLECTING_CONTEXT",
  "DIAGNOSING",
  "SNAPSHOTTING",
  "REPAIRING",
  "RESTARTING",
  "VALIDATING",
  "ROLLING_BACK",
]);

const categoryLabels: Record<string, string> = {
  SESSION_EXPIRED: "Sessão expirada",
  BROWSER_CRASH: "Navegador encerrou",
  BROWSER_PROFILE_LOCKED: "Perfil do navegador bloqueado",
  PLAYWRIGHT_TIMEOUT: "Tempo limite do navegador",
  SELECTOR_NOT_FOUND: "Elemento não encontrado",
  ELEMENT_NOT_VISIBLE: "Elemento não visível",
  CREDPAGO_UNAVAILABLE: "Parceiro indisponível",
  AUTHENTICATION_ERROR: "Falha de autenticação",
  NETWORK_ERROR: "Falha de rede",
  VPS_OFFLINE: "VPS fora do ar",
  VPS_HIGH_CPU: "CPU elevada",
  VPS_HIGH_MEMORY: "Memória elevada",
  VPS_LOW_DISK: "Disco baixo",
  WORKER_OFFLINE: "Worker fora do ar",
  DATABASE_ERROR: "Falha no banco",
  DEPLOY_ERROR: "Falha de deploy",
  DEPENDENCY_ERROR: "Falha de dependência",
  INTERNAL_SERVER_ERROR: "Erro interno",
  UNKNOWN_ERROR: "Erro não classificado",
};

const statusLabels: Record<string, string> = {
  NOVO: "Novo",
  ANALISANDO: "Analisando",
  CORRIGINDO: "Corrigindo",
  VALIDANDO: "Validando",
  CORRIGIDO: "Corrigido",
  FALHOU: "Falhou",
  ROLLBACK_REALIZADO: "Rollback realizado",
  INTERVENCAO_NECESSARIA: "Análise de IA",
  QUEUED: "Na fila",
  COLLECTING_CONTEXT: "Coletando contexto",
  DIAGNOSING: "Diagnosticando",
  SNAPSHOTTING: "Criando ponto de recuperação",
  REPAIRING: "Reparando",
  RESTARTING: "Reiniciando worker",
  VALIDATING: "Validando",
  SUCCESS: "Sucesso",
  FAILED: "Falhou",
  ROLLING_BACK: "Revertendo",
  ROLLED_BACK: "Revertido",
  MANUAL_REQUIRED: "Análise de IA",
};

function aiPresentation(value?: string | null): string {
  return String(value ?? "")
    .replaceAll("Análise humana necessária", "Análise de IA automática agendada")
    .replaceAll("Analise humana necessaria", "Análise de IA automática agendada")
    .replaceAll("Intervenção necessária", "Análise de IA")
    .replaceAll("Intervencao necessaria", "Análise de IA")
    .replaceAll("MANUAL_INTERVENTION", "AI_DIAGNOSE_AND_RECOVER");
}

function formatDate(value?: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

function statusClasses(status: string): string {
  if (["CORRIGIDO", "SUCCESS", "ONLINE"].includes(status))
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (["FALHOU", "FAILED", "OFFLINE", "CRITICAL"].includes(status))
    return "border-red-200 bg-red-50 text-red-700";
  if (
    [
      "INTERVENCAO_NECESSARIA",
      "MANUAL_REQUIRED",
      "ROLLBACK_REALIZADO",
      "ROLLED_BACK",
      "UNSTABLE",
      "ERROR",
    ].includes(status)
  )
    return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-blue-200 bg-blue-50 text-blue-700";
}

function StatusBadge({ value }: { value: string }) {
  return (
    <Badge variant="outline" className={`whitespace-nowrap ${statusClasses(value)}`}>
      {statusLabels[value] ?? value.replaceAll("_", " ")}
    </Badge>
  );
}

function latestHealth(rows: SystemHealthView[]): SystemHealthView[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.service}:${row.component}:${row.environment}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function RecoveryCenterPage() {
  const [data, setData] = useState<RecoveryDashboardData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [live, setLive] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ABERTOS");
  const [category, setCategory] = useState("TODAS");
  const [selected, setSelected] = useState<AutomationErrorView | null>(null);
  const [startingRepair, setStartingRepair] = useState(false);
  const [startingAll, setStartingAll] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      setData(await loadRecoveryDashboard());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível carregar a central.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const unsubscribe = subscribeToRecoveryDashboard(() => {
      setLive(true);
      void load(true);
    });
    const poll = window.setInterval(() => void load(true), 15_000);
    return () => {
      unsubscribe();
      window.clearInterval(poll);
    };
  }, [load]);

  useEffect(() => {
    setSelected((current) => {
      if (!current) return current;
      return data.errors.find((row) => row.id === current.id) ?? current;
    });
  }, [data.errors]);

  const jobsByError = useMemo(() => {
    const map = new Map<string, RepairJobView[]>();
    for (const job of data.jobs) map.set(job.error_id, [...(map.get(job.error_id) ?? []), job]);
    return map;
  }, [data.jobs]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return data.errors.filter((error) => {
      if (status === "ABERTOS" && error.status === "CORRIGIDO") return false;
      if (status !== "TODOS" && status !== "ABERTOS" && error.status !== status) return false;
      if (category !== "TODAS" && error.category !== category) return false;
      if (!term) return true;
      return [error.correlation_id, error.category, error.message_redacted, error.simulation_id]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [category, data.errors, search, status]);

  const health = latestHealth(data.health);
  const openCount = data.errors.filter((error) => error.status !== "CORRIGIDO").length;
  const criticalCount = data.errors.filter(
    (error) => error.status !== "CORRIGIDO" && error.severity === "CRITICAL",
  ).length;
  const activeRepairs = data.jobs.filter((job) => activeJobStatuses.has(job.status)).length;
  const onlineComponents = health.filter((item) => item.status === "ONLINE").length;

  const beginRepair = async (error: AutomationErrorView) => {
    setStartingRepair(true);
    try {
      const job = await startAutomationRepair(error.id);
      toast.success(
        activeJobStatuses.has(job.status)
          ? "Reparo persistente iniciado. Você pode fechar esta página."
          : "Este erro já possui um reparo registrado.",
      );
      await load(true);
    } catch (repairError) {
      toast.error(
        repairError instanceof Error ? repairError.message : "Não foi possível iniciar o reparo.",
      );
    } finally {
      setStartingRepair(false);
    }
  };

  const beginAllRepairs = async () => {
    setStartingAll(true);
    try {
      const result = await startAllAutomationRepairs();
      toast.success(
        result.queued_count > 0
          ? `${result.queued_count} erro(s) enviados para análise de IA.`
          : "Todos os erros abertos já estão em análise.",
      );
      await load(true);
    } catch (repairError) {
      toast.error(
        repairError instanceof Error ? repairError.message : "Não foi possível iniciar os reparos.",
      );
    } finally {
      setStartingAll(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 pb-10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">
                Central de Auto-Recuperação por IA
              </h1>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${live ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-neutral-200 bg-neutral-100 text-neutral-500"}`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${live ? "animate-pulse bg-emerald-500" : "bg-neutral-400"}`}
                />
                {live ? "Ao vivo" : "Polling ativo"}
              </span>
            </div>
            <p className="mt-2 max-w-3xl text-sm font-medium text-neutral-500 sm:text-base">
              Todo erro novo é analisado automaticamente; a IA seleciona um runbook seguro, repara e
              valida a automação de crédito.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={startingAll || openCount === 0}>
                  {startingAll ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  Reparar todos com IA
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Analisar todos os erros abertos?</AlertDialogTitle>
                  <AlertDialogDescription>
                    A IA colocará apenas os erros sem reparo ativo na fila. Os jobs continuam na VPS
                    mesmo se esta página for fechada.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void beginAllRepairs()}>
                    Reparar todos
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button variant="outline" onClick={() => void load()} disabled={refreshing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="Erros abertos" value={openCount} icon={AlertTriangle} tone="amber" />
          <MetricCard title="Críticos" value={criticalCount} icon={XCircle} tone="red" />
          <MetricCard title="Reparos ativos" value={activeRepairs} icon={Wrench} tone="blue" />
          <MetricCard
            title="Componentes online"
            value={`${onlineComponents}/${health.length || 0}`}
            icon={ShieldCheck}
            tone="green"
          />
        </div>

        <Card className="overflow-hidden shadow-sm">
          <CardHeader className="border-b bg-neutral-50/70 pb-4">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Gauge className="h-5 w-5 text-primary" /> Saúde do sistema
              </CardTitle>
              <span className="text-xs text-neutral-500">checagem automática na VPS</span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {health.length ? (
              <div className="grid divide-y md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-4">
                {health.map((item) => (
                  <div key={item.id} className="space-y-2 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-bold text-neutral-800">
                        {item.component.replaceAll("_", " ")}
                      </span>
                      <StatusBadge value={item.status} />
                    </div>
                    <p className="line-clamp-2 text-xs text-neutral-500">{item.summary}</p>
                    <p className="text-[11px] text-neutral-400">{formatDate(item.checked_at)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="p-6 text-sm text-neutral-500">
                Ainda não há uma leitura de saúde registrada pelo worker de reparo.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_240px]">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por correlação, categoria, mensagem ou simulação..."
            className="h-11"
          />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ABERTOS">Todos os abertos</SelectItem>
              <SelectItem value="TODOS">Todos os status</SelectItem>
              {Object.entries(statusLabels)
                .filter(
                  ([key]) =>
                    ![
                      "QUEUED",
                      "COLLECTING_CONTEXT",
                      "DIAGNOSING",
                      "SNAPSHOTTING",
                      "REPAIRING",
                      "RESTARTING",
                      "SUCCESS",
                      "FAILED",
                      "ROLLING_BACK",
                      "ROLLED_BACK",
                      "MANUAL_REQUIRED",
                    ].includes(key),
                )
                .map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TODAS">Todas as categorias</SelectItem>
              {Object.entries(categoryLabels).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card className="overflow-hidden shadow-sm">
          <div className="hidden grid-cols-[1.3fr_1fr_130px_130px_120px_32px] gap-4 border-b bg-neutral-50 px-5 py-3 text-xs font-bold uppercase tracking-wide text-neutral-500 lg:grid">
            <span>Falha</span>
            <span>Correlação</span>
            <span>Status</span>
            <span>Ocorrência</span>
            <span>Reparo</span>
            <span />
          </div>
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-12 text-sm text-neutral-500">
              <Loader2 className="h-5 w-5 animate-spin" /> Carregando falhas...
            </div>
          ) : filtered.length ? (
            <div className="divide-y">
              {filtered.map((error) => {
                const job = jobsByError.get(error.id)?.[0];
                return (
                  <button
                    key={error.id}
                    type="button"
                    onClick={() => setSelected(error)}
                    className="grid w-full gap-3 px-5 py-4 text-left transition hover:bg-neutral-50 lg:grid-cols-[1.3fr_1fr_130px_130px_120px_32px] lg:items-center lg:gap-4"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <SeverityDot severity={error.severity} />
                        <p className="truncate text-sm font-bold text-neutral-900">
                          {categoryLabels[error.category] ?? error.category}
                        </p>
                      </div>
                      <p className="mt-1 line-clamp-1 text-xs text-neutral-500">
                        {aiPresentation(error.message_redacted)}
                      </p>
                    </div>
                    <code className="truncate rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-700">
                      {error.correlation_id}
                    </code>
                    <div>
                      <StatusBadge value={error.status} />
                    </div>
                    <div className="text-xs text-neutral-600">
                      <p>{formatDate(error.last_seen_at)}</p>
                      <p>{error.occurrence_count} ocorrência(s)</p>
                    </div>
                    <div>
                      {job ? (
                        <StatusBadge value={job.status} />
                      ) : (
                        <span className="text-xs text-neutral-400">Não iniciado</span>
                      )}
                    </div>
                    <ChevronRight className="hidden h-4 w-4 text-neutral-400 lg:block" />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="p-12 text-center">
              <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-500" />
              <p className="mt-3 text-sm font-semibold text-neutral-700">
                Nenhum erro encontrado neste filtro.
              </p>
            </div>
          )}
        </Card>
      </div>

      <ErrorDetailDialog
        error={selected}
        jobs={selected ? (jobsByError.get(selected.id) ?? []) : []}
        steps={
          selected
            ? data.steps.filter((step) =>
                (jobsByError.get(selected.id) ?? []).some((job) => job.id === step.job_id),
              )
            : []
        }
        startingRepair={startingRepair}
        onClose={() => setSelected(null)}
        onRepair={beginRepair}
      />
    </DashboardLayout>
  );
}

function MetricCard({
  title,
  value,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string | number;
  icon: typeof AlertTriangle;
  tone: "amber" | "red" | "blue" | "green";
}) {
  const tones = {
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    blue: "bg-blue-50 text-blue-700",
    green: "bg-emerald-50 text-emerald-700",
  };
  return (
    <Card className="shadow-sm">
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">{title}</p>
          <p className="mt-1 text-2xl font-black text-neutral-900">{value}</p>
        </div>
        <span className={`rounded-xl p-3 ${tones[tone]}`}>
          <Icon className="h-5 w-5" />
        </span>
      </CardContent>
    </Card>
  );
}

function SeverityDot({ severity }: { severity: AutomationErrorView["severity"] }) {
  const color =
    severity === "CRITICAL"
      ? "bg-red-500"
      : severity === "ERROR"
        ? "bg-amber-500"
        : severity === "WARNING"
          ? "bg-yellow-400"
          : "bg-blue-400";
  return <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${color}`} title={severity} />;
}

function ErrorDetailDialog({
  error,
  jobs,
  steps,
  startingRepair,
  onClose,
  onRepair,
}: {
  error: AutomationErrorView | null;
  jobs: RepairJobView[];
  steps: RecoveryDashboardData["steps"];
  startingRepair: boolean;
  onClose: () => void;
  onRepair: (error: AutomationErrorView) => Promise<void>;
}) {
  const currentJob = jobs[0];
  const currentSteps = currentJob ? steps.filter((step) => step.job_id === currentJob.id) : [];
  const canRepair =
    error &&
    error.status !== "CORRIGIDO" &&
    !currentJob?.status.startsWith("SUCCESS") &&
    !activeJobStatuses.has(currentJob?.status ?? "");
  const screenshotPath = error?.artifacts?.screenshotPath;
  const domPath = error?.artifacts?.domPath;

  const openArtifact = async (path: unknown) => {
    if (typeof path !== "string") return;
    try {
      window.open(await getArtifactUrl(path), "_blank", "noopener,noreferrer");
    } catch (artifactError) {
      toast.error(
        artifactError instanceof Error ? artifactError.message : "Artefato indisponível.",
      );
    }
  };

  return (
    <Dialog open={!!error} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] w-[calc(100%-1rem)] max-w-5xl overflow-y-auto p-0 sm:w-full">
        {error ? (
          <>
            <DialogHeader className="border-b p-5 pr-12 sm:p-6">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityDot severity={error.severity} />
                <DialogTitle>{categoryLabels[error.category] ?? error.category}</DialogTitle>
                <StatusBadge value={error.status} />
              </div>
              <DialogDescription className="break-all font-mono text-xs">
                {error.correlation_id}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-6 p-5 sm:p-6">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Detail label="Ambiente" value={error.environment} />
                <Detail label="Serviço" value={error.service} />
                <Detail label="Versão" value={error.automation_version ?? error.deploy_version} />
                <Detail
                  label="Duração"
                  value={
                    error.duration_ms == null ? "—" : `${(error.duration_ms / 1000).toFixed(1)}s`
                  }
                />
                <Detail label="Etapa da falha" value={error.automation_step} />
                <Detail label="Última etapa concluída" value={error.last_successful_step} />
                <Detail label="Primeira ocorrência" value={formatDate(error.first_seen_at)} />
                <Detail label="Última ocorrência" value={formatDate(error.last_seen_at)} />
              </div>

              <section className="rounded-xl border bg-neutral-50 p-4">
                <h3 className="text-sm font-bold text-neutral-900">Mensagem sanitizada</h3>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-neutral-700">
                  {aiPresentation(error.message_redacted)}
                </p>
                {error.initial_diagnosis && (
                  <p className="mt-3 border-t pt-3 text-sm text-neutral-600">
                    <strong>Análise inicial da IA:</strong>{" "}
                    {aiPresentation(error.initial_diagnosis)}
                  </p>
                )}
              </section>

              {(typeof screenshotPath === "string" || typeof domPath === "string") && (
                <section>
                  <h3 className="mb-3 text-sm font-bold text-neutral-900">Artefatos protegidos</h3>
                  <div className="flex flex-wrap gap-2">
                    {typeof screenshotPath === "string" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void openArtifact(screenshotPath)}
                      >
                        <ExternalLink className="mr-2 h-4 w-4" /> Screenshot sanitizado
                      </Button>
                    )}
                    {typeof domPath === "string" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void openArtifact(domPath)}
                      >
                        <ExternalLink className="mr-2 h-4 w-4" /> Contexto do formulário
                      </Button>
                    )}
                  </div>
                </section>
              )}

              <section>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-bold text-neutral-900">Análise e reparo por IA</h3>
                  {error.status !== "CORRIGIDO" && (
                    <Button
                      onClick={() => void onRepair(error)}
                      disabled={!canRepair || startingRepair}
                    >
                      {startingRepair ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="mr-2 h-4 w-4" />
                      )}
                      {activeJobStatuses.has(currentJob?.status ?? "")
                        ? "IA em execução"
                        : "Analisar com IA"}
                    </Button>
                  )}
                </div>
                {currentJob ? (
                  <div className="space-y-4 rounded-xl border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <StatusBadge value={currentJob.status} />
                      <span className="text-xs font-semibold text-neutral-500">
                        Tentativa {currentJob.attempt_count}/{currentJob.max_attempts}
                      </span>
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between text-xs text-neutral-500">
                        <span>{aiPresentation(currentJob.stage_message)}</span>
                        <span>{currentJob.progress}%</span>
                      </div>
                      <Progress value={currentJob.progress} />
                    </div>
                    {currentJob.result_summary && (
                      <p className="text-sm text-emerald-700">
                        {aiPresentation(currentJob.result_summary)}
                      </p>
                    )}
                    {currentJob.failure_reason && (
                      <p className="text-sm text-red-700">
                        {aiPresentation(currentJob.failure_reason)}
                      </p>
                    )}
                    {currentJob.rollback_reason && (
                      <p className="flex items-center gap-2 text-sm text-amber-700">
                        <RotateCcw className="h-4 w-4" />{" "}
                        {aiPresentation(currentJob.rollback_reason)}
                      </p>
                    )}
                    <div className="space-y-2 border-t pt-4">
                      {currentSteps.length ? (
                        currentSteps.map((step) => (
                          <div key={step.id} className="flex gap-3">
                            <StepIcon status={step.status} />
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-neutral-800">
                                {statusLabels[step.stage] ?? step.stage.replaceAll("_", " ")}
                              </p>
                              <p className="break-words text-xs text-neutral-500">
                                {aiPresentation(step.message)}
                              </p>
                              <p className="text-[10px] text-neutral-400">
                                {formatDate(step.started_at)}
                              </p>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-neutral-500">
                          O job está aguardando o worker registrar a primeira etapa.
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed p-6 text-center text-sm text-neutral-500">
                    Nenhum reparo iniciado para esta falha.
                  </div>
                )}
              </section>

              {jobs.length > 1 && (
                <section>
                  <h3 className="mb-3 text-sm font-bold text-neutral-900">Histórico de reparos</h3>
                  <div className="space-y-2">
                    {jobs.slice(1).map((job) => (
                      <div
                        key={job.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
                      >
                        <div>
                          <p className="text-xs font-semibold">{formatDate(job.created_at)}</p>
                          <p className="text-xs text-neutral-500">
                            {aiPresentation(
                              job.result_summary ?? job.failure_reason ?? job.stage_message,
                            )}
                          </p>
                        </div>
                        <StatusBadge value={job.status} />
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-neutral-700">{value || "—"}</p>
    </div>
  );
}

function StepIcon({ status }: { status: string }) {
  if (status === "SUCCESS")
    return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />;
  if (status === "FAILED") return <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />;
  if (status === "RUNNING")
    return <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-blue-500" />;
  return <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />;
}
