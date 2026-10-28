import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { DashboardEquipeBanner } from "@/components/DashboardEquipeBanner";
import {
  Search,
  FileText,
  Users,
  DollarSign,
  TrendingUp,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { redirectPathForRole } from "@/lib/authRedirect";
import { useEssentialLoading } from "@/components/GlobalLoading";
import { loadDashboardOverview, peekDashboardOverview } from "@/lib/dashboard-overview-data";
import type { DashboardStats } from "@/lib/dashboard-stats";

const JuridicoDashboard = lazy(() =>
  import("@/components/JuridicoDashboard").then((module) => ({ default: module.JuridicoDashboard })),
);
const FinanceiroDashboard = lazy(() =>
  import("@/components/FinanceiroDashboard").then((module) => ({ default: module.FinanceiroDashboard })),
);
const MarketingDashboard = lazy(() =>
  import("@/components/MarketingDashboard").then((module) => ({ default: module.MarketingDashboard })),
);
const ImobiliariaDashboard = lazy(() =>
  import("@/components/ImobiliariaDashboard").then((module) => ({ default: module.ImobiliariaDashboard })),
);
const CorretorDashboard = lazy(() =>
  import("@/components/CorretorDashboard").then((module) => ({ default: module.CorretorDashboard })),
);
const OwnerDashboard = lazy(() =>
  import("@/components/owner-dashboard/OwnerDashboard").then((module) => ({ default: module.OwnerDashboard })),
);

const formatarBRL = (v: number) =>
  (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function DashboardRoleSkeleton() {
  return (
    <div className="grid gap-3" aria-label="Preparando painel">
      <div className="h-52 rounded-2xl bg-neutral-100" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-20 rounded-2xl bg-neutral-100" />
        ))}
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="h-72 rounded-2xl bg-neutral-100" />
        ))}
      </div>
    </div>
  );
}

function DashboardRoleShell() {
  return (
    <DashboardLayout lockDesktopViewport>
      <DashboardRoleSkeleton />
    </DashboardLayout>
  );
}

export const Route = createFileRoute("/dashboard")({
  component: () => (
    <ProtectedRoute>
      <Dashboard />
    </ProtectedRoute>
  ),
});

function Dashboard() {
  const { user } = useAuth();
  const dashboardPath = redirectPathForRole(user?.internalRole || user?.role);

  // /dashboard é compartilhada por vários perfis. Quem possui uma rota própria
  // nunca deve cair no painel genérico antigo ao abrir este endereço diretamente.
  if (user && dashboardPath !== "/dashboard") {
    return <Navigate to={dashboardPath as any} replace />;
  }

  if (user?.role === "proprietario") {
    return (
      <Suspense fallback={<DashboardRoleShell />}>
        <OwnerDashboard />
      </Suspense>
    );
  }
  return <DashboardForRole />;
}

function DashboardForRole() {
  const { user } = useAuth();
  const isJuridico = user?.internalRole === "juridico" || user?.role === "juridico";
  const isFinanceiro = user?.internalRole === "financeiro" || user?.role === "financeiro";
  const isMarketing = user?.internalRole === "marketing" || user?.role === "marketing";
  const isCorretor = user?.role === "corretor" && !isJuridico && !isFinanceiro && !isMarketing;
  const isImobiliaria = user?.role === "imobiliaria";
  const cachedStats = user?.id ? peekDashboardOverview(user.id) : undefined;
  const [loadingConsultas, setLoadingConsultas] = useState(cachedStats === undefined);
  const [stats, setStats] = useState<DashboardStats | null>(() => cachedStats ?? null);

  useEssentialLoading(
    loadingConsultas &&
      !stats &&
      !isJuridico &&
      !isFinanceiro &&
      !isMarketing &&
      !isImobiliaria &&
      !isCorretor,
  );

  const carregarDados = useCallback(async (force = false) => {
    if (!user?.id || isJuridico || isFinanceiro || isMarketing || isImobiliaria || isCorretor) {
      setLoadingConsultas(false);
      return;
    }
    try {
      setStats(await loadDashboardOverview(user.id, force));
    } finally {
      setLoadingConsultas(false);
    }
  }, [
    user?.id,
    isImobiliaria,
    isCorretor,
    isJuridico,
    isFinanceiro,
    isMarketing,
  ]);

  useEffect(() => {
    void carregarDados();
  }, [carregarDados]);

  // Sem Realtime configurado nessas tabelas ainda — reconsulta ao voltar pra aba,
  // que já cobre o caso comum de "criei uma consulta/apólice em outra aba e voltei".
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void carregarDados();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [carregarDados]);

  if (isJuridico) {
    return (
      <DashboardLayout lockDesktopViewport>
        <Suspense fallback={<DashboardRoleSkeleton />}><JuridicoDashboard /></Suspense>
      </DashboardLayout>
    );
  }

  if (isFinanceiro) {
    return (
      <DashboardLayout>
        <Suspense fallback={<DashboardRoleSkeleton />}><FinanceiroDashboard /></Suspense>
      </DashboardLayout>
    );
  }

  if (isMarketing) {
    return (
      <DashboardLayout>
        <Suspense fallback={<DashboardRoleSkeleton />}><MarketingDashboard /></Suspense>
      </DashboardLayout>
    );
  }

  if (isCorretor && user?.id) {
    return (
      <DashboardLayout lockDesktopViewport>
        <Suspense fallback={<DashboardRoleSkeleton />}><CorretorDashboard profileId={user.id} /></Suspense>
      </DashboardLayout>
    );
  }

  if (isImobiliaria && user?.id && user.email) {
    return (
      <DashboardLayout lockDesktopViewport>
        <Suspense fallback={<DashboardRoleSkeleton />}><ImobiliariaDashboard profileId={user.id} email={user.email} /></Suspense>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-4 sm:space-y-8 lg:space-y-10">
        <DashboardEquipeBanner />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
          <CardStats
            title="Consultas Pendentes"
            value={loadingConsultas ? "…" : String(stats?.consultasPendentes ?? 0)}
            icon={Search}
          />
          <CardStats
            title="Apólices Ativas"
            value={loadingConsultas ? "…" : String(stats?.apolicesAtivas ?? 0)}
            icon={FileText}
          />
          <CardStats
            title="Inquilinos sob Gestão"
            value={loadingConsultas ? "…" : String(stats?.inquilinosGestao ?? 0)}
            icon={Users}
          />
          <CardStats
            title="Comissões Acumuladas"
            value={loadingConsultas ? "…" : formatarBRL(stats?.comissoesAcumuladas ?? 0)}
            icon={DollarSign}
            isCurrency
          />
        </div>
      </div>
    </DashboardLayout>
  );
}

function CardStats({
  title,
  value,
  icon: Icon,
  trend,
  trendUp,
}: {
  title: string;
  value: string;
  icon: any;
  trend?: string;
  trendUp?: boolean;
  isCurrency?: boolean;
}) {
  return (
    <div className="p-3 sm:p-5 lg:p-8 bg-white border border-neutral-200 rounded-xl hover:shadow-lg hover:border-neutral-300 transition-all group relative overflow-hidden">
      <div className="flex items-start justify-between mb-3 sm:mb-6 lg:mb-8 gap-2">
        <div className="p-2 sm:p-3 bg-neutral-50 rounded-lg border border-neutral-100 group-hover:bg-neutral-900 group-hover:text-white transition-all shrink-0">
          <Icon className="w-4 h-4 sm:w-5 sm:h-5 lg:w-[22px] lg:h-[22px]" strokeWidth={1.5} />
        </div>
        {trend && (
          <div
            className={`flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-full text-[9px] sm:text-[10px] font-bold whitespace-nowrap ${trendUp ? "bg-green-50 text-green-700 border border-green-100" : "bg-neutral-50 text-neutral-500 border border-neutral-100"}`}
          >
            <TrendingUp size={10} className="sm:w-3 sm:h-3" />
            {trend}
          </div>
        )}
      </div>
      <p className="text-[10px] sm:text-xs text-neutral-400 font-bold uppercase tracking-wider sm:tracking-widest mb-1 truncate">
        {title}
      </p>
      <h3 className="text-lg sm:text-2xl lg:text-3xl font-bold text-neutral-900 tracking-tight tabular-nums">
        {value}
      </h3>
    </div>
  );
}
