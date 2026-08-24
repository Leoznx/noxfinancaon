import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CircleDollarSign, FileCheck2, RefreshCw, Target, Users } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { ContractsChart, type ChartRange } from "@/components/seller-dashboard/ContractsChart";
import { SellerKpiCard } from "@/components/seller-dashboard/SellerKpiCard";
import {
  PipelineSummary,
  RecentActivities,
  SellerRanking,
  TodayAgenda,
} from "@/components/seller-dashboard/SellerOverviewSections";
import { SellerPerformanceBanner } from "@/components/seller-dashboard/SellerPerformanceBanner";
import {
  calculateGrowth,
  fetchSellerDashboard,
  goalProgress,
  type SellerDashboardData,
} from "@/lib/seller-dashboard";
import { formatMoney } from "@/lib/vendedor-portal";

export const Route = createFileRoute("/vendedor/")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin"]}>
      <VendedorDashboard />
    </ProtectedRoute>
  ),
});

function VendedorDashboard() {
  const [data, setData] = useState<SellerDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [chartRange, setChartRange] = useState<ChartRange>("12");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await fetchSellerDashboard());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar o dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const computed = useMemo(() => {
    if (!data) return null;
    return {
      contractsGrowth: calculateGrowth(data.metrics.contractsCurrent, data.metrics.contractsPrevious),
      commissionsGrowth: calculateGrowth(data.metrics.commissionsCurrent, data.metrics.commissionsPrevious),
      goalPercentage: goalProgress(data.metrics.contractsCurrent, data.metrics.goalTarget),
      contractsDelta: data.metrics.contractsCurrent - data.metrics.contractsPrevious,
      contractTrend: data.monthlyHistory.slice(-8).map((month) => month.contracts),
      commissionTrend: data.monthlyHistory.slice(-8).map((month) => month.commissions),
    };
  }, [data]);

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-[1440px] space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-[27px] font-bold tracking-[-0.035em] text-neutral-950">Dashboard</h1>
            <p className="mt-0.5 text-[13px] font-medium text-neutral-500">Resumo real da sua operação comercial.</p>
          </div>
          <Button variant="outline" className="h-9 gap-2 self-start rounded-lg border-neutral-200 bg-white px-4 text-xs shadow-sm sm:self-auto" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>

        {loading && !data ? (
          <DashboardSkeleton />
        ) : data && computed ? (
          <>
            <SellerPerformanceBanner
              contractsGrowth={computed.contractsGrowth}
              commissionsGrowth={computed.commissionsGrowth}
              rankingPosition={data.metrics.rankingPosition}
              goalPercentage={computed.goalPercentage}
            />

            {error && <DashboardError message={error} />}

            <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.18fr)_minmax(480px,0.98fr)]">
              <ContractsChart history={data.monthlyHistory} range={chartRange} onRangeChange={setChartRange} />

              <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
                <SellerKpiCard
                  icon={Users}
                  title="Leads pendentes"
                  value={String(data.metrics.leadsPending)}
                  subtitle={data.metrics.leadsNewThisWeek > 0 ? `+${data.metrics.leadsNewThisWeek} novos esta semana ↑` : "Nenhum novo esta semana"}
                  variant="yellow"
                  sparkline={data.leadTrend}
                />
                <SellerKpiCard
                  icon={FileCheck2}
                  title="Contratos fechados no mês"
                  value={String(data.metrics.contractsCurrent)}
                  subtitle={computed.contractsDelta > 0 ? `+${computed.contractsDelta} vs mês anterior ↑` : computed.contractsDelta < 0 ? `${computed.contractsDelta} vs mês anterior` : "Mesmo resultado do mês anterior"}
                  variant="green"
                  sparkline={computed.contractTrend}
                />
                <SellerKpiCard
                  icon={CircleDollarSign}
                  title="Comissões acumuladas"
                  value={formatMoney(data.metrics.commissionsAccumulated)}
                  subtitle={formatGrowthText(computed.commissionsGrowth)}
                  variant="purple"
                  sparkline={computed.commissionTrend}
                />
                <SellerKpiCard
                  icon={Target}
                  title="Meta do mês"
                  value={computed.goalPercentage === null ? "—" : `${Math.round(computed.goalPercentage)}%`}
                  subtitle={data.metrics.goalTarget ? `${data.metrics.contractsCurrent} / ${data.metrics.goalTarget} contratos` : "Meta ainda não definida"}
                  variant="blue"
                  progress={computed.goalPercentage}
                />
              </div>
            </div>

            <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <PipelineSummary stages={data.pipeline} />
              <RecentActivities activities={data.activities} />
              <TodayAgenda appointments={data.agenda} />
              <SellerRanking ranking={data.ranking} />
            </div>
          </>
        ) : (
          <DashboardError message={error || "Não foi possível carregar o dashboard."} />
        )}
      </div>
    </DashboardLayout>
  );
}

function formatGrowthText(value: number | null) {
  if (value === null) return "Sem base no mês anterior";
  const rounded = Math.round(value);
  if (rounded === 0) return "Mesmo resultado do mês anterior";
  return `${rounded > 0 ? "+" : ""}${rounded}% vs mês anterior${rounded > 0 ? " ↑" : ""}`;
}

function DashboardError({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-label="Carregando dashboard" className="animate-pulse space-y-4">
      <div className="h-[150px] rounded-2xl bg-neutral-200/70" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.18fr)_minmax(480px,0.98fr)]">
        <div className="h-[310px] rounded-2xl bg-neutral-200/70" />
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-[147px] rounded-2xl bg-neutral-200/70" />)}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-[286px] rounded-2xl bg-neutral-200/70" />)}
      </div>
    </div>
  );
}
