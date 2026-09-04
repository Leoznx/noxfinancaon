import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, Crown, Medal, RefreshCw, Sparkles, Trophy, Users } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { defaultAvatarForName } from "@/lib/gender-avatar";
import { getSellerContext, type SellerType } from "@/lib/vendedor-portal";

export const Route = createFileRoute("/vendedor/ranking")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin", "financeiro"]} moduleKey="ranking">
      <Ranking />
    </ProtectedRoute>
  ),
});

type RankingRow = {
  id: string;
  name: string;
  avatarUrl: string | null;
  registrations: number;
  position: number;
};

type Period = { month: number; year: number };
const now = new Date();
const CURRENT_PERIOD: Period = { month: now.getMonth() + 1, year: now.getFullYear() };

function Ranking() {
  const [rows, setRows] = useState<RankingRow[]>([]);
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [sellerType, setSellerType] = useState<SellerType>("sdr");
  const [period, setPeriod] = useState<Period>(CURRENT_PERIOD);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [context, response] = await Promise.all([
        getSellerContext(),
        (supabase as any).rpc("ranking_vendedores", { p_month: period.month, p_year: period.year }),
      ]);
      if (response.error) throw response.error;
      setSellerId(context.sellerId);
      setSellerType(context.sellerType ?? "sdr");
      setRows(
        ((response.data as Record<string, unknown>[] | null) ?? [])
          .map((row) => ({
            id: String(row.vendedor_id),
            name: String(row.nome || "Vendedor"),
            avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
            registrations: Number(row.contratos_fechados ?? 0),
            position: Number(row.posicao ?? 0),
          }))
          .sort((a, b) => a.position - b.position),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar o ranking.");
    } finally {
      setLoading(false);
    }
  }, [period.month, period.year]);

  useEffect(() => void load(), [load]);

  const total = useMemo(() => rows.reduce((sum, row) => sum + row.registrations, 0), [rows]);
  const podium = rows.slice(0, 3);
  const remaining = rows.slice(3);
  const isCurrent = period.month === CURRENT_PERIOD.month && period.year === CURRENT_PERIOD.year;
  const periodLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" })
    .format(new Date(period.year, period.month - 1, 1))
    .replace(/^./, (letter) => letter.toUpperCase());
  const teamLabel = sellerType === "closer" ? "Closers" : "SDRs";

  function changeMonth(offset: number) {
    const next = new Date(period.year, period.month - 1 + offset, 1);
    const nextPeriod = { month: next.getMonth() + 1, year: next.getFullYear() };
    const isFuture = nextPeriod.year > CURRENT_PERIOD.year ||
      (nextPeriod.year === CURRENT_PERIOD.year && nextPeriod.month > CURRENT_PERIOD.month);
    if (!isFuture) setPeriod(nextPeriod);
  }

  return (
    <DashboardLayout lockDesktopViewport>
      <main className="flex min-h-0 flex-col gap-3 text-neutral-950 xl:h-full">
        <section className="relative shrink-0 overflow-hidden rounded-[22px] border border-yellow-300 bg-[radial-gradient(circle_at_92%_8%,rgba(250,204,21,0.28),transparent_26%),linear-gradient(115deg,#fff_0%,#fffef7_62%,#fff2a8_100%)] px-4 py-4 shadow-sm sm:px-6">
          <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-yellow-400 bg-yellow-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.2em] text-yellow-700">
                <Sparkles className="h-3 w-3" /> Ranking {sellerType.toUpperCase()}
              </span>
              <h1 className="mt-2 text-2xl font-black tracking-[-0.045em] sm:text-3xl">
                Cadastros dos <span className="text-yellow-500">{teamLabel}</span>
              </h1>
              <p className="mt-1 text-xs font-medium text-neutral-600 sm:text-sm">
                Cada perfil visualiza apenas colegas da mesma função. O ranking considera cadastros realizados no mês.
              </p>
            </div>
            <div className="flex h-12 w-full items-center justify-between rounded-2xl border border-yellow-300 bg-white/90 px-1.5 shadow-sm sm:w-[320px]">
              <button type="button" onClick={() => changeMonth(-1)} className="grid h-9 w-9 place-items-center rounded-xl hover:bg-yellow-50" aria-label="Mês anterior"><ChevronLeft className="h-5 w-5" /></button>
              <div className="min-w-0 px-2 text-center"><p className="truncate text-sm font-black">{periodLabel}</p><p className="text-[9px] font-bold uppercase tracking-[0.16em] text-yellow-600">{isCurrent ? "Mês atual" : "Histórico mensal"}</p></div>
              <button type="button" onClick={() => changeMonth(1)} disabled={isCurrent} className="grid h-9 w-9 place-items-center rounded-xl hover:bg-yellow-50 disabled:opacity-25" aria-label="Mês seguinte"><ChevronRight className="h-5 w-5" /></button>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-between rounded-2xl border border-yellow-300 bg-yellow-50 px-4 py-3">
          <div><p className="text-[10px] font-black uppercase tracking-wider text-yellow-700">Produção da equipe</p><p className="text-sm font-semibold text-neutral-600">Cadastros realizados no período</p></div>
          <strong className="text-3xl font-black text-yellow-600">{total}</strong>
        </section>

        {error ? <EmptyState title="Não foi possível carregar o ranking" description={error} error /> : loading ? <RankingSkeleton /> : rows.length === 0 ? (
          <EmptyState title="Ainda não há cadastros neste período" description={`Os cadastros da equipe de ${teamLabel} aparecerão aqui.`} />
        ) : (
          <div className="min-h-0 flex-1 overflow-visible xl:overflow-y-auto">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div><h2 className="flex items-center gap-2 text-base font-black"><Trophy className="h-5 w-5 text-yellow-500" /> Pódio de cadastros</h2><p className="text-xs text-neutral-500">Reconhecimento por volume de novos parceiros cadastrados.</p></div>
              <Button variant="outline" onClick={load} disabled={loading} className="rounded-xl border-yellow-300"><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button>
            </div>
            <section className="grid gap-3 md:grid-cols-3">
              {podium.map((row) => <PodiumCard key={row.id} row={row} current={row.id === sellerId} />)}
            </section>
            {remaining.length > 0 && <section className="mt-4 grid gap-2 md:grid-cols-2">{remaining.map((row) => <ListRow key={row.id} row={row} current={row.id === sellerId} />)}</section>}
          </div>
        )}
      </main>
    </DashboardLayout>
  );
}

const PODIUM = {
  1: { icon: Crown, border: "border-yellow-400", background: "bg-yellow-50", text: "text-yellow-600" },
  2: { icon: Medal, border: "border-slate-300", background: "bg-slate-50", text: "text-slate-600" },
  3: { icon: Medal, border: "border-orange-300", background: "bg-orange-50", text: "text-orange-700" },
} as const;

function PodiumCard({ row, current }: { row: RankingRow; current: boolean }) {
  const style = PODIUM[row.position as keyof typeof PODIUM] ?? PODIUM[3];
  const Icon = style.icon;
  return (
    <article className={`relative flex min-h-56 flex-col items-center rounded-[20px] border p-4 text-center shadow-sm ${style.border} ${style.background}`}>
      <span className={`flex items-center gap-1 text-[9px] font-black uppercase tracking-widest ${style.text}`}><Icon className="h-4 w-4" />{row.position}º lugar</span>
      <Avatar className={`mt-3 h-16 w-16 border-2 ${style.border}`}><AvatarImage src={row.avatarUrl || defaultAvatarForName(row.name)} alt={`Foto de ${row.name}`} /><AvatarFallback>{initials(row.name)}</AvatarFallback></Avatar>
      <h3 className="mt-3 max-w-full truncate text-base font-black">{row.name}</h3>
      {current && <Badge className="mt-1 bg-yellow-400 text-neutral-950">Você</Badge>}
      <strong className={`mt-auto text-4xl font-black ${style.text}`}>{row.registrations}</strong>
      <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-neutral-500">cadastros realizados</span>
    </article>
  );
}

function ListRow({ row, current }: { row: RankingRow; current: boolean }) {
  return (
    <article className={`grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border px-3 py-2.5 ${current ? "border-yellow-400 bg-yellow-50" : "border-neutral-200 bg-white"}`}>
      <span className="grid h-9 w-9 place-items-center rounded-full bg-neutral-100 text-xs font-black">{row.position}º</span>
      <Avatar className="h-9 w-9"><AvatarImage src={row.avatarUrl || defaultAvatarForName(row.name)} /><AvatarFallback>{initials(row.name)}</AvatarFallback></Avatar>
      <div className="min-w-0"><p className="truncate text-sm font-black">{row.name}</p><p className="text-[10px] text-neutral-500">{current ? "Seu desempenho neste mês" : "Cadastro de novos parceiros"}</p></div>
      <div className="text-right"><strong className="text-xl font-black text-yellow-600">{row.registrations}</strong><p className="text-[8px] font-bold uppercase text-neutral-400">cadastros</p></div>
    </article>
  );
}

function RankingSkeleton() {
  return <div className="grid animate-pulse gap-3 md:grid-cols-3">{[1, 2, 3].map((item) => <div key={item} className="h-56 rounded-[20px] bg-neutral-100" />)}</div>;
}

function EmptyState({ title, description, error = false }: { title: string; description: string; error?: boolean }) {
  return <div className={`rounded-[22px] border p-8 text-center ${error ? "border-red-200 bg-red-50" : "border-dashed border-neutral-300 bg-neutral-50"}`}>{error ? <AlertCircle className="mx-auto mb-3 h-6 w-6 text-red-500" /> : <Users className="mx-auto mb-3 h-6 w-6 text-yellow-600" />}<p className="font-black">{title}</p><p className="mt-1 text-sm text-neutral-500">{description}</p></div>;
}

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "V";
}
