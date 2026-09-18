import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Award,
  CalendarDays,
  CheckCircle2,
  RefreshCw,
  Target,
  Trophy,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { defaultAvatarForName } from "@/lib/gender-avatar";
import { sellerGoalPercentage } from "@/lib/seller-goals-dashboard";
import { fetchMySellerMonthlyProgress, type SellerMonthlyProgress } from "@/lib/seller-progress";
import { fetchMyRoleGoalProgress, type TeamGoalProgress } from "@/lib/admin-team-goals";

export const Route = createFileRoute("/vendedor/metas")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin"]} moduleKey="metas">
      <Goals />
    </ProtectedRoute>
  ),
});

type RankingRow = {
  id: string;
  name: string;
  avatarUrl: string | null;
  registrations: number;
  position: number;
};
const MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function Goals() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const [progress, setProgress] = useState<SellerMonthlyProgress | null>(null);
  const [roleProgress, setRoleProgress] = useState<TeamGoalProgress | null>(null);
  const [ranking, setRanking] = useState<RankingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [progressData, roleData, response] = await Promise.all([
        fetchMySellerMonthlyProgress(month, year),
        fetchMyRoleGoalProgress(),
        (supabase as any).rpc("ranking_vendedores", { p_month: month, p_year: year }),
      ]);
      if (response.error) throw response.error;
      setProgress(progressData);
      setRoleProgress(roleData);
      setRanking(
        ((response.data as Record<string, unknown>[] | null) ?? [])
          .map((row) => ({
            id: String(row.vendedor_id),
            name: String(row.nome || "Vendedor"),
            avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
            registrations: Number(row.total_leads ?? 0),
            position: Number(row.posicao ?? 0),
          }))
          .sort((a, b) => a.position - b.position),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar sua meta.");
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("seller-registration-goal")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_team_goals" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_goals" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_client_partnerships" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_signup_attributions" },
        () => void load(),
      )
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [load]);

  const percentage = progress
    ? sellerGoalPercentage(progress.clients_registered, progress.target_clients)
    : 0;
  const remaining =
    progress?.target_clients == null
      ? null
      : Math.max(0, progress.target_clients - progress.clients_registered);
  const position = ranking.find((row) => row.id === progress?.seller_id)?.position;
  const teamTotal = useMemo(
    () => ranking.reduce((sum, row) => sum + row.registrations, 0),
    [ranking],
  );

  return (
    <DashboardLayout lockDesktopViewport>
      <main className="flex min-h-0 flex-col gap-2 text-neutral-950 xl:h-full xl:overflow-hidden">
        <section className="relative shrink-0 overflow-hidden rounded-[18px] border border-yellow-300 bg-[radial-gradient(circle_at_92%_20%,rgba(250,204,21,0.25),transparent_24%),linear-gradient(115deg,#fff_0%,#fffef8_60%,#fff4b3_100%)] px-4 py-2.5 shadow-sm sm:px-5">
          <div className="relative flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-yellow-400 bg-white/80 px-2.5 py-0.5 text-[8px] font-black uppercase tracking-[0.18em] text-yellow-700">
                <CalendarDays className="h-3 w-3" />
                {MONTHS[month - 1]} de {year}
              </span>
              <h1 className="mt-1 text-xl font-black sm:text-2xl">
                Minha meta de <span className="text-yellow-500">cadastros</span>
              </h1>
              <p className="mt-0.5 text-[11px] font-medium text-neutral-600 sm:text-xs">
                Sua prioridade comercial é cadastrar novas imobiliárias e corretores parceiros.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {position && (
                <Badge className="border border-yellow-300 bg-white px-3 py-2 text-neutral-950">
                  {position}º no ranking
                </Badge>
              )}
              <Button
                variant="outline"
                size="icon"
                className="rounded-xl border-yellow-300"
                onClick={load}
                disabled={loading}
                aria-label="Atualizar meta"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </section>

        {error ? (
          <State title="Não foi possível carregar sua meta" description={error} error />
        ) : loading ? (
          <div className="h-64 animate-pulse rounded-[22px] bg-neutral-100" />
        ) : progress ? (
          <div
            className={`grid min-h-0 flex-1 gap-2 lg:grid-cols-[1.2fr_0.8fr] xl:overflow-hidden ${
              roleProgress ? "xl:grid-rows-[minmax(0,1.08fr)_minmax(0,0.92fr)]" : "xl:grid-rows-1"
            }`}
          >
            {roleProgress && (
              <Card className="flex min-h-0 flex-col overflow-hidden border-yellow-300 shadow-sm lg:col-span-2">
                <CardHeader className="shrink-0 px-4 py-2.5">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <CalendarDays className="h-4 w-4 text-yellow-600" />{" "}
                    {roleProgress.seller_type === "sdr"
                      ? "Reuniões marcadas"
                      : "Reuniões confirmadas"}{" "}
                    e cadastros · metas da equipe
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid min-h-0 flex-1 grid-rows-2 gap-2 px-4 pb-3 pt-0">
                  {(["meetings", "registrations"] as const).map((metric) => (
                    <div key={metric} className="flex min-h-0 flex-col">
                      <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-neutral-500">
                        {metric === "registrations"
                          ? "Cadastros realizados"
                          : roleProgress.seller_type === "sdr"
                            ? "Reuniões agendadas"
                            : "Reuniões confirmadas"}
                      </p>
                      <div className="grid min-h-0 flex-1 gap-2 sm:grid-cols-3">
                        {(["daily", "weekly", "monthly"] as const).map((period) => {
                          const scheduled = roleProgress.seller_type === "sdr";
                          const current =
                            metric === "registrations"
                              ? roleProgress[`clients_registered_${period}`]
                              : scheduled
                                ? roleProgress[`meetings_scheduled_${period}`]
                                : roleProgress[`meetings_completed_${period}`];
                          const target =
                            metric === "registrations"
                              ? roleProgress[`target_clients_${period}`]
                              : scheduled
                                ? roleProgress[`target_meetings_scheduled_${period}`]
                                : roleProgress[`target_meetings_completed_${period}`];
                          const labels = {
                            daily: "Hoje",
                            weekly: "Esta semana",
                            monthly: "Este mês",
                          };
                          const pct = target
                            ? Math.min(100, Math.round((current / target) * 100))
                            : 0;
                          return (
                            <div
                              key={period}
                              className="flex min-h-0 flex-col justify-center rounded-xl bg-neutral-50 px-3 py-2"
                            >
                              <p className="text-[10px] font-black uppercase text-neutral-400">
                                {labels[period]}
                              </p>
                              <p className="mt-0.5 text-2xl font-black leading-none">
                                {current}
                                <span className="text-xs text-neutral-400"> / {target ?? "—"}</span>
                              </p>
                              <ProgressBar value={pct} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
            <Card className="flex min-h-0 flex-col overflow-hidden border-yellow-300 shadow-sm">
              <CardHeader className="shrink-0 border-b border-yellow-100 bg-yellow-50 px-4 py-2.5">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Target className="h-4 w-4 text-yellow-600" /> Cadastros realizados no mês
                </CardTitle>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col justify-center p-3 sm:p-4">
                {progress.target_clients == null ? (
                  <State
                    title="Meta ainda não definida"
                    description="O administrador precisa definir a meta de cadastros da sua equipe neste mês."
                  />
                ) : (
                  <>
                    <div className="flex items-end justify-between gap-4">
                      <div>
                        <strong className="text-4xl font-black leading-none text-neutral-950">
                          {progress.clients_registered}
                        </strong>
                        <span className="ml-2 text-lg font-bold text-neutral-400">
                          / {progress.target_clients}
                        </span>
                        <p className="mt-0.5 text-xs font-semibold text-neutral-500">
                          novos parceiros cadastrados
                        </p>
                      </div>
                      <strong className="text-2xl font-black text-yellow-600">{percentage}%</strong>
                    </div>
                    <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-neutral-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-yellow-500 to-yellow-300 transition-all"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                    <div className="mt-3 flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">
                      {remaining === 0 ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                      ) : (
                        <Target className="h-5 w-5 text-yellow-600" />
                      )}
                      <div>
                        <p className="text-sm font-black leading-tight">
                          {remaining === 0
                            ? "Meta concluída!"
                            : `Faltam ${remaining} cadastro${remaining === 1 ? "" : "s"}`}
                        </p>
                        <p className="text-[10px] leading-tight text-neutral-500">
                          Cada novo cadastro válido entra automaticamente nesta contagem.
                        </p>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="flex min-h-0 flex-col overflow-hidden border-neutral-200 shadow-sm">
              <CardHeader className="shrink-0 border-b border-neutral-100 px-4 py-2.5">
                <CardTitle className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <Award className="h-4 w-4 text-yellow-600" /> Sua equipe
                  </span>
                  <Badge variant="outline">{teamTotal} cadastros</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 overflow-hidden p-0">
                {ranking.length === 0 ? (
                  <div className="p-4">
                    <State
                      title="Sem resultados ainda"
                      description="O ranking aparecerá após o primeiro cadastro."
                    />
                  </div>
                ) : (
                  <ol
                    className={`grid h-full min-h-0 auto-rows-fr gap-px bg-neutral-100 ${
                      ranking.length > 8
                        ? "sm:grid-cols-2 xl:grid-cols-3"
                        : ranking.length > 4
                          ? "sm:grid-cols-2"
                          : "grid-cols-1"
                    }`}
                  >
                    {ranking.map((row) => (
                      <TeamRow key={row.id} row={row} current={row.id === progress.seller_id} />
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </div>
        ) : null}
      </main>
    </DashboardLayout>
  );
}

function TeamRow({ row, current }: { row: RankingRow; current: boolean }) {
  return (
    <li
      className={`grid min-h-0 grid-cols-[22px_auto_minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 ${current ? "bg-yellow-50" : "bg-white"}`}
    >
      <span className="text-right text-sm font-black text-neutral-400">{row.position}.</span>
      <Avatar className="h-7 w-7">
        <AvatarImage src={row.avatarUrl || defaultAvatarForName(row.name)} />
        <AvatarFallback>{row.name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-black leading-tight">
          {row.name}
          {current && <span className="ml-2 text-[8px] uppercase text-yellow-600">Você</span>}
        </p>
        <p className="text-[8px] leading-tight text-neutral-400">cadastros realizados</p>
      </div>
      <strong className="text-base font-black text-yellow-600">{row.registrations}</strong>
    </li>
  );
}

function State({
  title,
  description,
  error = false,
}: {
  title: string;
  description: string;
  error?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-6 text-center ${error ? "border-red-200 bg-red-50" : "border-dashed border-neutral-300 bg-neutral-50"}`}
    >
      {error ? (
        <AlertCircle className="mx-auto mb-2 h-5 w-5 text-red-500" />
      ) : (
        <Trophy className="mx-auto mb-2 h-5 w-5 text-yellow-500" />
      )}
      <p className="font-black">{title}</p>
      <p className="mt-1 text-xs text-neutral-500">{description}</p>
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-200">
      <div className="h-full rounded-full bg-yellow-400" style={{ width: `${value}%` }} />
    </div>
  );
}
