import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, History, RefreshCw } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { CommissionHistory } from "@/components/seller-commissions/CommissionHistory";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import type { SellerCommissionRow } from "@/lib/seller-commissions-view";
import { getSellerContext } from "@/lib/vendedor-portal";

export const Route = createFileRoute("/vendedor/historico-comissoes")({
  component: () => (
    <ProtectedRoute
      roles={["vendedor", "admin_master", "admin", "financeiro"]}
      moduleKey="comissoes_proprias"
    >
      <SellerCommissionHistoryPage />
    </ProtectedRoute>
  ),
});

function SellerCommissionHistoryPage() {
  const [rows, setRows] = useState<SellerCommissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const load = useCallback(async (showRefreshState = false) => {
    if (showRefreshState) setRefreshing(true);
    setErrorMessage("");

    try {
      const context = await getSellerContext();
      if (!context.sellerId) throw new Error("Não encontramos um vendedor ativo para este usuário.");

      const result = await supabase
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
        .order("created_at", { ascending: false });

      if (result.error) throw result.error;
      setRows((result.data as unknown as SellerCommissionRow[]) ?? []);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Não foi possível carregar o histórico.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("seller-commission-history-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_commissions" },
        () => void load(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  return (
    <DashboardLayout>
      <main className="space-y-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <History className="h-6 w-6 text-[#D4AF00]" aria-hidden="true" />
              <h1 className="text-2xl font-black tracking-[-0.025em] text-[#111]">
                Histórico de Comissões
              </h1>
            </div>
            <p className="mt-1 text-sm text-[#6B6B6B]">
              Consulte pagamentos, retenções e liberações por período.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            onClick={() => void load(true)}
            disabled={refreshing || loading}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </header>

        {errorMessage ? (
          <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>{errorMessage}</p>
          </div>
        ) : null}

        {loading ? (
          <div className="h-64 animate-pulse rounded-[18px] border border-[#E9E9E9] bg-white" />
        ) : (
          <CommissionHistory rows={rows} />
        )}
      </main>
    </DashboardLayout>
  );
}
