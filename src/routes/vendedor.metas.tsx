import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Award,
  CalendarDays,
  ChartNoAxesCombined,
  CheckCircle2,
  RefreshCw,
  Target,
  Trophy,
  Users,
  Video,
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { defaultAvatarForName } from "@/lib/gender-avatar";
import { sellerGoalPercentage, sellerOverallProgress } from "@/lib/seller-goals-dashboard";
import { fetchMySellerMonthlyProgress, type SellerMonthlyProgress } from "@/lib/seller-progress";

export const Route = createFileRoute("/vendedor/metas")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin"]} moduleKey="metas">
      <Metas />
    </ProtectedRoute>
  ),
});

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

type RankingRow = {
  id: string;
  name: string;
  avatarUrl: string | null;
  contracts: number;
  leads: number;
  position: number;
};

function Metas() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const [progress, setProgress] = useState<SellerMonthlyProgress | null>(null);
  const [ranking, setRanking] = useState<RankingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro("");
    try {
      const [progressData, rankingResponse] = await Promise.all([
        fetchMySellerMonthlyProgress(month, year),
        (supabase as any).rpc("ranking_vendedores", { p_month: month, p_year: year }),
      ]);
      if (rankingResponse.error) throw rankingResponse.error;
      setProgress(progressData);
      setRanking(
        ((rankingResponse.data as Record<string, unknown>[] | null) ?? [])
          .map((row) => ({
            id: String(row.vendedor_id),
            name: String(row.nome || "Vendedor"),
            avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
            contracts: Number(row.contratos_fechados ?? 0),
            leads: Number(row.total_leads ?? 0),
            position: Number(row.posicao ?? 0),
          }))
          .sort((a, b) => a.position - b.position),
      );
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível carregar suas metas.");
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => {
    void carregar();
    const refresh = () => void carregar();
    const channel = supabase
      .channel("seller-monthly-goals")
      .on("postgres_changes", { event: "*", schema: "public", table: "seller_goals" }, refresh)
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
        { event: "*", schema: "public", table: "seller_commissions" },
        refresh,
      )
      .subscribe();
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      void supabase.removeChannel(channel);
    };
  }, [carregar]);

  const contracts = progress?.contracts_closed ?? 0;
  const overallProgress = progress ? sellerOverallProgress(progress) : 0;
  const hasGoals =
    progress?.target_meetings != null &&
    progress?.target_clients != null &&
    progress?.target_contracts != null;
  const currentPosition = ranking.find((seller) => seller.id === progress?.seller_id)?.position;
  const completedGoals = progress
    ? [
        [progress.meetings_completed, progress.target_meetings],
        [progress.clients_registered, progress.target_clients],
        [progress.contracts_closed, progress.target_contracts],
      ]
        .filter(([, target]) => target != null)
        .filter(([current, target]) => Number(current) >= Number(target)).length
    : 0;

  useEffect(() => {
    const previousHtmlOverflow = document.documentElement.style.overflowY;
    const previousBodyOverflow = document.body.style.overflowY;
    document.documentElement.style.overflowY = "hidden";
    document.body.style.overflowY = "hidden";
    return () => {
      document.documentElement.style.overflowY = previousHtmlOverflow;
      document.body.style.overflowY = previousBodyOverflow;
    };
  }, []);

  return (
    <DashboardLayout lockDesktopViewport>
      <main className="flex h-full min-h-0 flex-col gap-3 overflow-hidden text-neutral-950">
        <section className="relative shrink-0 overflow-hidden rounded-[22px] border border-yellow-300 bg-[radial-gradient(circle_at_92%_20%,rgba(250,204,21,0.25),transparent_24%),linear-gradient(115deg,#ffffff_0%,#fffef8_60%,#fff4b3_100%)] px-5 py-4 shadow-sm sm:px-6">
          <div className="pointer-events-none absolute -right-10 -top-24 h-48 w-48 rounded-full border-[24px] border-yellow-400/15" />
          <div className="relative flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="inline-flex items-center gap-2 rounded-full border border-yellow-400 bg-white/80 px-3 py-1 text-[9px] font-black uppercase tracking-[0.18em] text-yellow-700 shadow-sm">
                <CalendarDays className="h-3 w-3" /> {MONTHS[month - 1]} de {year}
              </span>
              <h1 className="mt-2 text-2xl font-black tracking-[-0.045em] sm:text-3xl">
                Minhas <span className="text-yellow-400">Metas</span>
              </h1>
              <p className="mt-1 max-w-2xl truncate text-xs font-medium text-neutral-600 sm:text-sm">
                Seu desempenho individual do mês, com metas e resultados exclusivos da sua conta.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {currentPosition && (
                <div className="rounded-xl border border-yellow-300 bg-white/85 px-3 py-2 text-right shadow-sm">
                  <p className="text-[8px] font-black uppercase tracking-[0.14em] text-neutral-400">
                    Ranking
                  </p>
                  <p className="text-base font-black text-neutral-950">{currentPosition}º lugar</p>
                </div>
              )}
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 rounded-xl border-yellow-300 bg-white/90"
                onClick={carregar}
                disabled={loading}
                aria-label="Atualizar metas"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </section>

        {erro && <Estado titulo="Não foi possível carregar suas metas" descricao={erro} erro />}

        {loading ? (
          <MetasSkeleton />
        ) : !erro && progress ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {!hasGoals && (
              <Estado
                titulo="Metas ainda não definidas"
                descricao="O administrador precisa definir as três metas individuais deste mês."
              />
            )}

            <section
              className="grid shrink-0 grid-cols-3 gap-3"
              aria-label="Metas individuais do mês"
            >
              <GoalCard
                icon={Video}
                label="Reuniões realizadas"
                current={progress.meetings_completed}
                target={progress.target_meetings}
              />
              <GoalCard
                icon={Users}
                label="Clientes cadastrados"
                current={progress.clients_registered}
                target={progress.target_clients}
              />
              <GoalCard
                icon={Trophy}
                label="Contratos fechados"
                current={progress.contracts_closed}
                target={progress.target_contracts}
              />
            </section>

            <section className="grid min-h-0 flex-1 items-stretch gap-3 lg:grid-cols-[0.82fr_1.18fr_1fr]">
              <Card className="flex min-h-0 flex-col overflow-hidden border-neutral-200 shadow-sm">
                <CardHeader className="shrink-0 border-b border-neutral-100 px-4 py-3">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Target className="h-4 w-4 text-yellow-500" /> Progresso individual
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center p-4 text-center">
                  <CircularProgress value={overallProgress} />
                  <p className="mt-3 text-sm font-black text-neutral-950">
                    {overallProgress >= 100
                      ? "Objetivo do mês concluído!"
                      : overallProgress >= 60
                        ? "Você está no caminho certo."
                        : "Cada resultado faz a diferença."}
                  </p>
                  <div className="mt-3 grid w-full grid-cols-2 gap-2 rounded-xl bg-neutral-50 p-2">
                    <MiniStat label="Seus contratos" value={contracts} />
                    <MiniStat label="Metas concluídas" value={`${completedGoals}/3`} />
                  </div>
                </CardContent>
              </Card>

              <Card className="flex min-h-0 flex-col overflow-hidden border-neutral-200 shadow-sm">
                <CardHeader className="shrink-0 border-b border-neutral-100 bg-[linear-gradient(120deg,#fffdf2,#ffffff)] px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <ChartNoAxesCombined className="h-4 w-4 text-yellow-600" /> Evolução das metas
                    </CardTitle>
                    <Badge
                      variant="outline"
                      className="border-yellow-300 bg-white text-[8px] font-black uppercase tracking-wider text-yellow-700"
                    >
                      Somente seus dados
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex min-h-0 flex-1 p-2 sm:p-3">
                  <IndividualGoalTrend progress={progress} />
                </CardContent>
              </Card>

              <Card className="flex min-h-0 flex-col overflow-hidden border-yellow-200 shadow-sm">
                <CardHeader className="shrink-0 border-b border-yellow-100 bg-yellow-50/50 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Award className="h-4 w-4 text-yellow-600" /> Destaques da equipe
                    </CardTitle>
                    <Badge
                      variant="outline"
                      className="border-yellow-300 bg-white text-[8px] font-black uppercase tracking-wider text-yellow-700"
                    >
                      Ranking mensal
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="min-h-0 flex-1 overflow-hidden p-0">
                  {ranking.length === 0 ? (
                    <div className="p-3">
                      <EmptyBlock
                        icon={Trophy}
                        text="O ranking aparecerá quando a equipe registrar resultados."
                      />
                    </div>
                  ) : (
                    <div className="h-full min-h-0 overflow-y-auto overscroll-contain">
                      <ol className="divide-y divide-neutral-100">
                        {ranking.map((seller) => (
                          <TeamHighlight
                            key={seller.id}
                            seller={seller}
                            current={seller.id === progress.seller_id}
                          />
                        ))}
                      </ol>
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          </div>
        ) : null}
      </main>
    </DashboardLayout>
  );
}

function GoalCard({
  icon: Icon,
  label,
  current,
  target,
}: {
  icon: typeof Target;
  label: string;
  current: number;
  target: number | null;
}) {
  const percentage = sellerGoalPercentage(current, target);
  const remaining = target == null ? null : Math.max(0, target - current);
  return (
    <Card className="group overflow-hidden border-neutral-200 shadow-sm transition hover:-translate-y-0.5 hover:border-yellow-300 hover:shadow-md">
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-yellow-300 bg-yellow-50 text-yellow-700">
            <Icon className="h-4 w-4" />
          </div>
          <span className="rounded-full bg-neutral-100 px-2 py-1 text-[9px] font-black text-neutral-500">
            {percentage}%
          </span>
        </div>
        <p className="mt-2 truncate text-xs font-black text-neutral-700 sm:text-sm">{label}</p>
        <p className="mt-0.5 text-2xl font-black tracking-tight text-neutral-950">
          {current} <span className="text-sm text-neutral-400">/ {target ?? 0}</span>
        </p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-yellow-500 to-yellow-300 transition-all duration-500"
            style={{ width: `${percentage}%` }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] font-semibold">
          <span className="text-neutral-500">
            {remaining == null
              ? "Aguardando definição"
              : remaining > 0
                ? `Faltam ${remaining}`
                : "Meta concluída"}
          </span>
          {remaining === 0 && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
        </div>
      </CardContent>
    </Card>
  );
}

function IndividualGoalTrend({ progress }: { progress: SellerMonthlyProgress }) {
  const metrics = [
    {
      label: "Reuniões",
      value: progress.meetings_completed,
      target: progress.target_meetings,
    },
    {
      label: "Clientes",
      value: progress.clients_registered,
      target: progress.target_clients,
    },
    {
      label: "Contratos",
      value: progress.contracts_closed,
      target: progress.target_contracts,
    },
  ].map((metric) => ({
    ...metric,
    percentage: sellerGoalPercentage(metric.value, metric.target),
  }));

  return (
    <div
      className="flex h-full min-h-[250px] w-full min-w-0 flex-col"
      aria-label="Gráfico das suas metas individuais"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pb-1 pt-0.5 text-[10px] font-semibold text-neutral-500">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#ffc400]" /> Realizado (qtd)
        </span>
        <span className="flex items-center gap-2">
          <span className="h-0.5 w-5 bg-neutral-950" /> Atingimento (%)
        </span>
      </div>
      <div className="min-h-[210px] min-w-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={metrics} margin={{ top: 30, right: 0, bottom: 2, left: -18 }}>
            <CartesianGrid vertical={false} stroke="#ededed" strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#6b7280", fontSize: 10, fontWeight: 600 }}
              dy={8}
            />
            <YAxis
              yAxisId="quantity"
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#6b7280", fontSize: 9 }}
              domain={[0, (dataMax: number) => Math.max(1, Math.ceil(dataMax * 1.15))]}
            />
            <YAxis
              yAxisId="percentage"
              orientation="right"
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(value) => `${value}%`}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#6b7280", fontSize: 9 }}
            />
            <Tooltip
              cursor={{ fill: "#fff8d6", opacity: 0.65 }}
              contentStyle={{
                borderRadius: 10,
                border: "1px solid #e8e8e8",
                boxShadow: "0 8px 30px rgba(0,0,0,.08)",
                fontSize: 11,
              }}
              formatter={(value, name) => [
                name === "percentage" ? `${Number(value)}%` : Number(value),
                name === "percentage" ? "Atingimento" : "Realizado",
              ]}
              labelFormatter={(_, payload) => {
                const item = payload[0]?.payload as (typeof metrics)[number] | undefined;
                return item
                  ? `${item.label}: ${item.value} de ${item.target ?? 0}`
                  : "Meta individual";
              }}
            />
            <Bar
              yAxisId="quantity"
              dataKey="value"
              fill="#ffc400"
              radius={[5, 5, 0, 0]}
              maxBarSize={48}
            >
              <LabelList
                dataKey="value"
                position="top"
                fill="#5f4a00"
                fontSize={10}
                fontWeight={800}
                offset={7}
              />
            </Bar>
            <Line
              yAxisId="percentage"
              type="linear"
              dataKey="percentage"
              stroke="#111111"
              strokeWidth={2}
              dot={{ r: 3.5, fill: "#111111", strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            >
              <LabelList
                dataKey="percentage"
                position="top"
                formatter={(value: number) => `${value}%`}
                fill="#111111"
                fontSize={9}
                fontWeight={800}
                offset={13}
              />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function CircularProgress({ value }: { value: number }) {
  return (
    <div
      className="flex h-28 w-28 items-center justify-center rounded-full p-2.5 shadow-[0_10px_28px_rgba(234,179,8,0.16)]"
      style={{ background: `conic-gradient(#facc15 ${value * 3.6}deg, #eeeeee 0deg)` }}
      role="img"
      aria-label={`${value}% do objetivo mensal concluído`}
    >
      <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-white shadow-inner">
        <strong className="text-2xl font-black text-neutral-950">{value}%</strong>
        <span className="mt-1 text-[8px] font-black uppercase tracking-[0.16em] text-neutral-400">
          objetivo mensal
        </span>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-white px-2 py-2 shadow-sm">
      <b className="block text-base text-neutral-950">{value}</b>
      <span className="mt-1 block text-[9px] font-bold uppercase tracking-wide text-neutral-400">
        {label}
      </span>
    </div>
  );
}

function TeamHighlight({ seller, current }: { seller: RankingRow; current: boolean }) {
  return (
    <li
      className={`grid min-h-12 grid-cols-[24px_auto_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-2 transition-colors ${
        seller.position === 1
          ? "bg-yellow-50/80"
          : current
            ? "bg-yellow-50/40"
            : "bg-white hover:bg-neutral-50"
      }`}
    >
      <span
        className={`text-right text-sm font-black ${seller.position === 1 ? "text-yellow-600" : "text-neutral-400"}`}
      >
        {seller.position}.
      </span>
      <Avatar className="h-8 w-8 border border-neutral-200">
        <AvatarImage
          src={seller.avatarUrl || defaultAvatarForName(seller.name)}
          alt={`Foto de ${seller.name}`}
          className="object-cover"
        />
        <AvatarFallback>{initials(seller.name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className={`truncate text-xs text-neutral-950 ${current ? "font-black" : "font-bold"}`}>
          {seller.name}{" "}
          {current && <span className="text-[8px] uppercase text-yellow-600">Você</span>}
        </p>
        <p className="mt-0.5 truncate text-[8px] text-neutral-400">
          {seller.contracts} {seller.contracts === 1 ? "contrato" : "contratos"} · {seller.leads}{" "}
          leads
        </p>
      </div>
      <div className="text-right">
        <p className="text-sm font-black text-neutral-800">{seller.contracts}</p>
        <p className="text-[6px] font-black uppercase tracking-wide text-neutral-400">contratos</p>
      </div>
    </li>
  );
}

function EmptyBlock({ icon: Icon, text }: { icon: typeof Trophy; text: string }) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-center">
      <Icon className="h-6 w-6 text-yellow-500" />
      <p className="mt-2 max-w-xs text-xs font-semibold leading-5 text-neutral-500">{text}</p>
    </div>
  );
}

function MetasSkeleton() {
  return (
    <div className="min-h-0 flex-1 animate-pulse space-y-3">
      <div className="grid grid-cols-3 gap-3">
        {[1, 2, 3].map((item) => (
          <div key={item} className="h-36 rounded-2xl bg-neutral-100" />
        ))}
      </div>
      <div className="grid h-[calc(100%-9.75rem)] grid-cols-3 gap-3">
        {[1, 2, 3].map((item) => (
          <div key={item} className="rounded-2xl bg-neutral-100" />
        ))}
      </div>
    </div>
  );
}

function Estado({
  titulo,
  descricao,
  erro = false,
}: {
  titulo: string;
  descricao: string;
  erro?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-6 text-center ${
        erro
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-dashed border-yellow-300 bg-yellow-50 text-neutral-700"
      }`}
    >
      <AlertCircle
        className={`mx-auto mb-2 h-5 w-5 ${erro ? "text-red-600" : "text-yellow-600"}`}
      />
      <p className="font-bold">{titulo}</p>
      <p className="mt-1 text-sm">{descricao}</p>
    </div>
  );
}

function initials(name: string) {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "V"
  );
}
