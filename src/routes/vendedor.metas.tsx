import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarCheck2,
  Flame,
  PhoneCall,
  RefreshCw,
  Sparkles,
  Target,
  Trophy,
  UserRoundPlus,
  UsersRound,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { fetchMySellerControlDashboard, type SellerControlDashboard } from "@/lib/seller-control";
import { fetchMySellerMonthlyProgress, type SellerMonthlyProgress } from "@/lib/seller-progress";
import { fetchMyRoleGoalProgress, type TeamGoalProgress } from "@/lib/admin-team-goals";

export const Route = createFileRoute("/vendedor/metas")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin"]} moduleKey="metas">
      <Goals />
    </ProtectedRoute>
  ),
});

function Goals() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const [daily, setDaily] = useState<SellerControlDashboard | null>(null);
  const [monthly, setMonthly] = useState<SellerControlDashboard | null>(null);
  const [roleProgress, setRoleProgress] = useState<TeamGoalProgress | null>(null);
  const [legacyMonthly, setLegacyMonthly] = useState<SellerMonthlyProgress | null>(null);
  const [ranking, setRanking] = useState<
    Array<{ id: string; name: string; registrations: number; position: number }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [day, monthData, sharedProgress, monthlyProgress, rankingResponse] = await Promise.all([
        fetchMySellerControlDashboard("daily"),
        fetchMySellerControlDashboard("monthly"),
        fetchMyRoleGoalProgress(),
        fetchMySellerMonthlyProgress(month, year),
        (supabase as any).rpc("ranking_vendedores", {
          p_month: month,
          p_year: year,
        }),
      ]);
      if (rankingResponse.error) throw rankingResponse.error;
      setDaily(day);
      setMonthly(monthData);
      setRoleProgress(sharedProgress);
      setLegacyMonthly(monthlyProgress);
      setRanking(
        ((rankingResponse.data as Record<string, unknown>[] | null) ?? [])
          .map((row) => ({
            id: String(row.vendedor_id),
            name: String(row.nome || "Vendedor"),
            registrations: Number(row.total_leads ?? 0),
            position: Number(row.posicao ?? 0),
          }))
          .sort((a, b) => a.position - b.position),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar suas metas.");
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    const channel = supabase
      .channel("seller-goals-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_contact_leads" },
        refresh,
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "seller_team_goals" }, refresh)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_commercial_events" },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_signup_attributions" },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_client_partnerships" },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_appointments" },
        refresh,
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const leadsPercent = useMemo(
    () =>
      daily?.target_leads_contacted_daily
        ? Math.min(
            100,
            Math.round((daily.leads_contacted / daily.target_leads_contacted_daily) * 100),
          )
        : 0,
    [daily],
  );
  const closer = roleProgress?.seller_type === "closer";
  const dailyMeetings = roleProgress
    ? closer
      ? roleProgress.meetings_completed_daily
      : roleProgress.meetings_scheduled_daily
    : 0;
  const dailyMeetingsTarget = roleProgress
    ? closer
      ? roleProgress.target_meetings_completed_daily
      : roleProgress.target_meetings_scheduled_daily
    : null;
  const dailyRegistrations = roleProgress?.clients_registered_daily ?? 0;
  const dailyRegistrationsTarget = roleProgress?.target_clients_daily ?? null;
  const dailyTrackedGoals = [
    [daily?.leads_contacted ?? 0, daily?.target_leads_contacted_daily ?? null],
    [dailyMeetings, dailyMeetingsTarget],
    [dailyRegistrations, dailyRegistrationsTarget],
  ].filter(([, target]) => target != null);
  const completedDailyGoals = dailyTrackedGoals.filter(
    ([current, target]) => Number(current) >= Number(target),
  ).length;
  const dayLabel = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  }).format(now);

  return (
    <DashboardLayout>
      <main className="mx-auto w-full max-w-[1400px] space-y-5 pb-10 text-neutral-950">
        <section className="relative overflow-hidden rounded-[30px] bg-neutral-950 p-6 text-white shadow-[0_20px_60px_rgba(0,0,0,.14)] sm:p-8">
          <div className="absolute -right-20 -top-32 h-80 w-80 rounded-full bg-yellow-400/25 blur-3xl" />
          <div className="absolute bottom-0 right-[28%] h-px w-72 bg-gradient-to-r from-transparent via-yellow-300/70 to-transparent" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-yellow-400 px-3 py-1 text-[10px] font-black uppercase tracking-[.18em] text-black">
                <Sparkles className="h-3.5 w-3.5" /> Plano de hoje
              </span>
              <h1 className="mt-4 max-w-3xl text-3xl font-black tracking-[-.035em] sm:text-5xl">
                Suas metas diárias,
                <span className="text-yellow-300"> sem distração.</span>
              </h1>
              <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-neutral-300">
                Comece pelo que precisa acontecer hoje. Semana e mês continuam logo abaixo como
                visão de apoio.
              </p>
            </div>
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
                <p className="text-[9px] font-black uppercase tracking-[.16em] text-yellow-300">
                  Hoje
                </p>
                <p className="mt-1 capitalize text-sm font-bold text-white">{dayLabel}</p>
              </div>
              <Button
                variant="outline"
                className="gap-2 border-white/20 bg-white/10 font-bold text-white hover:bg-white/20 hover:text-white"
                onClick={() => void load()}
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Atualizar
              </Button>
            </div>
          </div>
        </section>

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-800">
            {error}
          </div>
        ) : loading && !daily ? (
          <div className="h-80 animate-pulse rounded-3xl bg-neutral-100" />
        ) : daily && monthly ? (
          <>
            <section className="overflow-hidden rounded-[30px] border border-yellow-300 bg-[linear-gradient(135deg,#fffdf2_0%,#ffffff_46%,#fff5b8_100%)] p-4 shadow-sm sm:p-6">
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-neutral-950 px-3 py-1 text-[9px] font-black uppercase tracking-[.18em] text-yellow-300">
                      Foco principal
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[.14em] text-emerald-700">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                      Atualização em tempo real
                    </span>
                  </div>
                  <h2 className="mt-3 text-2xl font-black tracking-tight sm:text-3xl">
                    Metas de hoje
                  </h2>
                  <p className="mt-1 text-sm font-medium text-neutral-500">
                    O que merece sua atenção agora, reunido em um só lugar.
                  </p>
                </div>
                <div className="rounded-2xl border border-yellow-300 bg-white px-4 py-3 shadow-sm">
                  <p className="text-[9px] font-black uppercase tracking-[.14em] text-neutral-400">
                    Acompanhadas concluídas
                  </p>
                  <p className="mt-1 text-2xl font-black">
                    {completedDailyGoals}
                    <span className="text-sm text-neutral-400">/{dailyTrackedGoals.length}</span>
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <DailyGoalCard
                  icon={PhoneCall}
                  eyebrow="Ritmo visual"
                  title="Ligações"
                  current={daily.target_calls_daily}
                  target={null}
                  percentage={null}
                  helper={
                    daily.target_calls_daily == null
                      ? "A administração ainda não definiu esta meta."
                      : "Referência diária; as ligações não são contadas pelo sistema."
                  }
                  tone="dark"
                />
                <DailyGoalCard
                  icon={UsersRound}
                  eyebrow="Resultado acompanhado"
                  title="Leads em contato"
                  current={daily.leads_contacted}
                  target={daily.target_leads_contacted_daily}
                  percentage={leadsPercent}
                  helper={dailyGoalHelper(
                    daily.leads_contacted,
                    daily.target_leads_contacted_daily,
                    "lead",
                    "leads",
                  )}
                  tone="violet"
                />
                <DailyGoalCard
                  icon={CalendarCheck2}
                  eyebrow={closer ? "Reuniões confirmadas" : "Reuniões agendadas"}
                  title="Reuniões"
                  current={dailyMeetings}
                  target={dailyMeetingsTarget}
                  percentage={goalPercentage(dailyMeetings, dailyMeetingsTarget)}
                  helper={dailyGoalHelper(
                    dailyMeetings,
                    dailyMeetingsTarget,
                    "reunião",
                    "reuniões",
                  )}
                  tone="blue"
                />
                <DailyGoalCard
                  icon={UserRoundPlus}
                  eyebrow="Conversão do dia"
                  title="Cadastros"
                  current={dailyRegistrations}
                  target={dailyRegistrationsTarget}
                  percentage={goalPercentage(dailyRegistrations, dailyRegistrationsTarget)}
                  helper={dailyGoalHelper(
                    dailyRegistrations,
                    dailyRegistrationsTarget,
                    "cadastro",
                    "cadastros",
                  )}
                  tone="green"
                />
              </div>
            </section>

            <section className="grid gap-3 sm:grid-cols-3">
              <MiniStat
                icon={Flame}
                label="Leads no mês"
                value={monthly.leads_contacted}
                color="text-orange-600 bg-orange-100"
              />
              <MiniStat
                icon={ArrowRight}
                label="Links enviados"
                value={monthly.links_generated}
                color="text-sky-700 bg-sky-100"
              />
              <MiniStat
                icon={Trophy}
                label="Cadastros no mês"
                value={monthly.registrations}
                color="text-emerald-700 bg-emerald-100"
              />
            </section>

            {roleProgress ? (
              <section className="rounded-[26px] border border-neutral-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[.16em] text-yellow-700">
                      Visão de apoio
                    </p>
                    <h2 className="mt-1 text-xl font-black">Semana e mês</h2>
                    <p className="mt-1 text-xs font-medium text-neutral-500">
                      As metas diárias continuam em destaque acima.
                    </p>
                  </div>
                  <span className="w-fit rounded-full bg-neutral-950 px-3 py-1 text-[10px] font-black uppercase text-white">
                    {closer ? "Closer" : "Vendedor"}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <SharedGoalGroup
                    title={closer ? "Reuniões confirmadas" : "Reuniões agendadas"}
                    values={
                      closer
                        ? [
                            roleProgress.meetings_completed_weekly,
                            roleProgress.meetings_completed_monthly,
                          ]
                        : [
                            roleProgress.meetings_scheduled_weekly,
                            roleProgress.meetings_scheduled_monthly,
                          ]
                    }
                    targets={
                      closer
                        ? [
                            roleProgress.target_meetings_completed_weekly,
                            roleProgress.target_meetings_completed_monthly,
                          ]
                        : [
                            roleProgress.target_meetings_scheduled_weekly,
                            roleProgress.target_meetings_scheduled_monthly,
                          ]
                    }
                  />
                  <SharedGoalGroup
                    title="Cadastros realizados"
                    values={[
                      roleProgress.clients_registered_weekly,
                      roleProgress.clients_registered_monthly,
                    ]}
                    targets={[
                      roleProgress.target_clients_weekly,
                      roleProgress.target_clients_monthly,
                    ]}
                  />
                </div>
              </section>
            ) : null}

            <section className="grid gap-4 lg:grid-cols-[.8fr_1.2fr]">
              <article className="rounded-[24px] border border-yellow-300 bg-yellow-50 p-5 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-[.16em] text-yellow-800">
                  Meta individual do mês
                </p>
                <div className="mt-3 flex items-end justify-between gap-3">
                  <strong className="text-4xl font-black">
                    {legacyMonthly?.clients_registered ?? 0}
                    <span className="ml-1 text-base text-yellow-700/60">
                      / {legacyMonthly?.target_clients ?? "—"}
                    </span>
                  </strong>
                  <Trophy className="h-8 w-8 text-yellow-600" />
                </div>
                <Progress
                  value={
                    legacyMonthly?.target_clients
                      ? Math.min(
                          100,
                          Math.round(
                            (legacyMonthly.clients_registered / legacyMonthly.target_clients) * 100,
                          ),
                        )
                      : 0
                  }
                  className="mt-4 h-2 bg-white"
                />
              </article>
              <article className="rounded-[24px] border border-neutral-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[.16em] text-neutral-400">
                      Ranking preservado
                    </p>
                    <h2 className="mt-1 text-lg font-black">Cadastros do mês</h2>
                  </div>
                  <Trophy className="h-6 w-6 text-yellow-600" />
                </div>
                {ranking.length === 0 ? (
                  <p className="mt-5 text-sm text-neutral-500">Ainda não há posições neste mês.</p>
                ) : (
                  <ol className="mt-4 grid gap-2 sm:grid-cols-2">
                    {ranking.slice(0, 6).map((row) => (
                      <li
                        key={row.id}
                        className={`flex items-center gap-3 rounded-xl p-3 ${
                          row.id === legacyMonthly?.seller_id
                            ? "bg-yellow-50 ring-1 ring-yellow-300"
                            : "bg-neutral-50"
                        }`}
                      >
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-neutral-950 text-xs font-black text-white">
                          {row.position}º
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-black">{row.name}</p>
                          <p className="text-[11px] font-semibold text-neutral-500">
                            {row.registrations} cadastro(s)
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </article>
            </section>

            <section className="rounded-[24px] border border-neutral-200 bg-white p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-yellow-100 text-yellow-700">
                  <Target className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="font-black">Como um lead entra na meta?</h2>
                  <p className="mt-1 text-sm leading-6 text-neutral-500">
                    Cadastre nome e telefone na aba Leads do dia. O lead passa a contar
                    imediatamente e os lembretes de acompanhamento são criados automaticamente na
                    agenda.
                  </p>
                </div>
              </div>
            </section>
          </>
        ) : null}
      </main>
    </DashboardLayout>
  );
}

type DailyGoalTone = "dark" | "violet" | "blue" | "green";

function DailyGoalCard({
  icon: Icon,
  eyebrow,
  title,
  current,
  target,
  percentage,
  helper,
  tone,
}: {
  icon: typeof PhoneCall;
  eyebrow: string;
  title: string;
  current: number | null;
  target: number | null;
  percentage: number | null;
  helper: string;
  tone: DailyGoalTone;
}) {
  const tones: Record<
    DailyGoalTone,
    {
      card: string;
      eyebrow: string;
      icon: string;
      muted: string;
      track: string;
      fill: string;
    }
  > = {
    dark: {
      card: "border-neutral-950 bg-neutral-950 text-white",
      eyebrow: "text-yellow-300",
      icon: "bg-yellow-400 text-black",
      muted: "text-neutral-300",
      track: "bg-white/10",
      fill: "bg-yellow-400",
    },
    violet: {
      card: "border-violet-200 bg-violet-50 text-neutral-950",
      eyebrow: "text-violet-700",
      icon: "bg-violet-600 text-white",
      muted: "text-violet-700/70",
      track: "bg-white",
      fill: "bg-violet-600",
    },
    blue: {
      card: "border-sky-200 bg-sky-50 text-neutral-950",
      eyebrow: "text-sky-700",
      icon: "bg-sky-600 text-white",
      muted: "text-sky-700/70",
      track: "bg-white",
      fill: "bg-sky-600",
    },
    green: {
      card: "border-emerald-200 bg-emerald-50 text-neutral-950",
      eyebrow: "text-emerald-700",
      icon: "bg-emerald-600 text-white",
      muted: "text-emerald-700/70",
      track: "bg-white",
      fill: "bg-emerald-600",
    },
  };
  const styles = tones[tone];

  return (
    <article
      className={`flex min-h-[230px] flex-col rounded-[24px] border p-5 shadow-sm transition-transform duration-200 hover:-translate-y-1 ${styles.card}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={`text-[9px] font-black uppercase tracking-[.17em] ${styles.eyebrow}`}>
            {eyebrow}
          </p>
          <h3 className="mt-2 text-xl font-black">{title}</h3>
        </div>
        <span className={`grid h-11 w-11 place-items-center rounded-2xl ${styles.icon}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <div className="mt-auto pt-8">
        <div className="flex items-end justify-between gap-3">
          <strong className="text-5xl font-black tracking-[-.06em]">
            {current ?? "—"}
            {target != null ? (
              <span className={`ml-1.5 text-base ${styles.muted}`}>/ {target}</span>
            ) : null}
          </strong>
          {percentage != null ? (
            <span className={`text-sm font-black ${styles.eyebrow}`}>{percentage}%</span>
          ) : null}
        </div>
        {percentage != null ? (
          <div className={`mt-4 h-2 overflow-hidden rounded-full ${styles.track}`}>
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${styles.fill}`}
              style={{ width: `${percentage}%` }}
            />
          </div>
        ) : null}
        <p className={`mt-3 text-xs font-semibold leading-5 ${styles.muted}`}>{helper}</p>
      </div>
    </article>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Flame;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <article className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <span className={`grid h-11 w-11 place-items-center rounded-xl ${color}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <strong className="text-2xl font-black">{value}</strong>
        <p className="text-xs font-bold text-neutral-500">{label}</p>
      </div>
    </article>
  );
}

function SharedGoalGroup({
  title,
  values,
  targets,
}: {
  title: string;
  values: number[];
  targets: Array<number | null>;
}) {
  return (
    <div className="rounded-2xl bg-neutral-50 p-4">
      <h3 className="text-sm font-black">{title}</h3>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {["Semana", "Mês"].map((label, index) => {
          const pct = goalPercentage(values[index], targets[index]);
          return (
            <div key={label} className="rounded-xl border border-neutral-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[9px] font-black uppercase text-neutral-400">{label}</p>
                <span className="text-[10px] font-black text-yellow-700">{pct}%</span>
              </div>
              <p className="mt-2 text-xl font-black">
                {values[index]}
                <span className="text-[10px] text-neutral-400"> / {targets[index] ?? "—"}</span>
              </p>
              <Progress value={pct} className="mt-2 h-1.5 bg-neutral-100" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function goalPercentage(current: number, target: number | null) {
  return target && target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
}

function dailyGoalHelper(current: number, target: number | null, singular: string, plural: string) {
  if (target == null) return "A administração ainda não definiu esta meta.";
  const remaining = Math.max(0, target - current);
  if (remaining === 0) return "Meta do dia concluída. Excelente!";
  return `Faltam ${remaining} ${remaining === 1 ? singular : plural} hoje.`;
}
