import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Award,
  CalendarDays,
  CheckCircle2,
  Gift,
  ImageIcon,
  RefreshCw,
  Sparkles,
  Target,
  Trophy,
  Users,
  Video,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { defaultAvatarForName } from "@/lib/gender-avatar";
import {
  sellerGoalPercentage,
  sellerOverallProgress,
  sellerRewardCriterion,
  sellerRewardCurrent,
} from "@/lib/seller-goals-dashboard";
import { fetchMySellerMonthlyProgress, type SellerMonthlyProgress } from "@/lib/seller-progress";
import { fetchSellerRewards, type SellerReward } from "@/lib/seller-rewards";

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
  const [rewards, setRewards] = useState<SellerReward[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro("");
    try {
      const [progressData, rewardsData, rankingResponse] = await Promise.all([
        fetchMySellerMonthlyProgress(month, year),
        fetchSellerRewards(month, year),
        (supabase as any).rpc("ranking_vendedores", { p_month: month, p_year: year }),
      ]);
      if (rankingResponse.error) throw rankingResponse.error;
      setProgress(progressData);
      setRewards(rewardsData);
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
      .on("postgres_changes", { event: "*", schema: "public", table: "seller_rewards" }, refresh)
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
  const teamContracts = useMemo(
    () => ranking.reduce((total, seller) => total + seller.contracts, 0),
    [ranking],
  );

  return (
    <DashboardLayout>
      <div className="space-y-5 pb-8 text-neutral-950">
        <section className="relative overflow-hidden rounded-[26px] border border-yellow-300 bg-[radial-gradient(circle_at_92%_20%,rgba(250,204,21,0.28),transparent_24%),linear-gradient(115deg,#ffffff_0%,#fffef8_60%,#fff4b3_100%)] px-5 py-6 shadow-sm sm:px-7 lg:py-7">
          <div className="pointer-events-none absolute -right-12 -top-20 h-52 w-52 rounded-full border-[28px] border-yellow-400/15" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-yellow-400 bg-white/80 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-yellow-700 shadow-sm">
                <CalendarDays className="h-3.5 w-3.5" /> {MONTHS[month - 1]} de {year}
              </span>
              <h1 className="mt-4 text-3xl font-black tracking-[-0.045em] sm:text-4xl">
                Minhas <span className="text-yellow-400">Metas</span>
              </h1>
              <p className="mt-2 max-w-2xl text-sm font-medium text-neutral-600">
                Acompanhe seus resultados, avance no ranking e desbloqueie as recompensas da equipe
                NOX.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {currentPosition && (
                <div className="rounded-2xl border border-yellow-300 bg-white/85 px-4 py-2.5 text-right shadow-sm">
                  <p className="text-[9px] font-black uppercase tracking-[0.16em] text-neutral-400">
                    Sua posição
                  </p>
                  <p className="text-xl font-black text-neutral-950">{currentPosition}º lugar</p>
                </div>
              )}
              <Button
                variant="outline"
                size="icon"
                className="h-12 w-12 rounded-2xl border-yellow-300 bg-white/90"
                onClick={carregar}
                disabled={loading}
                aria-label="Atualizar metas"
              >
                <RefreshCw className={`h-5 w-5 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </section>

        {erro && <Estado titulo="Não foi possível carregar suas metas" descricao={erro} erro />}

        {loading ? (
          <MetasSkeleton />
        ) : !erro && progress ? (
          <>
            {!hasGoals && (
              <Estado
                titulo="Metas ainda não definidas"
                descricao="O administrador precisa definir as três metas do mês na Equipe NOX."
              />
            )}

            <section className="grid gap-4 lg:grid-cols-3" aria-label="Metas principais do mês">
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

            <section className="grid items-stretch gap-4 xl:grid-cols-[0.9fr_1.08fr_1.25fr]">
              <Card className="overflow-hidden border-neutral-200 shadow-sm">
                <CardHeader className="border-b border-neutral-100 pb-4">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Target className="h-5 w-5 text-yellow-500" /> Progresso geral
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex min-h-[390px] flex-col items-center justify-center p-6 text-center">
                  <CircularProgress value={overallProgress} />
                  <p className="mt-6 text-lg font-black text-neutral-950">
                    {overallProgress >= 100
                      ? "Objetivo do mês concluído!"
                      : overallProgress >= 60
                        ? "Você está no caminho certo."
                        : "Cada resultado faz a diferença."}
                  </p>
                  <p className="mt-2 max-w-xs text-sm leading-6 text-neutral-500">
                    {overallProgress >= 100
                      ? "Continue superando seus números e busque novas recompensas."
                      : "Mantenha o foco nas metas ativas para conquistar reconhecimento e premiações."}
                  </p>
                  <div className="mt-6 grid w-full grid-cols-2 gap-2 rounded-2xl bg-neutral-50 p-3">
                    <MiniStat label="Contratos da equipe" value={teamContracts} />
                    <MiniStat
                      label="Sua colocação"
                      value={currentPosition ? `${currentPosition}º` : "—"}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="overflow-hidden border-yellow-200 shadow-sm">
                <CardHeader className="border-b border-yellow-100 bg-yellow-50/50 pb-4">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Award className="h-5 w-5 text-yellow-600" /> Destaques da equipe
                    </CardTitle>
                    <Badge
                      variant="outline"
                      className="border-yellow-300 bg-white text-[9px] font-black uppercase tracking-wider text-yellow-700"
                    >
                      Ranking mensal
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-3">
                  {ranking.length === 0 ? (
                    <EmptyBlock
                      icon={Trophy}
                      text="O ranking aparecerá quando a equipe registrar resultados."
                    />
                  ) : (
                    <div className="space-y-2">
                      {ranking.slice(0, 7).map((seller) => (
                        <TeamHighlight
                          key={seller.id}
                          seller={seller}
                          current={seller.id === progress.seller_id}
                        />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="overflow-hidden border-yellow-200 shadow-sm">
                <CardHeader className="border-b border-yellow-100 bg-[linear-gradient(120deg,#fffbe8,#ffffff)] pb-4">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Gift className="h-5 w-5 text-yellow-600" /> Recompensas do mês
                  </CardTitle>
                  <p className="text-xs leading-5 text-neutral-500">
                    Complete os desafios e desbloqueie as premiações definidas pela NOX.
                  </p>
                </CardHeader>
                <CardContent className="p-3">
                  {rewards.length === 0 ? (
                    <EmptyBlock
                      icon={Gift}
                      text="Nenhuma recompensa foi configurada para este mês."
                    />
                  ) : (
                    <div className="space-y-3">
                      {rewards.map((reward) => (
                        <RewardCard key={reward.id} reward={reward} progress={progress} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>

            <Card className="overflow-hidden border-neutral-200 shadow-sm">
              <CardHeader className="border-b border-neutral-100 bg-neutral-50/60">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-5 w-5 text-yellow-500" /> Bonificação por produção
                </CardTitle>
                <p className="text-xs text-neutral-500">
                  As faixas são cumulativas e avançam automaticamente com os contratos do mês.
                </p>
              </CardHeader>
              <CardContent className="grid gap-3 p-4 md:grid-cols-3">
                <Tier
                  title="1º ao 15º contrato"
                  value="R$ 35 cada"
                  bonus="No 15º: + R$ 400"
                  active={contracts <= 15}
                />
                <Tier
                  title="16º ao 25º contrato"
                  value="R$ 55 cada"
                  bonus="No 30º: + R$ 600"
                  active={contracts >= 16 && contracts <= 25}
                />
                <Tier
                  title="A partir do 26º"
                  value="R$ 75 cada"
                  bonus="Acima de 45: + R$ 1.200"
                  active={contracts >= 26}
                />
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
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
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-yellow-300 bg-yellow-50 text-yellow-700">
            <Icon className="h-5 w-5" />
          </div>
          <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-black text-neutral-500">
            {percentage}%
          </span>
        </div>
        <p className="mt-4 text-sm font-black text-neutral-700">{label}</p>
        <p className="mt-1 text-3xl font-black tracking-tight text-neutral-950">
          {current} <span className="text-base text-neutral-400">/ {target ?? 0}</span>
        </p>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-neutral-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-yellow-500 to-yellow-300 transition-all duration-500"
            style={{ width: `${percentage}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] font-semibold">
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

function CircularProgress({ value }: { value: number }) {
  return (
    <div
      className="flex h-36 w-36 items-center justify-center rounded-full p-3 shadow-[0_12px_34px_rgba(234,179,8,0.18)]"
      style={{ background: `conic-gradient(#facc15 ${value * 3.6}deg, #eeeeee 0deg)` }}
      role="img"
      aria-label={`${value}% do objetivo mensal concluído`}
    >
      <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-white shadow-inner">
        <strong className="text-3xl font-black text-neutral-950">{value}%</strong>
        <span className="mt-1 text-[8px] font-black uppercase tracking-[0.16em] text-neutral-400">
          objetivo mensal
        </span>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-white px-2 py-3 shadow-sm">
      <b className="block text-lg text-neutral-950">{value}</b>
      <span className="mt-1 block text-[9px] font-bold uppercase tracking-wide text-neutral-400">
        {label}
      </span>
    </div>
  );
}

function TeamHighlight({ seller, current }: { seller: RankingRow; current: boolean }) {
  return (
    <article
      className={`grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl border px-2.5 py-2.5 ${
        seller.position === 1
          ? "border-yellow-400 bg-yellow-50"
          : current
            ? "border-yellow-300 bg-yellow-50/50"
            : "border-neutral-200 bg-white"
      }`}
    >
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-black ${
          seller.position === 1 ? "bg-yellow-400 text-black" : "bg-neutral-100 text-neutral-600"
        }`}
      >
        {seller.position}º
      </span>
      <Avatar className="h-9 w-9 border border-neutral-200">
        <AvatarImage
          src={seller.avatarUrl || defaultAvatarForName(seller.name)}
          alt={`Foto de ${seller.name}`}
          className="object-cover"
        />
        <AvatarFallback>{initials(seller.name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-xs font-black text-neutral-950">
          {seller.name}{" "}
          {current && <span className="text-[8px] uppercase text-yellow-600">Você</span>}
        </p>
        <p className="mt-0.5 truncate text-[9px] text-neutral-500">
          {seller.contracts} {seller.contracts === 1 ? "contrato" : "contratos"} · {seller.leads}{" "}
          leads
        </p>
      </div>
      <div className="text-right">
        <p className="text-lg font-black text-yellow-500">{seller.contracts}</p>
        <p className="text-[7px] font-black uppercase tracking-wide text-neutral-400">fechados</p>
      </div>
    </article>
  );
}

function RewardCard({
  reward,
  progress,
}: {
  reward: SellerReward;
  progress: SellerMonthlyProgress;
}) {
  const current = sellerRewardCurrent(progress, reward.metric);
  const percentage = sellerGoalPercentage(current, reward.target);
  const remaining = Math.max(0, reward.target - current);
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <article className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-3 p-3">
        {imageFailed ? (
          <div className="flex h-[92px] items-center justify-center rounded-xl bg-yellow-50 text-yellow-600">
            <ImageIcon className="h-6 w-6" />
          </div>
        ) : (
          <img
            src={reward.image_url}
            alt={reward.title}
            className="h-[92px] w-[92px] rounded-xl bg-neutral-100 object-cover"
            onError={() => setImageFailed(true)}
          />
        )}
        <div className="min-w-0 py-0.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-neutral-950">{reward.title}</p>
              <p className="mt-0.5 text-[10px] font-bold text-yellow-700">
                {sellerRewardCriterion(reward.metric, reward.target)}
              </p>
            </div>
            {remaining === 0 && <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />}
          </div>
          {reward.description && (
            <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-neutral-500">
              {reward.description}
            </p>
          )}
        </div>
      </div>
      <div className="border-t border-neutral-100 bg-neutral-50/70 px-3 py-3">
        <div className="flex items-center justify-between text-[10px] font-black">
          <span className={remaining === 0 ? "text-emerald-700" : "text-neutral-600"}>
            {remaining === 0 ? "Recompensa conquistada" : `Faltam ${remaining} para desbloquear`}
          </span>
          <span className="rounded-full border border-yellow-300 bg-yellow-50 px-2 py-0.5 text-yellow-800">
            {current}/{reward.target}
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-200">
          <div className="h-full rounded-full bg-yellow-400" style={{ width: `${percentage}%` }} />
        </div>
      </div>
    </article>
  );
}

function Tier({
  title,
  value,
  bonus,
  active,
}: {
  title: string;
  value: string;
  bonus: string;
  active: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-4 ${
        active
          ? "border-yellow-400 bg-yellow-50 ring-2 ring-yellow-100"
          : "border-neutral-200 bg-white"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-black text-neutral-950">{title}</p>
        {active && <Badge className="bg-yellow-400 text-[9px] text-black">FAIXA ATUAL</Badge>}
      </div>
      <p className="mt-3 text-lg font-black text-yellow-700">{value}</p>
      <p className="mt-0.5 text-xs text-neutral-500">{bonus}</p>
      <ArrowUpRight className="absolute bottom-3 right-3 h-5 w-5 text-yellow-400/50" />
    </div>
  );
}

function EmptyBlock({ icon: Icon, text }: { icon: typeof Gift; text: string }) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-6 text-center">
      <Icon className="h-7 w-7 text-yellow-500" />
      <p className="mt-3 max-w-xs text-sm font-semibold leading-5 text-neutral-500">{text}</p>
    </div>
  );
}

function MetasSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {[1, 2, 3].map((item) => (
          <div key={item} className="h-52 rounded-2xl bg-neutral-100" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        {[1, 2, 3].map((item) => (
          <div key={item} className="h-[430px] rounded-2xl bg-neutral-100" />
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
