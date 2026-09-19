import { createFileRoute, Navigate, useNavigate, useSearch } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  Users2,
  Target,
  DollarSign,
  ChevronLeft,
  ChevronRight,
  Users,
  Briefcase,
  Gift,
  Clock3,
  CalendarDays,
  Sparkles,
  Radio,
  CheckCircle2,
  AlertTriangle,
  UserRound,
} from "lucide-react";
import { z } from "zod";
import { addMonths, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth } from "@/components/AuthProvider";
import { registrarAuditoria } from "@/lib/auditoria";
import { formatMoney, formatDateTime, toDatetimeLocal } from "@/lib/vendedor-portal";
import {
  fetchTeamGoalConfigs,
  fetchTeamGoalProgress,
  saveTeamGoals,
  type TeamGoalConfig,
  type TeamGoalProgress,
} from "@/lib/admin-team-goals";
import { TabColaboradores, TabEquipeComercial } from "./admin.equipe-permissoes";
import { SellerRewardsTab } from "@/components/admin/SellerRewardsTab";
import { TimeClockHistoryTab } from "@/components/admin/TimeClockHistoryTab";
import { NoxEmployeeInviteCards } from "@/components/admin/NoxEmployeeInviteCards";

const VALID_TABS = [
  "metas",
  "recompensas",
  "agenda",
  "reunioes",
  "comissoes",
  "colaboradores",
  "equipe-comercial",
  "historico-ponto",
  "auditoria",
] as const;
type TabKey = (typeof VALID_TABS)[number];
type VisibleTabKey = Exclude<TabKey, "equipe-comercial">;

const searchSchema = z.object({ tab: z.enum(VALID_TABS).optional() });

export const Route = createFileRoute("/admin/equipe-nox")({
  validateSearch: (s) => searchSchema.parse(s),
  component: () => (
    <ProtectedRoute roles={["admin", "admin_master", "analista"]} moduleKey="equipe_nox">
      <EquipeNoxPage />
    </ProtectedRoute>
  ),
});

function EquipeNoxPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const search = useSearch({ from: "/admin/equipe-nox" });
  const requestedTab: TabKey = (search.tab as TabKey) ?? "metas";
  const activeTab: VisibleTabKey =
    requestedTab === "equipe-comercial"
      ? "comissoes"
      : requestedTab === "agenda"
        ? "reunioes"
        : requestedTab;
  const setTab = (t: VisibleTabKey) =>
    navigate({ to: "/admin/equipe-nox", search: { tab: t } as any, replace: true });
  const canManageTimeClock =
    user?.role === "admin" ||
    user?.role === "admin_master" ||
    user?.internalRole === "admin_master";

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <section className="relative overflow-hidden rounded-[2rem] bg-neutral-950 px-6 py-7 text-white shadow-xl shadow-neutral-950/10 sm:px-8 sm:py-9">
          <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-yellow-400/20 blur-3xl" />
          <div className="relative flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-2xl">
              <Badge className="border-yellow-400/20 bg-yellow-400 text-neutral-950 hover:bg-yellow-400">
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Central de gestão de pessoas
              </Badge>
              <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">Equipe NOX</h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-neutral-300 sm:text-base">
                Controle colaboradores, metas, agenda, desempenho e jornada em uma experiência única, clara e atualizada em tempo real.
              </p>
            </div>
            <div className="grid min-w-[240px] grid-cols-2 gap-2 text-xs font-bold">
              <button type="button" onClick={() => setTab("reunioes")} className="rounded-2xl border border-white/10 bg-white/10 p-3 text-left transition hover:border-yellow-400/60 hover:bg-white/15">
                <CalendarDays className="mb-2 h-5 w-5 text-yellow-400" />
                Reunião com a equipe
              </button>
              <button type="button" onClick={() => void navigate({ to: "/admin/agenda-closers" })} className="rounded-2xl border border-white/10 bg-white/10 p-3 text-left transition hover:border-yellow-400/60 hover:bg-white/15">
                <Radio className="mb-2 h-5 w-5 text-emerald-400" />
                Agenda em tempo real
              </button>
            </div>
          </div>
        </section>

        <Tabs value={activeTab} onValueChange={(v) => setTab(v as VisibleTabKey)}>
          <TabsList className="h-auto w-full flex-wrap justify-start gap-1 rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-sm">
            <TabsTrigger value="reunioes">
              <CalendarDays className="mr-2 h-4 w-4" />
              Reunião com a equipe
            </TabsTrigger>
            <TabsTrigger value="metas">
              <Target className="mr-2 h-4 w-4" />
              Metas
            </TabsTrigger>
            <TabsTrigger value="recompensas">
              <Gift className="mr-2 h-4 w-4" />
              Recompensas
            </TabsTrigger>
            <TabsTrigger value="comissoes">
              <DollarSign className="mr-2 h-4 w-4" />
              Comissões e equipe
            </TabsTrigger>
            <TabsTrigger value="colaboradores">
              <Users className="mr-2 h-4 w-4" />
              Colaboradores
            </TabsTrigger>
            {canManageTimeClock && (
              <TabsTrigger value="historico-ponto">
                <Clock3 className="mr-2 h-4 w-4" />
                Histórico de ponto
              </TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="metas" className="mt-4">
            <TabMetas />
          </TabsContent>
          <TabsContent value="recompensas" className="mt-4">
            <SellerRewardsTab />
          </TabsContent>
          <TabsContent value="reunioes" className="mt-4">
            <TabAgenda />
          </TabsContent>
          <TabsContent value="comissoes" className="mt-4">
            <TabComissoesEquipe
              initialView={requestedTab === "equipe-comercial" ? "equipe" : "comissoes"}
            />
          </TabsContent>
          <TabsContent value="colaboradores" className="mt-4">
            <NoxEmployeeInviteCards />
            <TabColaboradores />
          </TabsContent>
          {canManageTimeClock && (
            <TabsContent value="historico-ponto" className="mt-4">
              <TimeClockHistoryTab />
            </TabsContent>
          )}
          <TabsContent value="auditoria" className="mt-4">
            <Navigate to="/admin/equipe-nox" search={{ tab: "metas" } as any} replace />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function SeletorMes({
  month,
  year,
  onChange,
}: {
  month: number;
  year: number;
  onChange: (m: number, y: number) => void;
}) {
  const label = format(new Date(year, month - 1, 1), "MMMM 'de' yyyy", { locale: ptBR });
  const mudar = (delta: number) => {
    const data = addMonths(new Date(year, month - 1, 1), delta);
    onChange(data.getMonth() + 1, data.getFullYear());
  };
  return (
    <div className="flex items-center gap-1">
      <Button size="sm" variant="outline" onClick={() => mudar(-1)}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="w-36 text-center text-sm font-bold capitalize">{label}</span>
      <Button size="sm" variant="outline" onClick={() => mudar(1)}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

/* ===================== METAS ===================== */
type GoalPeriods = { daily: string; weekly: string; monthly: string };
type SellerGoalEdit = { meetings: GoalPeriods; registrations: GoalPeriods };

function initialGoalEdit(
  team: "sdr" | "closer",
  config?: TeamGoalConfig,
  row?: TeamGoalProgress,
): SellerGoalEdit {
  const scheduled = team === "sdr";
  return {
    meetings: {
      daily: String(
        config?.target_meetings_daily ??
          (scheduled
            ? (row?.target_meetings_scheduled_daily ?? "")
            : (row?.target_meetings_completed_daily ?? "")),
      ),
      weekly: String(
        config?.target_meetings_weekly ??
          (scheduled
            ? (row?.target_meetings_scheduled_weekly ?? "")
            : (row?.target_meetings_completed_weekly ?? "")),
      ),
      monthly: String(
        config?.target_meetings_monthly ??
          (scheduled
            ? (row?.target_meetings_scheduled_monthly ?? "")
            : (row?.target_meetings_completed_monthly ?? "")),
      ),
    },
    registrations: {
      daily: String(config?.target_clients_daily ?? row?.target_clients_daily ?? ""),
      weekly: String(config?.target_clients_weekly ?? row?.target_clients_weekly ?? ""),
      monthly: String(config?.target_clients_monthly ?? row?.target_clients_monthly ?? ""),
    },
  };
}

function TabMetas() {
  const { user } = useAuth();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [linhas, setLinhas] = useState<TeamGoalProgress[]>([]);
  const [configs, setConfigs] = useState<Partial<Record<"sdr" | "closer", TeamGoalConfig>>>({});
  const [team, setTeam] = useState<"sdr" | "closer">("sdr");
  const [edits, setEdits] = useState<Partial<Record<"sdr" | "closer", SellerGoalEdit>>>({});
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const [progress, goalConfigs] = await Promise.all([
        fetchTeamGoalProgress(month, year),
        fetchTeamGoalConfigs(month, year),
      ]);
      setLinhas(progress);
      setConfigs(
        Object.fromEntries(goalConfigs.map((config) => [config.seller_type, config])) as Partial<
          Record<"sdr" | "closer", TeamGoalConfig>
        >,
      );
      setEdits({});
    } catch (error: any) {
      toast.error(error.message || "Não foi possível carregar as metas da equipe.");
    } finally {
      setLoading(false);
    }
  }, [month, year]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const teamRows = linhas.filter((linha) => linha.seller_type === team);
  const teamConfig = configs[team];
  const edit = edits[team] ?? initialGoalEdit(team, teamConfig, teamRows[0]);

  useEffect(() => {
    const refresh = () => void carregar();
    const channel = supabase
      .channel("admin-seller-goals-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "seller_team_goals" }, refresh)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_appointments" },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_client_partnerships" },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_signup_attributions" },
        refresh,
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "apolices" }, refresh)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [carregar]);

  const salvar = async () => {
    const values = edit;
    const targets = {
      meetings: {
        daily: Number(values.meetings.daily),
        weekly: Number(values.meetings.weekly),
        monthly: Number(values.meetings.monthly),
      },
      registrations: {
        daily: Number(values.registrations.daily),
        weekly: Number(values.registrations.weekly),
        monthly: Number(values.registrations.monthly),
      },
    };
    const rawValues = [...Object.values(values.meetings), ...Object.values(values.registrations)];
    const numericValues = [
      ...Object.values(targets.meetings),
      ...Object.values(targets.registrations),
    ];
    if (
      rawValues.some((value) => value.trim() === "") ||
      numericValues.some((value) => !Number.isInteger(value) || value < 0)
    ) {
      toast.error("Preencha as seis metas da equipe com números inteiros.");
      return;
    }
    setSalvando(true);
    try {
      await saveTeamGoals(team, month, year, targets);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar.");
      setSalvando(false);
      return;
    }
    setSalvando(false);
    toast.success(`Metas da equipe ${team.toUpperCase()} atualizadas para todos.`);
    registrarAuditoria({
      actorUserId: user?.id,
      actorRole: user?.internalRole || user?.role,
      action: "definir_metas_comerciais_da_equipe",
      tableName: "seller_team_goals",
      recordId: `${team}-${year}-${month}`,
      before: teamConfig,
      after: { ...targets, seller_type: team, month, year },
    });
    void carregar();
  };

  const updateEdit = (
    metric: "meetings" | "registrations",
    period: "daily" | "weekly" | "monthly",
    value: string,
  ) => {
    setEdits((current) => ({
      ...current,
      [team]: {
        ...(current[team] ?? initialGoalEdit(team, teamConfig, teamRows[0])),
        [metric]: {
          ...(current[team] ?? initialGoalEdit(team, teamConfig, teamRows[0]))[metric],
          [period]: value.replace(/\D/g, ""),
        },
      },
    }));
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>Metas da equipe</CardTitle>
          <p className="text-sm text-muted-foreground">
            Escolha SDR ou Closer. A mesma meta será aplicada automaticamente a todos os integrantes
            ativos do time; os resultados continuam individuais e em tempo real.
          </p>
        </div>
        <SeletorMes
          month={month}
          year={year}
          onChange={(m, y) => {
            setMonth(m);
            setYear(y);
          }}
        />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
          <div className="space-y-2">
            <Label>Equipe</Label>
            <Select value={team} onValueChange={(value) => setTeam(value as "sdr" | "closer")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sdr">SDR · reuniões agendadas</SelectItem>
                <SelectItem value="closer">Closer · reuniões confirmadas</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <div className="space-y-5">
            <div className="space-y-4 rounded-xl border border-neutral-100 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-bold text-neutral-950">
                    Configuração única da equipe {team.toUpperCase()}
                  </p>
                  <Badge
                    variant="outline"
                    className={
                      team === "sdr"
                        ? "mt-1 border-yellow-300 bg-yellow-50"
                        : "mt-1 border-emerald-300 bg-emerald-50"
                    }
                  >
                    Aplicada a {teamRows.length} integrante{teamRows.length === 1 ? "" : "s"}
                  </Badge>
                </div>
                <Button size="sm" disabled={salvando} onClick={salvar}>
                  {salvando ? "Salvando…" : "Salvar para toda a equipe"}
                </Button>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-black text-neutral-950">
                  {team === "sdr" ? "Reuniões agendadas" : "Reuniões confirmadas"}
                </h3>
                <div className="grid gap-3 md:grid-cols-3">
                  <TeamMetaEditor
                    label="Meta por dia"
                    value={edit.meetings.daily}
                    onChange={(value) => updateEdit("meetings", "daily", value)}
                  />
                  <TeamMetaEditor
                    label="Meta por semana"
                    value={edit.meetings.weekly}
                    onChange={(value) => updateEdit("meetings", "weekly", value)}
                  />
                  <TeamMetaEditor
                    label="Meta por mês"
                    value={edit.meetings.monthly}
                    onChange={(value) => updateEdit("meetings", "monthly", value)}
                  />
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-black text-neutral-950">Cadastros realizados</h3>
                <div className="grid gap-3 md:grid-cols-3">
                  <TeamMetaEditor
                    label="Meta por dia"
                    value={edit.registrations.daily}
                    onChange={(value) => updateEdit("registrations", "daily", value)}
                  />
                  <TeamMetaEditor
                    label="Meta por semana"
                    value={edit.registrations.weekly}
                    onChange={(value) => updateEdit("registrations", "weekly", value)}
                  />
                  <TeamMetaEditor
                    label="Meta por mês"
                    value={edit.registrations.monthly}
                    onChange={(value) => updateEdit("registrations", "monthly", value)}
                  />
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <h3 className="font-black text-neutral-950">Progresso individual do time</h3>
                <p className="text-xs text-muted-foreground">
                  Todos recebem a mesma meta acima; somente os resultados realizados são
                  individuais.
                </p>
              </div>
              {teamRows.length === 0 ? (
                <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
                  Nenhum colaborador ativo nesta equipe. A meta ficará pronta para os próximos
                  integrantes.
                </p>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {teamRows.map((row) => (
                    <TeamMemberProgress key={row.seller_id} row={row} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TeamMetaEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="rounded-xl bg-neutral-50 p-3">
      <Label className="text-xs font-bold">{label}</Label>
      <div className="mt-2">
        <Input
          type="number"
          min={0}
          step={1}
          value={value}
          placeholder="Definir"
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}

function TeamMemberProgress({ row }: { row: TeamGoalProgress }) {
  const meetings =
    row.seller_type === "sdr"
      ? [
          row.meetings_scheduled_daily,
          row.meetings_scheduled_weekly,
          row.meetings_scheduled_monthly,
        ]
      : [
          row.meetings_completed_daily,
          row.meetings_completed_weekly,
          row.meetings_completed_monthly,
        ];
  const meetingTargets =
    row.seller_type === "sdr"
      ? [
          row.target_meetings_scheduled_daily,
          row.target_meetings_scheduled_weekly,
          row.target_meetings_scheduled_monthly,
        ]
      : [
          row.target_meetings_completed_daily,
          row.target_meetings_completed_weekly,
          row.target_meetings_completed_monthly,
        ];
  const registrations = [
    row.clients_registered_daily,
    row.clients_registered_weekly,
    row.clients_registered_monthly,
  ];
  const registrationTargets = [
    row.target_clients_daily,
    row.target_clients_weekly,
    row.target_clients_monthly,
  ];
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <p className="font-black text-neutral-950">{row.seller_name}</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {(["Dia", "Semana", "Mês"] as const).map((period, index) => (
          <div key={period} className="rounded-lg bg-neutral-50 p-2">
            <p className="text-[10px] font-black uppercase text-neutral-400">{period}</p>
            <p className="mt-1 text-xs font-bold">
              Reuniões {meetings[index]}/{meetingTargets[index] ?? "—"}
            </p>
            <p className="text-xs font-bold">
              Cadastros {registrations[index]}/{registrationTargets[index] ?? "—"}
            </p>
            <Progress
              value={
                meetingTargets[index]
                  ? Math.min(100, Math.round((meetings[index] / meetingTargets[index]!) * 100))
                  : 0
              }
              className="mt-2 h-1.5"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ===================== AGENDA ===================== */
const STATUS_LABEL: Record<string, string> = {
  agendado: "Agendado",
  confirmado: "Confirmado",
  remarcado: "Remarcado",
  em_andamento: "Em andamento",
  concluido: "Concluído",
  cancelado: "Cancelado",
  nao_compareceu: "Não compareceu",
};
const STATUS_COLOR: Record<string, string> = {
  agendado: "bg-blue-100 text-blue-800",
  confirmado: "bg-emerald-100 text-emerald-800",
  remarcado: "bg-amber-100 text-amber-800",
  em_andamento: "bg-indigo-100 text-indigo-800",
  concluido: "bg-green-100 text-green-800",
  cancelado: "bg-neutral-200 text-neutral-700",
  nao_compareceu: "bg-red-100 text-red-800",
};

function defaultAdminMeetingDate() {
  const date = new Date(Date.now() + 2 * 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  if (date.getHours() < 8) date.setHours(8);
  if (date.getHours() === 12) date.setHours(13);
  if (date.getHours() >= 17) {
    date.setDate(date.getDate() + 1);
    date.setHours(8);
  }
  while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1);
  return toDatetimeLocal(date.toISOString());
}

function TabAgenda() {
  const { user } = useAuth();
  const [vendedores, setVendedores] = useState<any[]>([]);
  const [grupos, setGrupos] = useState<{ id: string; rows: any[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [destino, setDestino] = useState<"geral" | "selecionados">("geral");
  const [sellerIds, setSellerIds] = useState<string[]>([]);
  const [titulo, setTitulo] = useState("");
  const [dataHora, setDataHora] = useState(defaultAdminMeetingDate);
  const [notas, setNotas] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [checking, setChecking] = useState(false);
  const [availability, setAvailability] = useState<any[]>([]);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    const [{ data: vs }, { data: rows }] = await Promise.all([
      supabase
        .from("internal_users" as any)
        .select("id, full_name, seller_type")
        .eq("role", "vendedor")
        .eq("status", "ativo")
        .order("full_name"),
      supabase
        .from("seller_appointments" as any)
        .select("*, internal_users(full_name)")
        .not("meeting_group_id", "is", null)
        .eq("source", "admin")
        .order("scheduled_at", { ascending: false }),
    ]);
    setVendedores((vs as any[]) ?? []);
    const mapa = new Map<string, any[]>();
    for (const row of (rows as any[]) ?? []) {
      const lista = mapa.get(row.meeting_group_id) ?? [];
      lista.push(row);
      mapa.set(row.meeting_group_id, lista);
    }
    setGrupos(Array.from(mapa.entries()).map(([id, groupRows]) => ({ id, rows: groupRows })));
    setLoading(false);
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    const refresh = () => void carregar();
    const channel = supabase
      .channel("admin-team-meetings-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "seller_appointments" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "internal_users" }, refresh)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [carregar]);

  const activeTargetIds = destino === "geral" ? vendedores.map((v) => v.id) : sellerIds;
  const activeTargetCount = activeTargetIds.length;

  useEffect(() => {
    const scheduled = new Date(dataHora);
    if (!dataHora || Number.isNaN(scheduled.getTime()) || activeTargetCount === 0) {
      setAvailability([]);
      setAvailabilityError(null);
      setChecking(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    setAvailabilityError(null);
    const timer = window.setTimeout(async () => {
      const { data, error } = await (supabase as any).rpc("check_admin_team_meeting_availability", {
        p_participant_ids: destino === "geral" ? [] : sellerIds,
        p_scheduled_at: scheduled.toISOString(),
        p_all_sellers: destino === "geral",
      });
      if (cancelled) return;
      setAvailability(error ? [] : ((data as any[]) ?? []));
      setAvailabilityError(error ? "Não foi possível conferir as agendas. Tente novamente." : null);
      setChecking(false);
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeTargetCount, dataHora, destino, sellerIds]);

  const busy = availability.filter((row) => !row.is_available);
  const availabilityConfirmed =
    !checking &&
    !availabilityError &&
    activeTargetCount > 0 &&
    availability.length === activeTargetCount;

  const toggleSeller = (id: string) => {
    setSellerIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  const criar = async () => {
    if (!titulo.trim()) {
      toast.error("Informe um título para a reunião.");
      return;
    }
    if (destino === "selecionados" && sellerIds.length === 0) {
      toast.error("Selecione pelo menos um colaborador.");
      return;
    }
    if (vendedores.length === 0) {
      toast.error("Nenhum vendedor ativo cadastrado.");
      return;
    }

    setSalvando(true);
    const scheduled = new Date(dataHora);
    if (Number.isNaN(scheduled.getTime())) {
      toast.error("Informe uma data e um horário válidos.");
      setSalvando(false);
      return;
    }
    if (busy.length > 0) {
      toast.error(`Escolha outro horário. ${busy.map((row) => row.participant_name).join(", ")} já possui reunião.`);
      setSalvando(false);
      return;
    }
    const { data, error } = await (supabase as any).rpc("schedule_admin_team_meeting", {
      p_title: titulo.trim(),
      p_notes: notas.trim() || null,
      p_scheduled_at: scheduled.toISOString(),
      p_participant_ids: destino === "geral" ? [] : sellerIds,
      p_all_sellers: destino === "geral",
    });
    setSalvando(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const result = Array.isArray(data) ? data[0] : data;
    const groupId = result?.meeting_group_id ?? "reuniao-equipe";
    const participantCount = Number(result?.participant_count ?? activeTargetCount);
    toast.success(`Reunião agendada para ${participantCount} colaborador${participantCount === 1 ? "" : "es"}.`);
    registrarAuditoria({
      actorUserId: user?.id,
      actorRole: user?.internalRole || user?.role,
      action: "criar_reuniao_equipe",
      tableName: "seller_appointments",
      recordId: groupId,
      after: {
        title: titulo.trim(),
        destino,
        vendedores: participantCount,
        scheduled_at: scheduled.toISOString(),
      },
    });
    setTitulo("");
    setNotas("");
    setSellerIds([]);
    void carregar();
  };

  const cancelarGrupo = async (groupId: string) => {
    const { error } = await (supabase as any).rpc("cancel_admin_team_meeting", {
      p_meeting_group_id: groupId,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Reunião cancelada.");
    registrarAuditoria({
      actorUserId: user?.id,
      actorRole: user?.internalRole || user?.role,
      action: "cancelar_reuniao_equipe",
      tableName: "seller_appointments",
      recordId: groupId,
      after: { status: "cancelado" },
    });
    void carregar();
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,.95fr)]">
      <Card className="overflow-hidden border-neutral-200 shadow-sm">
        <CardHeader className="border-b border-neutral-100 bg-gradient-to-br from-yellow-50 to-white">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-yellow-400 text-neutral-950 shadow-sm">
              <CalendarDays className="h-5 w-5" />
            </span>
            <div>
              <CardTitle>Nova reunião com a equipe</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Selecione uma ou várias pessoas. O sistema confirma a disponibilidade de todos antes de reservar.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setDestino("geral")}
              className={`rounded-md border px-3 py-1.5 text-xs font-bold ${destino === "geral" ? "border-yellow-400 bg-yellow-50 text-yellow-800" : "bg-white"}`}
            >
              Toda a equipe comercial
            </button>
            <button
              type="button"
              onClick={() => setDestino("selecionados")}
              className={`rounded-md border px-3 py-1.5 text-xs font-bold ${destino === "selecionados" ? "border-yellow-400 bg-yellow-50 text-yellow-800" : "bg-white"}`}
            >
              Selecionar participantes
            </button>
          </div>
          {destino === "selecionados" && (
            <div className="grid gap-2 sm:grid-cols-2">
              {vendedores.map((v) => {
                const selected = sellerIds.includes(v.id);
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => toggleSeller(v.id)}
                    className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${selected ? "border-yellow-400 bg-yellow-50" : "border-neutral-200 bg-white hover:border-yellow-300"}`}
                  >
                    <span className={`grid h-8 w-8 place-items-center rounded-full ${selected ? "bg-yellow-400" : "bg-neutral-100"}`}>
                      {selected ? <CheckCircle2 className="h-4 w-4" /> : <UserRound className="h-4 w-4 text-neutral-500" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold">{v.full_name || "Vendedor"}</span>
                      <span className="text-[10px] font-black uppercase tracking-wider text-neutral-400">{v.seller_type || "comercial"}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <Input
            placeholder="Título da reunião"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
          />
          <Input
            type="datetime-local"
            value={dataHora}
            onChange={(e) => setDataHora(e.target.value)}
          />
          <Textarea
            placeholder="Pauta / observações (opcional)"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
          />
          <div className={`rounded-xl border p-3 ${busy.length > 0 || availabilityError ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}`}>
            {checking ? (
              <p className="flex items-center gap-2 text-sm font-bold text-neutral-600"><Clock3 className="h-4 w-4 animate-pulse" /> Conferindo todas as agendas…</p>
            ) : availabilityError ? (
              <p className="flex items-center gap-2 text-sm font-bold text-red-800"><AlertTriangle className="h-4 w-4" /> {availabilityError}</p>
            ) : activeTargetCount === 0 ? (
              <p className="text-sm font-bold text-amber-800">Selecione os participantes para verificar o horário.</p>
            ) : busy.length > 0 ? (
              <div className="text-sm text-red-800">
                <p className="flex items-center gap-2 font-black"><AlertTriangle className="h-4 w-4" /> Horário indisponível</p>
                {busy.map((row) => (
                  <p key={row.participant_id} className="mt-1 text-xs">
                    {row.participant_name}: {row.conflict_title || "outra reunião"} às {formatDateTime(row.conflict_start)}
                  </p>
                ))}
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm font-black text-emerald-800"><CheckCircle2 className="h-4 w-4" /> Todos disponíveis neste horário</p>
            )}
          </div>
          <Button
            className="bg-yellow-500 text-black hover:bg-yellow-600"
            disabled={salvando || !availabilityConfirmed || busy.length > 0}
            onClick={criar}
          >
            {salvando ? "Agendando…" : "Agendar reunião"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-neutral-200 shadow-sm">
        <CardHeader>
          <CardTitle>Agenda criada pela administração</CardTitle>
          <p className="text-sm text-muted-foreground">Os participantes recebem um sino amarelo e não podem reagendar nem excluir estes compromissos.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : grupos.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma reunião de equipe agendada ainda.
            </p>
          ) : (
            grupos.map((grupo) => {
              const primeira = grupo.rows[0];
              const todosMesmoStatus = grupo.rows.every((r) => r.status === primeira.status);
              const alvo =
                grupo.rows.length > 1 && grupo.rows.length === vendedores.length
                  ? `Todos os vendedores (${grupo.rows.length})`
                  : grupo.rows
                      .map((r) => r.internal_users?.full_name)
                      .filter(Boolean)
                      .join(", ");
              return (
                <div key={grupo.id} className="rounded-xl border border-neutral-100 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-neutral-950">{primeira.title}</p>
                      <p className="text-xs text-neutral-500">
                        {formatDateTime(primeira.scheduled_at)} · {alvo}
                      </p>
                      {primeira.notes && (
                        <p className="mt-1 text-xs text-neutral-500">{primeira.notes}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        className={
                          todosMesmoStatus
                            ? (STATUS_COLOR[primeira.status] ?? "")
                            : "bg-neutral-200 text-neutral-700"
                        }
                      >
                        {todosMesmoStatus
                          ? (STATUS_LABEL[primeira.status] ?? primeira.status)
                          : "Misto"}
                      </Badge>
                      {primeira.status !== "cancelado" && new Date(primeira.scheduled_at) > new Date() && (
                        <Button size="sm" variant="outline" onClick={() => cancelarGrupo(grupo.id)}>
                          Cancelar
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ===================== COMISSÕES ===================== */
function TabComissoesEquipe({ initialView }: { initialView: "comissoes" | "equipe" }) {
  const [view, setView] = useState(initialView);

  useEffect(() => setView(initialView), [initialView]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
        <div className="mb-3 px-1">
          <h2 className="font-black text-neutral-950">Controle comercial</h2>
          <p className="text-sm text-muted-foreground">
            Selecione entre lançamentos de comissão e desempenho da equipe comercial.
          </p>
        </div>
        <Tabs value={view} onValueChange={(value) => setView(value as "comissoes" | "equipe")}>
          <TabsList className="h-auto w-full justify-start">
            <TabsTrigger value="comissoes">
              <DollarSign className="mr-2 h-4 w-4" />
              Comissões
            </TabsTrigger>
            <TabsTrigger value="equipe">
              <Briefcase className="mr-2 h-4 w-4" />
              Equipe comercial
            </TabsTrigger>
          </TabsList>
          <TabsContent value="comissoes" className="mt-4">
            <TabComissoes />
          </TabsContent>
          <TabsContent value="equipe" className="mt-4">
            <TabEquipeComercial />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

const STATUS_COMISSAO = [
  { v: "aguardando_primeira_parcela", l: "Aguardando 1ª parcela" },
  { v: "pendente", l: "Pendente" },
  { v: "elegivel", l: "Elegível" },
  { v: "retida", l: "Retida" },
  { v: "liberada_parcial", l: "Liberada parcial" },
  { v: "liberada_total", l: "Liberada total" },
  { v: "estornada", l: "Estornada" },
  { v: "cancelada", l: "Cancelada" },
];

function TabComissoes() {
  const { user } = useAuth();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [vendedores, setVendedores] = useState<any[]>([]);
  const [linhas, setLinhas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [openNovo, setOpenNovo] = useState(false);
  const [editando, setEditando] = useState<any | null>(null);
  const [detalheSellerId, setDetalheSellerId] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    const [{ data: vs }, { data: rows }] = await Promise.all([
      supabase
        .from("internal_users" as any)
        .select("id, full_name, seller_type")
        .eq("role", "vendedor")
        .eq("status", "ativo")
        .order("full_name"),
      supabase
        .from("seller_commissions" as any)
        .select("*, internal_users(full_name, seller_type)")
        .eq("month", month)
        .eq("year", year)
        .order("created_at", { ascending: false }),
    ]);
    setVendedores((vs as any[]) ?? []);
    setLinhas((rows as any[]) ?? []);
    setLoading(false);
  }, [month, year]);
  useEffect(() => {
    carregar();
  }, [carregar]);
  useEffect(() => {
    const refresh = () => void carregar();
    const channel = supabase
      .channel("admin-team-commissions-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_commissions" },
        refresh,
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "internal_users" }, refresh)
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [carregar]);

  const salvar = async (form: any) => {
    if (!form.seller_id) {
      toast.error("Selecione o vendedor.");
      return;
    }
    const payload = {
      seller_id: form.seller_id,
      month,
      year,
      commission_amount: Number(form.commission_amount || 0),
      bonus_amount: Number(form.bonus_amount || 0),
      reserve_amount: Number(form.reserve_amount || 0),
      released_amount: Number(form.released_amount || 0),
      status: form.status,
    };
    const result = form.id
      ? await supabase
          .from("seller_commissions" as any)
          .update(payload)
          .eq("id", form.id)
      : await supabase.from("seller_commissions" as any).insert(payload);
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    toast.success(form.id ? "Comissão atualizada." : "Comissão lançada.");
    registrarAuditoria({
      actorUserId: user?.id,
      actorRole: user?.internalRole || user?.role,
      action: form.id ? "editar_comissao_manual" : "lancar_comissao_manual",
      tableName: "seller_commissions",
      recordId: form.id ?? form.seller_id,
      after: payload,
    });
    setOpenNovo(false);
    setEditando(null);
    carregar();
  };

  const totalMes = linhas.reduce(
    (s, l) => s + Number(l.commission_amount ?? 0) + Number(l.bonus_amount ?? 0),
    0,
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {vendedores.map((vendedor) => {
          const historico = linhas.filter((linha) => linha.seller_id === vendedor.id);
          const total = historico.reduce(
            (sum, linha) =>
              sum + Number(linha.commission_amount || 0) + Number(linha.bonus_amount || 0),
            0,
          );
          return (
            <button
              type="button"
              key={vendedor.id}
              onClick={() => setDetalheSellerId(vendedor.id)}
              className="rounded-xl border border-neutral-200 bg-white p-4 text-left transition hover:border-yellow-400 hover:shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <strong className="truncate text-sm">{vendedor.full_name}</strong>
                <Badge variant="outline">{(vendedor.seller_type || "sdr").toUpperCase()}</Badge>
              </div>
              <p className="mt-3 text-2xl font-black">{formatMoney(total)}</p>
              <p className="text-xs text-neutral-500">
                {historico.length} lançamento(s) · clique para o histórico
              </p>
            </button>
          );
        })}
      </div>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Comissões da equipe</CardTitle>
            <p className="text-sm text-muted-foreground">
              Lance ou ajuste comissões manuais por vendedor. Total do mês: {formatMoney(totalMes)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SeletorMes
              month={month}
              year={year}
              onChange={(m, y) => {
                setMonth(m);
                setYear(y);
              }}
            />
            <ComissaoFormDialog
              open={openNovo}
              setOpen={setOpenNovo}
              vendedores={vendedores}
              onSubmit={salvar}
            >
              <Button size="sm">Lançar comissão</Button>
            </ComissaoFormDialog>
          </div>
        </CardHeader>
        <CardContent>
          {/* Mobile/tablet estreito (< md): cards empilhados, sem tabela pra arrastar. */}
          <div className="md:hidden divide-y divide-neutral-100">
            {loading ? (
              <p className="py-6 text-center text-sm">Carregando…</p>
            ) : linhas.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nenhuma comissão lançada neste mês.
              </p>
            ) : (
              linhas.map((l) => (
                <div key={l.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium">{l.internal_users?.full_name ?? "—"}</p>
                    <Badge variant="outline" className="shrink-0">
                      {STATUS_COMISSAO.find((s) => s.v === l.status)?.l ?? l.status}
                    </Badge>
                  </div>
                  <div className="mt-1.5 text-xs text-neutral-500">
                    Comissão {formatMoney(l.commission_amount)} · Bônus{" "}
                    {formatMoney(l.bonus_amount)} · Reserva {formatMoney(l.reserve_amount)} ·
                    Liberado {formatMoney(l.released_amount)}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={() => setEditando(l)}
                  >
                    Editar
                  </Button>
                </div>
              ))
            )}
          </div>

          {/* Tablet/desktop (md:+): tabela completa. */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendedor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Comissão</TableHead>
                  <TableHead>Bônus</TableHead>
                  <TableHead>Reserva</TableHead>
                  <TableHead>Liberado</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-6 text-center text-sm">
                      Carregando…
                    </TableCell>
                  </TableRow>
                ) : linhas.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-6 text-center text-sm text-muted-foreground"
                    >
                      Nenhuma comissão lançada neste mês.
                    </TableCell>
                  </TableRow>
                ) : (
                  linhas.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-medium">
                        {l.internal_users?.full_name ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {STATUS_COMISSAO.find((s) => s.v === l.status)?.l ?? l.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatMoney(l.commission_amount)}</TableCell>
                      <TableCell>{formatMoney(l.bonus_amount)}</TableCell>
                      <TableCell>{formatMoney(l.reserve_amount)}</TableCell>
                      <TableCell>{formatMoney(l.released_amount)}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => setEditando(l)}>
                          Editar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {editando && (
        <ComissaoFormDialog
          open={!!editando}
          setOpen={(v: boolean) => !v && setEditando(null)}
          vendedores={vendedores}
          initial={editando}
          onSubmit={salvar}
        />
      )}
      <Dialog open={!!detalheSellerId} onOpenChange={(open) => !open && setDetalheSellerId(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Histórico detalhado ·{" "}
              {vendedores.find((item) => item.id === detalheSellerId)?.full_name}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {linhas
              .filter((linha) => linha.seller_id === detalheSellerId)
              .map((linha) => (
                <div
                  key={linha.id}
                  className="grid gap-2 rounded-xl border p-3 text-sm sm:grid-cols-[1fr_auto_auto]"
                >
                  <div>
                    <p className="font-bold">
                      {STATUS_COMISSAO.find((item) => item.v === linha.status)?.l || linha.status}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {formatDateTime(linha.created_at)} · contrato{" "}
                      {linha.contract_id || "lançamento manual"}
                    </p>
                  </div>
                  <span>
                    Comissão + bônus
                    <br />
                    <b>
                      {formatMoney(
                        Number(linha.commission_amount || 0) + Number(linha.bonus_amount || 0),
                      )}
                    </b>
                  </span>
                  <span>
                    Liberado
                    <br />
                    <b>{formatMoney(linha.released_amount)}</b>
                  </span>
                </div>
              ))}
            {linhas.filter((linha) => linha.seller_id === detalheSellerId).length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nenhum lançamento neste mês.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ComissaoFormDialog({ open, setOpen, vendedores, initial, onSubmit, children }: any) {
  const [form, setForm] = useState<any>(
    () =>
      initial ?? {
        seller_id: "",
        commission_amount: "",
        bonus_amount: "",
        reserve_amount: "",
        released_amount: "",
        status: "pendente",
      },
  );

  useEffect(() => {
    if (initial) {
      setForm({
        ...initial,
        commission_amount: String(initial.commission_amount ?? 0),
        bonus_amount: String(initial.bonus_amount ?? 0),
        reserve_amount: String(initial.reserve_amount ?? 0),
        released_amount: String(initial.released_amount ?? 0),
      });
    } else if (open) {
      setForm({
        seller_id: "",
        commission_amount: "",
        bonus_amount: "",
        reserve_amount: "",
        released_amount: "",
        status: "pendente",
      });
    }
  }, [initial, open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar comissão" : "Lançar comissão manual"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Vendedor</Label>
            <Select
              value={form.seller_id}
              onValueChange={(v) => setForm({ ...form, seller_id: v })}
              disabled={!!initial}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {vendedores.map((v: any) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Comissão (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.commission_amount}
                onChange={(e) => setForm({ ...form, commission_amount: e.target.value })}
              />
            </div>
            <div>
              <Label>Bônus (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.bonus_amount}
                onChange={(e) => setForm({ ...form, bonus_amount: e.target.value })}
              />
            </div>
            <div>
              <Label>Reserva (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.reserve_amount}
                onChange={(e) => setForm({ ...form, reserve_amount: e.target.value })}
              />
            </div>
            <div>
              <Label>Liberado (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.released_amount}
                onChange={(e) => setForm({ ...form, released_amount: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_COMISSAO.map((s) => (
                  <SelectItem key={s.v} value={s.v}>
                    {s.l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={() => onSubmit(form)}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
