import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Award, CalendarDays, CheckCircle2, RefreshCw, Target, Trophy, Users } from "lucide-react";
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

export const Route = createFileRoute("/vendedor/metas")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin"]} moduleKey="metas">
      <Goals />
    </ProtectedRoute>
  ),
});

type RankingRow = { id: string; name: string; avatarUrl: string | null; registrations: number; position: number };
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function Goals() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const [progress, setProgress] = useState<SellerMonthlyProgress | null>(null);
  const [ranking, setRanking] = useState<RankingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [progressData, response] = await Promise.all([
        fetchMySellerMonthlyProgress(month, year),
        (supabase as any).rpc("ranking_vendedores", { p_month: month, p_year: year }),
      ]);
      if (response.error) throw response.error;
      setProgress(progressData);
      setRanking(((response.data as Record<string, unknown>[] | null) ?? []).map((row) => ({
        id: String(row.vendedor_id),
        name: String(row.nome || "Vendedor"),
        avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
        registrations: Number(row.contratos_fechados ?? 0),
        position: Number(row.posicao ?? 0),
      })).sort((a, b) => a.position - b.position));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar sua meta.");
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => {
    void load();
    const channel = supabase.channel("seller-registration-goal")
      .on("postgres_changes", { event: "*", schema: "public", table: "seller_goals" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "seller_client_partnerships" }, () => void load())
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [load]);

  const percentage = progress ? sellerGoalPercentage(progress.clients_registered, progress.target_clients) : 0;
  const remaining = progress?.target_clients == null ? null : Math.max(0, progress.target_clients - progress.clients_registered);
  const position = ranking.find((row) => row.id === progress?.seller_id)?.position;
  const teamTotal = useMemo(() => ranking.reduce((sum, row) => sum + row.registrations, 0), [ranking]);

  return (
    <DashboardLayout lockDesktopViewport>
      <main className="flex min-h-0 flex-col gap-3 text-neutral-950 xl:h-full">
        <section className="relative overflow-hidden rounded-[22px] border border-yellow-300 bg-[radial-gradient(circle_at_92%_20%,rgba(250,204,21,0.25),transparent_24%),linear-gradient(115deg,#fff_0%,#fffef8_60%,#fff4b3_100%)] px-4 py-4 shadow-sm sm:px-6">
          <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><span className="inline-flex items-center gap-2 rounded-full border border-yellow-400 bg-white/80 px-3 py-1 text-[9px] font-black uppercase tracking-[0.18em] text-yellow-700"><CalendarDays className="h-3 w-3" />{MONTHS[month - 1]} de {year}</span><h1 className="mt-2 text-2xl font-black sm:text-3xl">Minha meta de <span className="text-yellow-500">cadastros</span></h1><p className="mt-1 text-xs font-medium text-neutral-600 sm:text-sm">Sua prioridade comercial é cadastrar novas imobiliárias e corretores parceiros.</p></div>
            <div className="flex items-center gap-2">{position && <Badge className="border border-yellow-300 bg-white px-3 py-2 text-neutral-950">{position}º no ranking</Badge>}<Button variant="outline" size="icon" className="rounded-xl border-yellow-300" onClick={load} disabled={loading} aria-label="Atualizar meta"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></Button></div>
          </div>
        </section>

        {error ? <State title="Não foi possível carregar sua meta" description={error} error /> : loading ? <div className="h-64 animate-pulse rounded-[22px] bg-neutral-100" /> : progress ? (
          <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1.2fr_0.8fr]">
            <Card className="overflow-hidden border-yellow-300 shadow-sm">
              <CardHeader className="border-b border-yellow-100 bg-yellow-50"><CardTitle className="flex items-center gap-2 text-base"><Target className="h-5 w-5 text-yellow-600" /> Cadastros realizados no mês</CardTitle></CardHeader>
              <CardContent className="flex h-full min-h-64 flex-col justify-center p-5 sm:p-8">
                {progress.target_clients == null ? <State title="Meta ainda não definida" description="O administrador precisa definir sua meta individual de cadastros deste mês." /> : <>
                  <div className="flex items-end justify-between gap-4"><div><strong className="text-5xl font-black text-neutral-950">{progress.clients_registered}</strong><span className="ml-2 text-lg font-bold text-neutral-400">/ {progress.target_clients}</span><p className="mt-1 text-sm font-semibold text-neutral-500">novos parceiros cadastrados</p></div><strong className="text-3xl font-black text-yellow-600">{percentage}%</strong></div>
                  <div className="mt-6 h-4 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-gradient-to-r from-yellow-500 to-yellow-300 transition-all" style={{ width: `${percentage}%` }} /></div>
                  <div className="mt-5 flex items-center gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">{remaining === 0 ? <CheckCircle2 className="h-7 w-7 text-emerald-600" /> : <Target className="h-7 w-7 text-yellow-600" />}<div><p className="font-black">{remaining === 0 ? "Meta concluída!" : `Faltam ${remaining} cadastro${remaining === 1 ? "" : "s"}`}</p><p className="text-xs text-neutral-500">Cada novo cadastro válido entra automaticamente nesta contagem.</p></div></div>
                </>}
              </CardContent>
            </Card>

            <Card className="min-h-0 overflow-hidden border-neutral-200 shadow-sm">
              <CardHeader className="border-b border-neutral-100"><CardTitle className="flex items-center justify-between gap-2 text-base"><span className="flex items-center gap-2"><Award className="h-5 w-5 text-yellow-600" /> Sua equipe</span><Badge variant="outline">{teamTotal} cadastros</Badge></CardTitle></CardHeader>
              <CardContent className="max-h-[460px] overflow-y-auto p-0">{ranking.length === 0 ? <div className="p-4"><State title="Sem resultados ainda" description="O ranking aparecerá após o primeiro cadastro." /></div> : <ol className="divide-y divide-neutral-100">{ranking.map((row) => <TeamRow key={row.id} row={row} current={row.id === progress.seller_id} />)}</ol>}</CardContent>
            </Card>
          </div>
        ) : null}
      </main>
    </DashboardLayout>
  );
}

function TeamRow({ row, current }: { row: RankingRow; current: boolean }) {
  return <li className={`grid grid-cols-[28px_auto_minmax(0,1fr)_auto] items-center gap-2.5 px-4 py-3 ${current ? "bg-yellow-50" : "bg-white"}`}><span className="text-right text-sm font-black text-neutral-400">{row.position}.</span><Avatar className="h-9 w-9"><AvatarImage src={row.avatarUrl || defaultAvatarForName(row.name)} /><AvatarFallback>{row.name.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar><div className="min-w-0"><p className="truncate text-xs font-black">{row.name}{current && <span className="ml-2 text-[8px] uppercase text-yellow-600">Você</span>}</p><p className="text-[9px] text-neutral-400">cadastros realizados</p></div><strong className="text-lg font-black text-yellow-600">{row.registrations}</strong></li>;
}

function State({ title, description, error = false }: { title: string; description: string; error?: boolean }) {
  return <div className={`rounded-2xl border p-6 text-center ${error ? "border-red-200 bg-red-50" : "border-dashed border-neutral-300 bg-neutral-50"}`}>{error ? <AlertCircle className="mx-auto mb-2 h-5 w-5 text-red-500" /> : <Trophy className="mx-auto mb-2 h-5 w-5 text-yellow-500" />}<p className="font-black">{title}</p><p className="mt-1 text-xs text-neutral-500">{description}</p></div>;
}
