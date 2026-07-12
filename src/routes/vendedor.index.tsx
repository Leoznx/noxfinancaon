import { createFileRoute, Link } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardEquipeBanner } from "@/components/DashboardEquipeBanner";
import { Button } from "@/components/ui/button";
import { AlertCircle, BellRing, RefreshCw, Search, DollarSign } from "lucide-react";
import {
  STATUS_COMISSAO_VALIDA,
  formatMoney,
  getSellerContext,
} from "@/lib/vendedor-portal";

export const Route = createFileRoute("/vendedor/")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin"]}>
      <VendedorDashboard />
    </ProtectedRoute>
  ),
});

type DashboardStats = {
  leadsPendentes: number;
  lembretesAgenda: number;
  comissoesAcumuladas: number;
};

const initialStats: DashboardStats = {
  leadsPendentes: 0,
  lembretesAgenda: 0,
  comissoesAcumuladas: 0,
};

function VendedorDashboard() {
  const [stats, setStats] = useState<DashboardStats>(initialStats);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");

  async function carregar() {
    setLoading(true);
    setErro("");

    try {
      const context = await getSellerContext();
      if (!context.sellerId) {
        setStats(initialStats);
        setErro("Não encontramos um cadastro interno de vendedor ativo para este usuário.");
        return;
      }

      const fimDoDia = new Date();
      fimDoDia.setHours(23, 59, 59, 999);

      const [
        leadsPendentes,
        comissoes,
        lembretesAgenda,
      ] = await Promise.all([
        supabase
          .from("sales_leads" as any)
          .select("id", { count: "exact", head: true })
          .eq("assigned_seller_id", context.sellerId)
          .in("status", ["pendente", "novo"]),
        supabase
          .from("seller_commissions" as any)
          .select("commission_amount, bonus_amount, reserve_amount, released_amount, status")
          .eq("seller_id", context.sellerId)
          .in("status", [...STATUS_COMISSAO_VALIDA]),
        supabase
          .from("seller_appointments" as any)
          .select("id", { count: "exact", head: true })
          .eq("seller_id", context.sellerId)
          .not("status", "in", "(concluido,cancelado)")
          .lte("scheduled_at", fimDoDia.toISOString()),
      ]);

      if (leadsPendentes.error) throw leadsPendentes.error;
      if (comissoes.error) throw comissoes.error;
      if (lembretesAgenda.error) throw lembretesAgenda.error;

      const totalComissoes = ((comissoes.data as any[]) ?? []).reduce((total, item) => {
        return total
          + Number(item.commission_amount ?? 0)
          + Number(item.bonus_amount ?? 0)
          + Number(item.reserve_amount ?? 0)
          + Number(item.released_amount ?? 0);
      }, 0);

      setStats({
        leadsPendentes: leadsPendentes.count ?? 0,
        lembretesAgenda: lembretesAgenda.count ?? 0,
        comissoesAcumuladas: totalComissoes,
      });
    } catch (e: any) {
      setErro(e.message || "Não foi possível carregar o dashboard.");
      setStats(initialStats);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  const cards = useMemo(() => [
    { label: "Leads Pendentes", value: stats.leadsPendentes, icon: Search, href: "/vendedor/leads" },
    { label: "Lembrete de Agenda", value: stats.lembretesAgenda, icon: BellRing, href: "/vendedor/agenda" },
    { label: "Comissões Acumuladas", value: formatMoney(stats.comissoesAcumuladas), icon: DollarSign, href: "/vendedor/comissoes" },
  ], [stats]);

  return (
    <DashboardLayout>
      <div className="space-y-7">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-neutral-950">Dashboard</h1>
            <p className="text-sm font-medium text-neutral-500">Resumo real da sua operação comercial.</p>
          </div>
          <Button variant="outline" className="gap-2 self-start lg:self-auto" onClick={carregar} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>

        <DashboardEquipeBanner />

        {erro && (
          <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        <div className="grid gap-5 md:grid-cols-3">
          {cards.map((card) => (
            <Link
              key={card.label}
              to={card.href as any}
              className="group rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm transition hover:border-yellow-300 hover:shadow-md"
            >
              <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-xl border border-neutral-100 bg-neutral-50 text-neutral-950 transition group-hover:border-yellow-200 group-hover:bg-yellow-50">
                <card.icon className="h-5 w-5" strokeWidth={1.8} />
              </div>
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-neutral-400">{card.label}</p>
              <p className="mt-2 text-3xl font-black text-neutral-950">
                {loading ? "..." : card.value}
              </p>
            </Link>
          ))}
        </div>

        {!loading && !erro && Object.values(stats).every((value) => value === 0) && (
          <div className="rounded-2xl border border-dashed border-neutral-200 bg-white p-8 text-center">
            <p className="font-bold text-neutral-950">Nenhum dado operacional encontrado.</p>
            <p className="mt-1 text-sm text-neutral-500">Quando leads, contratos ou comissões forem vinculados a você, o resumo aparece aqui.</p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
