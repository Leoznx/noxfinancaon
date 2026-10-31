import { createFileRoute } from "@tanstack/react-router";
import { Sparkles, Target, TrendingUp } from "lucide-react";

import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Badge } from "@/components/ui/badge";
import { AdminTeamGoals } from "./admin.equipe-nox";

export const Route = createFileRoute("/admin/metas")({
  component: () => (
    <ProtectedRoute roles={["admin", "admin_master", "analista"]} moduleKey="metas">
      <AdminGoalsPage />
    </ProtectedRoute>
  ),
});

function AdminGoalsPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <section className="relative overflow-hidden rounded-[2rem] bg-neutral-950 px-6 py-7 text-white shadow-xl shadow-neutral-950/10 sm:px-8 sm:py-9">
          <div className="pointer-events-none absolute -right-12 -top-24 h-72 w-72 rounded-full bg-yellow-400/20 blur-3xl" />
          <div className="relative flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-2xl">
              <Badge className="border-yellow-400/20 bg-yellow-400 text-neutral-950 hover:bg-yellow-400">
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Gestão inteligente
              </Badge>
              <h1 className="mt-4 flex items-center gap-3 text-3xl font-black tracking-tight sm:text-4xl">
                <Target className="h-8 w-8 text-yellow-400" /> Metas
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-neutral-300 sm:text-base">
                Configure objetivos, acompanhe cada vendedor e deixe a evolução mensal acontecer
                automaticamente, sem perder a possibilidade de ajustes manuais.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4 text-sm">
              <TrendingUp className="mb-2 h-6 w-6 text-emerald-400" />
              <p className="font-black">Evolução automática mensal</p>
              <p className="mt-1 text-xs text-neutral-400">
                Competência anterior +2 em todas as metas
              </p>
            </div>
          </div>
        </section>
        <AdminTeamGoals />
      </div>
    </DashboardLayout>
  );
}
