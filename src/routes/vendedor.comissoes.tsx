import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { CommissionHistory } from "@/components/seller-commissions/CommissionHistory";
import { CommissionIncentives } from "@/components/seller-commissions/CommissionIncentives";
import { CommissionProgressCard } from "@/components/seller-commissions/CommissionProgressCard";
import { CommissionStatsGrid } from "@/components/seller-commissions/CommissionStatsGrid";
import { CommissionsHeader } from "@/components/seller-commissions/CommissionsHeader";
import { CommissionsSkeleton } from "@/components/seller-commissions/CommissionsSkeleton";
import { supabase } from "@/integrations/supabase/client";
import { calcularGanhoTotal, getNivelComissaoVendedor } from "@/lib/comissao-vendedor";
import { summarizeCommissions, type SellerCommissionRow } from "@/lib/seller-commissions-view";
import { fetchMySellerMonthlyProgress, type SellerMonthlyProgress } from "@/lib/seller-progress";
import { fetchSellerRewards, type SellerReward } from "@/lib/seller-rewards";
import { getSellerContext } from "@/lib/vendedor-portal";

export const Route = createFileRoute("/vendedor/comissoes")({
  component: () => (
    <ProtectedRoute
      roles={["vendedor", "admin_master", "admin", "financeiro"]}
      moduleKey="comissoes_proprias"
    >
      <CommissionsPage />
    </ProtectedRoute>
  ),
});

function CommissionsPage() {
  const [rows, setRows] = useState<SellerCommissionRow[]>([]);
  const [progress, setProgress] = useState<SellerMonthlyProgress | null>(null);
  const [rewards, setRewards] = useState<SellerReward[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const now = useMemo(() => new Date(), []);
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const load = useCallback(
    async (showRefreshState = false) => {
      if (showRefreshState) setRefreshing(true);
      setErrorMessage("");

      try {
        const context = await getSellerContext();
        if (!context.sellerId)
          throw new Error("Não encontramos um vendedor ativo para este usuário.");

        const [commissionResult, monthlyProgress, activeRewards] = await Promise.all([
          supabase
            .from("seller_commissions" as any)
            .select(
              `
            *,
            apolices(
              numero,
              status,
              consulta:consultas_credito(
                tenant_name,
                inquilino:inquilinos(nome, razao_social)
              )
            )
          `,
            )
            .eq("seller_id", context.sellerId)
            .order("year", { ascending: false })
            .order("month", { ascending: false })
            .order("created_at", { ascending: false }),
          fetchMySellerMonthlyProgress(month, year),
          fetchSellerRewards(month, year),
        ]);

        if (commissionResult.error) throw commissionResult.error;
        setRows((commissionResult.data as unknown as SellerCommissionRow[]) ?? []);
        setProgress(monthlyProgress);
        setRewards(activeRewards);
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Não foi possível carregar suas comissões.",
        );
      } finally {
        setLoaded(true);
        setRefreshing(false);
      }
    },
    [month, year],
  );

  useEffect(() => {
    void load();
    const refreshSilently = () => void load();
    const channel = supabase
      .channel("seller-commissions-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_commissions" },
        refreshSilently,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_rewards" },
        refreshSilently,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_client_partnerships" },
        refreshSilently,
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "apolices" }, refreshSilently)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "faturas_inquilino" },
        refreshSilently,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "mensalidades" },
        refreshSilently,
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const summary = useMemo(() => summarizeCommissions(rows), [rows]);
  const contracts = progress?.contracts_closed ?? 0;
  const monthlyGain = useMemo(() => calcularGanhoTotal(contracts), [contracts]);
  const level = useMemo(() => getNivelComissaoVendedor(contracts), [contracts]);
  const hasFinancialData = progress !== null;

  return (
    <DashboardLayout>
      <main className="space-y-5">
        <CommissionsHeader refreshing={refreshing || !loaded} onRefresh={() => void load(true)} />

        {errorMessage && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-bold">Não foi possível atualizar suas comissões.</p>
              <p className="mt-0.5 text-red-700">
                {errorMessage} Use o botão Atualizar para tentar novamente.
              </p>
            </div>
          </div>
        )}

        {!loaded || (!hasFinancialData && errorMessage) ? (
          <CommissionsSkeleton />
        ) : (
          <>
            <CommissionProgressCard contracts={contracts} level={level} monthlyGain={monthlyGain} />
            <CommissionStatsGrid summary={summary} />
            {progress ? (
              <CommissionIncentives rewards={rewards} progress={progress} rows={rows} />
            ) : null}
            <CommissionHistory rows={rows} />
          </>
        )}
      </main>
    </DashboardLayout>
  );
}
