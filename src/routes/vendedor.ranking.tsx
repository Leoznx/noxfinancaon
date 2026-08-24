import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Crown,
  Headphones,
  Medal,
  RefreshCw,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { defaultAvatarForName } from "@/lib/gender-avatar";
import { formatMoney, getSellerContext } from "@/lib/vendedor-portal";

export const Route = createFileRoute("/vendedor/ranking")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin", "financeiro"]} moduleKey="ranking">
      <Ranking />
    </ProtectedRoute>
  ),
});

type LinhaRanking = {
  id: string;
  nome: string;
  avatarUrl: string | null;
  contratosFechados: number;
  totalLeads: number;
  emAtendimento: number;
  comissoes: number;
  taxaConversao: number;
  posicao: number;
};

type Periodo = { month: number; year: number };

const agora = new Date();
const PERIODO_ATUAL: Periodo = { month: agora.getMonth() + 1, year: agora.getFullYear() };

function Ranking() {
  const [linhas, setLinhas] = useState<LinhaRanking[]>([]);
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState<Periodo>(PERIODO_ATUAL);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro("");

    try {
      const [context, rankingResponse] = await Promise.all([
        getSellerContext(),
        (supabase as any).rpc("ranking_vendedores", {
          p_month: periodo.month,
          p_year: periodo.year,
        }),
      ]);
      if (rankingResponse.error) throw rankingResponse.error;

      setSellerId(context.sellerId);
      setLinhas(
        ((rankingResponse.data as any[]) ?? [])
          .map((linha): LinhaRanking => {
            const totalLeads = Number(linha.total_leads ?? 0);
            const contratosFechados = Number(linha.contratos_fechados ?? 0);
            return {
              id: String(linha.vendedor_id),
              nome: String(linha.nome || "Vendedor"),
              avatarUrl: linha.avatar_url ? String(linha.avatar_url) : null,
              contratosFechados,
              totalLeads,
              emAtendimento: Number(linha.em_atendimento ?? 0),
              comissoes: Number(linha.comissoes ?? 0),
              taxaConversao: totalLeads > 0 ? (contratosFechados / totalLeads) * 100 : 0,
              posicao: Number(linha.posicao ?? 0),
            };
          })
          .sort((a, b) => a.posicao - b.posicao),
      );
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível carregar o ranking.");
    } finally {
      setLoading(false);
    }
  }, [periodo.month, periodo.year]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const resumo = useMemo(() => {
    const contratos = linhas.reduce((total, linha) => total + linha.contratosFechados, 0);
    const leads = linhas.reduce((total, linha) => total + linha.totalLeads, 0);
    const atendimento = linhas.reduce((total, linha) => total + linha.emAtendimento, 0);
    return {
      contratos,
      leads,
      atendimento,
      conversao: leads > 0 ? (contratos / leads) * 100 : 0,
    };
  }, [linhas]);

  const podio = linhas.slice(0, 3);
  const restante = linhas.slice(3);
  const periodoAtual = periodo.month === PERIODO_ATUAL.month && periodo.year === PERIODO_ATUAL.year;
  const periodoLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" })
    .format(new Date(periodo.year, periodo.month - 1, 1))
    .replace(/^./, (letra) => letra.toUpperCase());

  function mudarMes(diferenca: number) {
    const proximo = new Date(periodo.year, periodo.month - 1 + diferenca, 1);
    const proximoPeriodo = { month: proximo.getMonth() + 1, year: proximo.getFullYear() };
    const estaNoFuturo =
      proximoPeriodo.year > PERIODO_ATUAL.year ||
      (proximoPeriodo.year === PERIODO_ATUAL.year && proximoPeriodo.month > PERIODO_ATUAL.month);
    if (!estaNoFuturo) setPeriodo(proximoPeriodo);
  }

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-[1500px] overflow-hidden rounded-[28px] border border-neutral-800 bg-[#0b0b0b] text-white shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
        <section className="relative overflow-hidden border-b border-yellow-400/15 bg-[radial-gradient(circle_at_90%_10%,rgba(250,204,21,0.18),transparent_28%),linear-gradient(115deg,#111_0%,#111_56%,#251d08_100%)] px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
          <div className="pointer-events-none absolute -right-10 -top-28 h-72 w-72 rounded-full border-[30px] border-yellow-400/[0.06]" />
          <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-yellow-400/40 bg-yellow-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-yellow-300">
                <Sparkles className="h-3.5 w-3.5" />
                Ranking ao vivo
              </span>
              <h1 className="mt-4 text-3xl font-black tracking-[-0.045em] sm:text-4xl">
                Ranking da <span className="text-yellow-400">Equipe</span>
              </h1>
              <p className="mt-2 max-w-2xl text-sm font-medium text-neutral-400">
                Acompanhe contratos, leads e conversão e celebre os melhores resultados do mês.
              </p>
            </div>

            <div className="flex h-14 w-full items-center justify-between rounded-2xl border border-white/10 bg-black/35 px-2 shadow-inner backdrop-blur-sm sm:w-[370px]">
              <button
                type="button"
                onClick={() => mudarMes(-1)}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-neutral-400 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400"
                aria-label="Ver mês anterior"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div className="min-w-0 px-2 text-center">
                <p className="truncate text-sm font-black text-white">{periodoLabel}</p>
                <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-yellow-400">
                  {periodoAtual ? "Mês atual" : "Histórico mensal"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => mudarMes(1)}
                disabled={periodoAtual}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-neutral-400 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 disabled:cursor-not-allowed disabled:opacity-25"
                aria-label="Ver mês seguinte"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>
        </section>

        <div className="space-y-4 p-3 sm:p-5 lg:p-6">
          <section
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
            aria-label="Resumo do período"
          >
            <MetricCard
              icon={Trophy}
              label="Contratos fechados"
              value={resumo.contratos}
              detail="Produção da equipe no mês"
              active
            />
            <MetricCard
              icon={Users}
              label="Leads trabalhados"
              value={resumo.leads}
              detail="Novos leads no período"
            />
            <MetricCard
              icon={Headphones}
              label="Em atendimento"
              value={resumo.atendimento}
              detail="Oportunidades em andamento"
            />
            <MetricCard
              icon={BarChart3}
              label="Conversão da equipe"
              value={`${resumo.conversao.toFixed(0)}%`}
              detail="Contratos por lead no mês"
            />
          </section>

          {erro && <Estado titulo="Não foi possível carregar o ranking" descricao={erro} erro />}

          {loading ? (
            <RankingSkeleton />
          ) : !erro && linhas.length === 0 ? (
            <Estado
              titulo="Nenhum vendedor ativo encontrado"
              descricao="Quando houver produção da equipe, o ranking aparecerá aqui."
            />
          ) : !erro ? (
            <>
              <section className="relative overflow-hidden rounded-[24px] border border-white/10 bg-[radial-gradient(circle_at_50%_54%,rgba(250,204,21,0.10),transparent_28%),#101010] p-4 sm:p-6 lg:p-8">
                <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:radial-gradient(circle,rgba(250,204,21,0.35)_1px,transparent_1px)] [background-size:110px_80px]" />
                <div className="relative mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="flex items-center gap-2 text-lg font-black">
                      <Trophy className="h-5 w-5 text-yellow-400" />
                      Pódio de contratos
                    </h2>
                    <p className="mt-1 text-xs font-medium text-neutral-500">
                      {resumo.contratos} contratos fechados pela equipe neste período.
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={carregar}
                    disabled={loading}
                    className="w-fit gap-2 rounded-xl text-xs font-bold text-yellow-400 hover:bg-yellow-400/10 hover:text-yellow-300"
                  >
                    <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                    Atualizar ranking
                  </Button>
                </div>

                <div className="relative grid items-end gap-4 lg:grid-cols-3">
                  {podio.map((linha) => (
                    <PodioCard key={linha.id} linha={linha} destaque={linha.id === sellerId} />
                  ))}
                </div>
              </section>

              {restante.length > 0 && (
                <section className="overflow-hidden rounded-[24px] border border-white/10 bg-[#111]">
                  <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 sm:px-6">
                    <div>
                      <h2 className="text-sm font-black text-white">Classificação completa</h2>
                      <p className="mt-0.5 text-[11px] text-neutral-500">
                        Demais posições da equipe comercial
                      </p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-bold text-neutral-400">
                      {linhas.length} vendedores
                    </span>
                  </div>
                  <div className="divide-y divide-white/[0.07]">
                    {restante.map((linha) => (
                      <LinhaLista key={linha.id} linha={linha} destaque={linha.id === sellerId} />
                    ))}
                  </div>
                </section>
              )}
            </>
          ) : null}
        </div>
      </div>
    </DashboardLayout>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  active = false,
}: {
  icon: typeof Trophy;
  label: string;
  value: string | number;
  detail: string;
  active?: boolean;
}) {
  return (
    <article
      className={`flex min-h-20 items-center gap-3 rounded-2xl border p-3.5 transition ${active ? "border-yellow-400/70 bg-yellow-400/[0.09]" : "border-white/10 bg-white/[0.025]"}`}
    >
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${active ? "border-yellow-400/50 bg-yellow-400/15 text-yellow-400" : "border-white/10 bg-black/30 text-neutral-400"}`}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-xs font-bold text-neutral-200">{label}</p>
          <b className={`text-xl ${active ? "text-yellow-400" : "text-white"}`}>{value}</b>
        </div>
        <p className="mt-0.5 truncate text-[10px] font-medium text-neutral-600">{detail}</p>
      </div>
    </article>
  );
}

const PODIO_STYLE = {
  1: {
    order: "order-1 lg:order-2",
    card: "min-h-[330px] border-yellow-400/80 bg-[linear-gradient(150deg,rgba(250,204,21,0.16),rgba(18,18,18,0.96)_48%)] shadow-[0_0_50px_rgba(250,204,21,0.12)]",
    avatar: "h-24 w-24 border-yellow-400 shadow-[0_0_28px_rgba(250,204,21,0.25)]",
    accent: "text-yellow-400",
    icon: Crown,
    label: "1º lugar",
  },
  2: {
    order: "order-2 lg:order-1",
    card: "min-h-[292px] border-slate-300/40 bg-[linear-gradient(150deg,rgba(203,213,225,0.11),rgba(18,18,18,0.96)_48%)]",
    avatar: "h-20 w-20 border-slate-300",
    accent: "text-slate-300",
    icon: Medal,
    label: "2º lugar",
  },
  3: {
    order: "order-3 lg:order-3",
    card: "min-h-[292px] border-orange-500/45 bg-[linear-gradient(150deg,rgba(194,65,12,0.12),rgba(18,18,18,0.96)_48%)]",
    avatar: "h-20 w-20 border-orange-500",
    accent: "text-orange-400",
    icon: Medal,
    label: "3º lugar",
  },
} as const;

function PodioCard({ linha, destaque }: { linha: LinhaRanking; destaque: boolean }) {
  const estilo = PODIO_STYLE[linha.posicao as keyof typeof PODIO_STYLE] ?? PODIO_STYLE[3];
  const Icone = estilo.icon;
  return (
    <article
      className={`${estilo.order} flex flex-col items-center rounded-[24px] border p-5 text-center ${estilo.card}`}
    >
      <div
        className={`mb-4 flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.2em] ${estilo.accent}`}
      >
        <Icone className="h-4 w-4" />
        {estilo.label}
      </div>
      <SellerAvatar linha={linha} className={`${estilo.avatar} border-2`} />
      <div className="mt-4 flex min-h-12 flex-col items-center justify-center">
        <h3 className="max-w-full truncate text-lg font-black text-white">{linha.nome}</h3>
        {destaque && (
          <Badge className="mt-1 border-yellow-400/30 bg-yellow-400/10 text-[9px] font-black uppercase tracking-widest text-yellow-300">
            Você
          </Badge>
        )}
      </div>
      <strong className={`mt-3 text-4xl font-black tracking-tight ${estilo.accent}`}>
        {linha.contratosFechados}
      </strong>
      <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-neutral-500">
        contratos fechados
      </span>
      <div className="mt-5 grid w-full grid-cols-3 divide-x divide-white/10 rounded-xl border border-white/10 bg-black/25 py-2.5">
        <PodioStat value={linha.totalLeads} label="leads" />
        <PodioStat value={linha.emAtendimento} label="atendimento" />
        <PodioStat value={`${linha.taxaConversao.toFixed(0)}%`} label="conversão" />
      </div>
      <p className="mt-3 text-[10px] font-semibold text-neutral-500">
        {formatMoney(linha.comissoes)} em comissões no mês
      </p>
    </article>
  );
}

function PodioStat({ value, label }: { value: string | number; label: string }) {
  return (
    <span className="px-1">
      <b className="block text-xs text-white">{value}</b>
      <span className="mt-0.5 block truncate text-[8px] uppercase tracking-wide text-neutral-600">
        {label}
      </span>
    </span>
  );
}

function SellerAvatar({ linha, className = "" }: { linha: LinhaRanking; className?: string }) {
  return (
    <Avatar className={`bg-neutral-900 ${className}`}>
      <AvatarImage
        src={linha.avatarUrl || defaultAvatarForName(linha.nome)}
        alt={`Foto de ${linha.nome}`}
        className="object-cover"
      />
      <AvatarFallback className="bg-neutral-800 text-sm font-black text-white">
        {iniciais(linha.nome)}
      </AvatarFallback>
    </Avatar>
  );
}

function LinhaLista({ linha, destaque }: { linha: LinhaRanking; destaque: boolean }) {
  return (
    <article
      className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-4 transition sm:gap-5 sm:px-6 ${destaque ? "bg-yellow-400/[0.07]" : "hover:bg-white/[0.025]"}`}
    >
      <span
        className={`flex h-9 w-9 items-center justify-center rounded-full border text-xs font-black ${destaque ? "border-yellow-400/40 bg-yellow-400/10 text-yellow-400" : "border-white/10 bg-white/5 text-neutral-400"}`}
      >
        {linha.posicao}º
      </span>
      <div className="flex min-w-0 items-center gap-3">
        <SellerAvatar linha={linha} className="h-11 w-11 border border-white/10" />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">
            {linha.nome}
            {destaque && (
              <span className="ml-2 text-[9px] uppercase tracking-widest text-yellow-400">
                Você
              </span>
            )}
          </p>
          <p className="mt-1 truncate text-[10px] font-medium text-neutral-500">
            {linha.totalLeads} leads · {linha.emAtendimento} em atendimento ·{" "}
            {linha.taxaConversao.toFixed(0)}% conversão
          </p>
        </div>
      </div>
      <div className="text-right">
        <p className="text-xl font-black text-yellow-400">{linha.contratosFechados}</p>
        <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-neutral-600">
          fechados
        </p>
      </div>
    </article>
  );
}

function RankingSkeleton() {
  return (
    <div className="animate-pulse rounded-[24px] border border-white/10 bg-white/[0.025] p-6">
      <div className="h-6 w-52 rounded bg-white/10" />
      <div className="mt-8 grid items-end gap-4 lg:grid-cols-3">
        <div className="h-[292px] rounded-[24px] bg-white/5" />
        <div className="h-[330px] rounded-[24px] bg-yellow-400/[0.06]" />
        <div className="h-[292px] rounded-[24px] bg-white/5" />
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
      className={`rounded-[24px] border p-10 text-center ${erro ? "border-red-500/30 bg-red-500/10 text-red-200" : "border-dashed border-white/10 bg-white/[0.02] text-neutral-400"}`}
    >
      {erro ? (
        <AlertCircle className="mx-auto mb-3 h-5 w-5 text-red-400" />
      ) : (
        <Users className="mx-auto mb-3 h-5 w-5 text-neutral-600" />
      )}
      <p className="font-bold">{titulo}</p>
      <p className="mt-1 text-sm text-neutral-500">{descricao}</p>
    </div>
  );
}

function iniciais(nome: string) {
  return (
    nome
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((parte) => parte[0])
      .join("")
      .toUpperCase() || "V"
  );
}
