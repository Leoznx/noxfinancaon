import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { RecentActivities, TodayAgenda } from "@/components/seller-dashboard/SellerOverviewSections";
import { SellerPerformanceBanner } from "@/components/seller-dashboard/SellerPerformanceBanner";
import { SellerRoleGoals } from "@/components/seller-dashboard/SellerRoleGoals";
import { supabase } from "@/integrations/supabase/client";
import { fetchSellerDashboard, type SellerDashboardData } from "@/lib/seller-dashboard";
import { fetchMySellerGoalProgress, type SellerGoalProgress } from "@/lib/seller-progress";
import { useAuth } from "@/components/AuthProvider";
import "@/components/seller-dashboard/seller-dashboard.css";

export const Route = createFileRoute("/vendedor/")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin"]}>
      <VendedorDashboard />
    </ProtectedRoute>
  ),
});

function VendedorDashboard() {
  const { user } = useAuth();
  const isCloser = user?.sellerType === "closer";
  const [data, setData] = useState<SellerDashboardData | null>(null);
  const [goalProgress, setGoalProgress] = useState<SellerGoalProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const realtimeRefreshTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [dashboardData, goalsData] = await Promise.all([
        fetchSellerDashboard(),
        fetchMySellerGoalProgress(),
      ]);
      setData(dashboardData);
      setGoalProgress(goalsData);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Não foi possível carregar o dashboard.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const sellerId = data?.seller.id;
    if (!sellerId) return;

    const scheduleRefresh = () => {
      if (realtimeRefreshTimer.current) window.clearTimeout(realtimeRefreshTimer.current);
      realtimeRefreshTimer.current = window.setTimeout(() => void load(), 250);
    };
    const sellerFilter = `seller_id=eq.${sellerId}`;
    const channel = supabase
      .channel(`seller-dashboard-live-${sellerId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sales_leads",
          filter: `assigned_seller_id=eq.${sellerId}`,
        },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_commissions", filter: sellerFilter },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_appointments", filter: sellerFilter },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "seller_appointments",
          filter: `sdr_id=eq.${sellerId}`,
        },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_goals", filter: sellerFilter },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_client_partnerships", filter: sellerFilter },
        scheduleRefresh,
      )
      .subscribe();

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") scheduleRefresh();
    };
    window.addEventListener("focus", scheduleRefresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      if (realtimeRefreshTimer.current) window.clearTimeout(realtimeRefreshTimer.current);
      window.removeEventListener("focus", scheduleRefresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      void supabase.removeChannel(channel);
    };
  }, [data?.seller.id, load]);

  return (
    <DashboardLayout lockDesktopViewport>
      <div className="seller-dashboard relative mx-auto w-full max-w-[1440px] space-y-3 sm:space-y-4 xl:grid xl:h-full xl:min-h-0 xl:grid-rows-[auto_120px_auto_minmax(210px,1fr)] xl:gap-3 xl:space-y-0">
        <div className="seller-dashboard__heading flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-[26px] font-bold tracking-[-0.035em] text-neutral-950 sm:text-[27px]">
                Dashboard
              </h1>
              <span className="rounded-full border border-yellow-300 bg-yellow-50 px-2 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-yellow-800">
                {isCloser ? "Closer" : "SDR"}
              </span>
            </div>
            <p className="mt-0.5 text-sm font-medium text-neutral-500">
              {isCloser
                ? "Metas, atividades e agenda para conduzir cada oportunidade ao fechamento."
                : "Metas, atividades e agenda para manter sua prospecção no ritmo certo."}
            </p>
          </div>
          <Button
            variant="outline"
            className="h-11 shrink-0 gap-2 rounded-xl border-neutral-200 bg-white px-3 text-xs shadow-sm sm:h-10 sm:px-4"
            onClick={load}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>

        {loading && !data ? (
          <DashboardSkeleton />
        ) : data && goalProgress ? (
          <>
            <SellerPerformanceBanner />

            {error && (
              <div className="xl:absolute xl:right-0 xl:top-12 xl:z-20 xl:w-[440px]">
                <DashboardError message={error} />
              </div>
            )}

            <SellerRoleGoals
              progress={goalProgress}
              sellerType={isCloser ? "closer" : "sdr"}
            />

            <div className="seller-dashboard__overview grid min-w-0 items-stretch gap-4 md:grid-cols-2 xl:min-h-0 xl:gap-3">
              <RecentActivities activities={data.activities} />
              <TodayAgenda appointments={data.agenda} />
            </div>
          </>
        ) : (
          <DashboardError message={error || "Não foi possível carregar o dashboard."} />
        )}
      </div>
    </DashboardLayout>
  );
}

function DashboardError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-label="Carregando dashboard" className="animate-pulse space-y-4 xl:contents">
      <div className="h-[120px] rounded-2xl bg-neutral-200/70" />
      <div className="h-[220px] rounded-2xl bg-neutral-200/70" />
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="h-[260px] rounded-2xl bg-neutral-200/70" />
        ))}
      </div>
    </div>
  );
}
