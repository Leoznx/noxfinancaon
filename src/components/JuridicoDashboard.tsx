import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Eye,
  FileText,
  MoreVertical,
  RefreshCw,
  ShieldAlert,
  XCircle,
  type LucideProps,
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  EMPTY_JURIDICO_DASHBOARD,
  fetchJuridicoDashboardData,
  type JuridicoConsulta,
  type JuridicoDashboardData,
} from "@/lib/juridico-dashboard";

type Periodo = "30d" | "3m" | "6m" | "12m";
type Tone = "neutral" | "amber" | "blue" | "green" | "red" | "orange" | "purple";

const PERIODOS: { value: Periodo; label: string }[] = [
  { value: "30d", label: "Últimos 30 dias" },
  { value: "3m", label: "Últimos 3 meses" },
  { value: "6m", label: "Últimos 6 meses" },
  { value: "12m", label: "Últimos 12 meses" },
];

const DOCUMENT_COLORS = {
  aprovado: "#32B86B",
  pendente: "#F3BD00",
  em_analise: "#3478E5",
  recusado: "#EF3E45",
};

const ACTIVE_CONTRACT_STATUSES = new Set(["ativa", "active", "vigente"]);

export function JuridicoDashboard() {
  const [data, setData] = useState<JuridicoDashboardData>(EMPTY_JURIDICO_DASHBOARD);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState<Periodo>("12m");

  const load = useCallback(async () => {
    const result = await fetchJuridicoDashboardData();
    setData(result.data);
    setError(result.error);
    setLoading(false);
  }, []);

  const retry = useCallback(() => {
    setLoading(true);
    setError(null);
    void load();
  }, [load]);

  useEffect(() => {
    void load();

    const interval = window.setInterval(() => void load(), 60_000);
    const channel = supabase
      .channel("juridico-dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "consultas_credito" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "verificacoes_documento" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "apolices" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "sinistros" }, () => void load())
      .subscribe();

    return () => {
      window.clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const originsById = useMemo(() => new Map(data.origens.map((item) => [item.id, item])), [data.origens]);

  const priorities = useMemo(
    () =>
      data.consultas
        .filter((item) => isAwaitingReview(item) || isInReview(item))
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .slice(0, 4),
    [data.consultas],
  );

  const documentStatus = useMemo(() => {
    const counts = { aprovado: 0, pendente: 0, em_analise: 0, recusado: 0 };
    for (const item of data.documentos) {
      const status = normalize(item.verification_status);
      if (status === "aprovado") counts.aprovado += 1;
      else if (status === "recusado" || status === "reprovado") counts.recusado += 1;
      else if (status === "enviado" || status === "em_analise") counts.em_analise += 1;
      else counts.pendente += 1;
    }
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    return {
      total,
      items: [
        { key: "aprovado", label: "Aprovados", value: counts.aprovado, color: DOCUMENT_COLORS.aprovado },
        { key: "pendente", label: "Pendentes", value: counts.pendente, color: DOCUMENT_COLORS.pendente },
        { key: "em_analise", label: "Em análise", value: counts.em_analise, color: DOCUMENT_COLORS.em_analise },
        { key: "recusado", label: "Reprovados", value: counts.recusado, color: DOCUMENT_COLORS.recusado },
      ],
    };
  }, [data.documentos]);

  const expiringContracts = useMemo(() => {
    const today = startOfLocalDay(new Date()).getTime();
    return data.contratos
      .filter((item) => ACTIVE_CONTRACT_STATUSES.has(normalize(item.status)))
      .map((item) => ({ ...item, days: Math.ceil((localDate(item.vigencia_fim).getTime() - today) / 86_400_000) }))
      .filter((item) => item.days >= 0 && item.days <= 90)
      .sort((a, b) => a.days - b.days)
      .slice(0, 4);
  }, [data.contratos]);

  const activities = useMemo(() => buildActivities(data, originsById), [data, originsById]);
  const movement = useMemo(() => buildMovement(data.consultas, periodo), [data.consultas, periodo]);

  if (loading) return <JuridicoDashboardSkeleton />;

  return (
    <div className="relative space-y-3 xl:grid xl:h-full xl:min-h-0 xl:grid-rows-[174px_minmax(0,1fr)] xl:gap-3 xl:overflow-hidden xl:space-y-0">
      {error ? (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 xl:absolute xl:right-2 xl:top-2 xl:z-30 xl:w-[430px] xl:shadow-lg">
          <ShieldAlert className="mt-0.5 shrink-0" size={18} />
          <div className="min-w-0 flex-1">
            <p className="font-bold">Não foi possível atualizar todos os dados.</p>
            <p className="mt-0.5 text-xs text-red-700">Os dados disponíveis continuam visíveis. Tente novamente em instantes.</p>
          </div>
          <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2 text-xs" onClick={retry}>
            <RefreshCw size={13} /> Atualizar
          </Button>
        </div>
      ) : null}

      <section className="relative min-h-[150px] overflow-hidden rounded-2xl border border-yellow-300/80 bg-gradient-to-r from-yellow-50 via-white to-amber-50/70 px-5 py-5 sm:px-7 xl:h-full xl:min-h-0 xl:py-3">
        <div className="absolute -left-10 -top-16 h-52 w-52 rounded-full bg-yellow-300/20 blur-2xl" />
        <div className="relative flex h-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3 xl:h-full">
            <img
              src="/dashboard/juridico-protecao.png"
              alt="Proteção e segurança jurídica"
              className="hidden h-[104px] w-[300px] shrink-0 object-contain object-left sm:block xl:h-[148px] xl:w-[420px]"
            />
            <div className="min-w-0">
              <h2 className="text-base font-extrabold leading-tight text-neutral-950 sm:text-lg xl:text-xl">Proteção jurídica com controle e agilidade.</h2>
              <p className="mt-1.5 text-xs leading-4 text-neutral-600 sm:text-sm">Centralize análises, acompanhe prazos e decida com mais segurança.</p>
            </div>
          </div>
          <Button asChild variant="outline" className="h-9 w-full shrink-0 gap-2 border-yellow-300 bg-white px-4 text-xs font-bold shadow-sm hover:bg-yellow-50 sm:w-auto">
            <Link to="/admin/aprovacoes">
              <RefreshCw size={14} /> Ver fluxo jurídico
            </Link>
          </Button>
        </div>
      </section>

      <section className="grid min-h-0 gap-3 xl:h-full xl:grid-cols-12 xl:grid-rows-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
        <div className="flex min-h-[300px] flex-col rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm xl:col-span-6 xl:col-start-1 xl:row-start-1 xl:h-full xl:min-h-0 xl:overflow-hidden">
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-extrabold text-neutral-950">Movimentação jurídica</h2>
              <div className="mt-1 flex items-center gap-4 text-[10px] font-semibold text-neutral-500">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-yellow-400" /> Entradas</span>
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-neutral-950" /> Concluídas</span>
              </div>
            </div>
            <select
              value={periodo}
              onChange={(event) => setPeriodo(event.target.value as Periodo)}
              className="h-8 rounded-lg border border-neutral-200 bg-white px-2.5 text-[11px] font-bold text-neutral-700 outline-none focus:border-yellow-400"
              aria-label="Período do gráfico"
            >
              {PERIODOS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </div>
          <div className="mt-2 h-[240px] min-h-0 w-full xl:h-auto xl:flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={movement} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
                <CartesianGrid stroke="#ECECEC" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#777" }} tickLine={false} axisLine={false} minTickGap={18} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#888" }} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: "#FFF9DC" }}
                  contentStyle={{ borderRadius: 12, borderColor: "#E5E5E5", fontSize: 12, boxShadow: "0 8px 24px rgba(0,0,0,.08)" }}
                />
                <Bar dataKey="entradas" name="Entradas" fill="#FFD000" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Line dataKey="concluidas" name="Concluídas" type="monotone" stroke="#111111" strokeWidth={2} dot={{ r: 2.5, fill: "#111111" }} activeDot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="flex min-h-[300px] flex-col rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm xl:col-span-3 xl:col-start-7 xl:row-start-1 xl:h-full xl:min-h-0 xl:overflow-hidden">
          <h2 className="text-sm font-extrabold text-neutral-950">Documentos por status</h2>
          {documentStatus.total ? (
            <>
              <div className="relative mx-auto mt-1.5 h-[132px] w-full max-w-[190px] shrink-0 xl:h-[118px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={documentStatus.items} dataKey="value" nameKey="label" innerRadius={40} outerRadius={57} paddingAngle={1} stroke="none">
                      {documentStatus.items.map((item) => <Cell key={item.key} fill={item.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 12, borderColor: "#E5E5E5", fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[10px] font-semibold text-neutral-500">Total</span>
                  <strong className="text-xl font-black text-neutral-950">{documentStatus.total}</strong>
                  <span className="text-[10px] text-neutral-500">documentos</span>
                </div>
              </div>
              <div className="space-y-1.5">
                {documentStatus.items.map((item) => (
                  <div key={item.key} className="flex items-center gap-2 text-xs">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="flex-1 text-neutral-600">{item.label}</span>
                    <strong className="text-neutral-900">{item.value}</strong>
                    <span className="w-9 text-right text-neutral-400">{percentage(item.value, documentStatus.total)}%</span>
                  </div>
                ))}
              </div>
            </>
          ) : <EmptyState />}
          <CardFooterLink to="/admin/verificacoes" label="Ver relatório completo" />
        </div>

        <div className="flex min-h-[280px] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm xl:col-span-6 xl:col-start-1 xl:row-start-2 xl:h-full xl:min-h-0">
          <div className="shrink-0 border-b border-neutral-100 px-3 py-2.5">
            <h2 className="text-sm font-extrabold text-neutral-950">Prioridades de análise</h2>
            <p className="mt-0.5 text-[10px] text-neutral-500">Processos ordenados pelos que estão aguardando há mais tempo.</p>
          </div>
          <div className="divide-y divide-neutral-100 md:hidden">
            {priorities.length ? priorities.map((item) => (
              <div key={item.id} className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-neutral-950">{item.tenant_name || "Nome não informado"}</p>
                    <p className="mt-0.5 text-xs text-neutral-500">{item.tenant_document || "Documento não informado"}</p>
                  </div>
                  <ConsultaStatusBadge item={item} />
                </div>
                <div className="flex items-center justify-between text-xs text-neutral-500">
                  <span>{originName(item)}</span>
                  <strong className="text-neutral-700">{elapsedTime(item.created_at)}</strong>
                </div>
                <Button asChild variant="outline" size="sm" className="w-full gap-2">
                  <Link to="/consultas/$id/resultado" params={{ id: item.id }}><Eye size={14} /> Visualizar</Link>
                </Button>
              </div>
            )) : <EmptyState />}
          </div>
          <div className="hidden min-h-0 flex-1 overflow-hidden md:block">
            <Table>
              <TableHeader className="bg-neutral-50/80">
                <TableRow>
                  <TableHead className="h-7 py-1 pl-3 text-[9px] uppercase tracking-wider">Inquilino</TableHead>
                  <TableHead className="h-7 py-1 text-[9px] uppercase tracking-wider">CPF</TableHead>
                  <TableHead className="h-7 py-1 text-[9px] uppercase tracking-wider">Origem</TableHead>
                  <TableHead className="h-7 py-1 text-[9px] uppercase tracking-wider">Status</TableHead>
                  <TableHead className="h-7 py-1 text-[9px] uppercase tracking-wider">Aguardando</TableHead>
                  <TableHead className="h-7 py-1 pr-3 text-right text-[9px] uppercase tracking-wider">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {priorities.length ? priorities.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-[180px] truncate py-1.5 pl-3 text-[11px] font-bold">{item.tenant_name || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap py-1.5 text-[10px] text-neutral-500">{item.tenant_document || "—"}</TableCell>
                    <TableCell className="max-w-[150px] truncate py-1.5 text-[10px] text-neutral-500">{originName(item)}</TableCell>
                    <TableCell className="py-1.5"><ConsultaStatusBadge item={item} /></TableCell>
                    <TableCell className="whitespace-nowrap py-1.5 text-[10px] font-semibold text-neutral-600">{elapsedTime(item.created_at)}</TableCell>
                    <TableCell className="py-1.5 pr-3 text-right">
                      <Button asChild variant="ghost" size="icon" className="h-7 w-7">
                        <Link to="/consultas/$id/resultado" params={{ id: item.id }} aria-label={`Visualizar ${item.tenant_name || "processo"}`}><Eye size={15} /></Link>
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Mais opções"><MoreVertical size={14} /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild><Link to="/consultas/$id/resultado" params={{ id: item.id }}>Ver detalhes</Link></DropdownMenuItem>
                          <DropdownMenuItem asChild><Link to="/admin/aprovacoes">Abrir fluxo de aprovação</Link></DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )) : <TableRow><TableCell colSpan={6}><EmptyState /></TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
          <CardFooterLink to="/admin/aprovacoes" label="Ver todas as prioridades" />
        </div>

        <div className="flex min-h-[280px] flex-col rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm xl:col-span-3 xl:col-start-7 xl:row-start-2 xl:h-full xl:min-h-0 xl:overflow-hidden">
          <h2 className="text-sm font-extrabold text-neutral-950">Contratos próximos do vencimento</h2>
          {expiringContracts.length ? (
            <div className="mt-1.5 min-h-0 flex-1 divide-y divide-neutral-100 overflow-hidden">
              {expiringContracts.map((item) => (
                <Link key={item.id} to="/apolices/$id" params={{ id: item.id }} className="group flex items-center gap-2 py-1.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><CalendarDays size={15} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-extrabold text-neutral-950">Contrato #{item.numero}</span>
                    <span className="block truncate text-[10px] text-neutral-500">{item.consulta?.tenant_name || "Inquilino não informado"}</span>
                    <span className="block text-[9px] text-neutral-400">Vencimento: {formatDate(item.vigencia_fim)}</span>
                  </span>
                  <Badge className="border border-amber-200 bg-amber-50 text-[10px] font-bold text-amber-700 shadow-none hover:bg-amber-50">{item.days} dias</Badge>
                </Link>
              ))}
            </div>
          ) : <EmptyState />}
          <CardFooterLink to="/admin/contratos" label="Ver todos os contratos" />
        </div>

        <div className="flex min-h-[420px] flex-col rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm xl:col-span-3 xl:col-start-10 xl:row-span-2 xl:row-start-1 xl:h-full xl:min-h-0 xl:overflow-hidden">
          <h2 className="text-sm font-extrabold text-neutral-950">Últimas atividades</h2>
          {activities.length ? (
            <div className="mt-1.5 min-h-0 flex-1 divide-y divide-neutral-100 overflow-hidden">
              {activities.map((item) => {
                const Icon = item.Icon;
                return (
                  <Link key={item.id} to={item.to} className="flex items-start gap-2.5 py-2.5 xl:py-3">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${toneClasses[item.tone].soft} ${toneClasses[item.tone].text}`}><Icon size={15} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-extrabold text-neutral-950">{item.title}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-neutral-500">{item.detail}</span>
                    </span>
                    <span className="whitespace-nowrap text-[10px] text-neutral-400">{relativeTime(item.date)}</span>
                  </Link>
                );
              })}
            </div>
          ) : <EmptyState />}
          <CardFooterLink to="/admin/aprovacoes" label="Ver todas as atividades" />
        </div>
      </section>
    </div>
  );
}

function ConsultaStatusBadge({ item }: { item: JuridicoConsulta }) {
  const reviewing = isInReview(item);
  return (
    <Badge variant="outline" className={reviewing ? "whitespace-nowrap border-blue-200 bg-blue-50 text-[10px] text-blue-700" : "whitespace-nowrap border-amber-200 bg-amber-50 text-[10px] text-amber-700"}>
      {reviewing ? "Em análise" : "Aguardando análise"}
    </Badge>
  );
}

function CardFooterLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="mt-3 flex h-8 shrink-0 items-center justify-center gap-2 rounded-lg border border-neutral-200 text-[10px] font-bold text-neutral-700 transition hover:border-yellow-300 hover:bg-yellow-50 hover:text-neutral-950 xl:mt-auto">
      {label} <ArrowRight size={13} />
    </Link>
  );
}

function EmptyState() {
  return <div className="flex min-h-20 flex-1 items-center justify-center px-4 text-center text-xs text-neutral-400 xl:min-h-0">Nenhum registro encontrado.</div>;
}

function JuridicoDashboardSkeleton() {
  return (
    <div className="animate-pulse space-y-3 xl:grid xl:h-full xl:min-h-0 xl:grid-rows-[174px_minmax(0,1fr)] xl:gap-3 xl:space-y-0">
      <div className="rounded-2xl border border-yellow-100 bg-yellow-50/60" />
      <div className="grid gap-3 xl:h-full xl:grid-cols-12 xl:grid-rows-2">
        <div className="h-72 rounded-2xl border border-neutral-100 bg-white xl:col-span-6 xl:col-start-1 xl:row-start-1 xl:h-full" />
        <div className="h-72 rounded-2xl border border-neutral-100 bg-white xl:col-span-3 xl:col-start-7 xl:row-start-1 xl:h-full" />
        <div className="h-64 rounded-2xl border border-neutral-100 bg-white xl:col-span-6 xl:col-start-1 xl:row-start-2 xl:h-full" />
        <div className="h-64 rounded-2xl border border-neutral-100 bg-white xl:col-span-3 xl:col-start-7 xl:row-start-2 xl:h-full" />
        <div className="h-[420px] rounded-2xl border border-neutral-100 bg-white xl:col-span-3 xl:col-start-10 xl:row-span-2 xl:row-start-1 xl:h-full" />
      </div>
    </div>
  );
}

function buildMovement(consultas: JuridicoConsulta[], periodo: Periodo) {
  const now = new Date();
  const buckets: { key: string; label: string; entradas: number; concluidas: number }[] = [];
  const isDaily = periodo === "30d";
  const amount = isDaily ? 30 : Number(periodo.replace("m", ""));

  for (let offset = amount - 1; offset >= 0; offset -= 1) {
    const date = isDaily
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset)
      : new Date(now.getFullYear(), now.getMonth() - offset, 1);
    buckets.push({
      key: isDaily ? dayKey(date) : monthKey(date),
      label: isDaily
        ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(date)
        : new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" }).format(date).replace(" de ", "/"),
      entradas: 0,
      concluidas: 0,
    });
  }

  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  for (const item of consultas) {
    const entryKey = isDaily ? dayKey(new Date(item.created_at)) : monthKey(new Date(item.created_at));
    const entryBucket = byKey.get(entryKey);
    if (entryBucket) entryBucket.entradas += 1;

    for (const completedAt of [item.approved_at, item.rejected_at]) {
      if (!completedAt) continue;
      const completedKey = isDaily ? dayKey(new Date(completedAt)) : monthKey(new Date(completedAt));
      const completedBucket = byKey.get(completedKey);
      if (completedBucket) completedBucket.concluidas += 1;
    }
  }
  return buckets;
}

type ActivityItem = {
  id: string;
  title: string;
  detail: string;
  date: string;
  tone: Tone;
  Icon: ComponentType<LucideProps>;
  to: string;
};

function buildActivities(data: JuridicoDashboardData, originsById: Map<string, { nome: string | null }>): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const consulta of data.consultas) {
    if (consulta.approved_at) items.push({ id: `approved-${consulta.id}`, title: "Documento aprovado", detail: consulta.tenant_name || "Inquilino não informado", date: consulta.approved_at, tone: "green", Icon: CheckCircle2, to: "/admin/aprovacoes" });
    if (consulta.rejected_at) items.push({ id: `rejected-${consulta.id}`, title: "Documento reprovado", detail: consulta.tenant_name || "Inquilino não informado", date: consulta.rejected_at, tone: "red", Icon: XCircle, to: "/admin/aprovacoes" });
    if (isInReview(consulta)) items.push({ id: `review-${consulta.id}`, title: "Documento encaminhado para análise", detail: consulta.tenant_name || originName(consulta), date: consulta.updated_at, tone: "amber", Icon: Clock3, to: "/admin/aprovacoes" });
  }
  for (const document of data.documentos) {
    const origin = originsById.get(document.user_id)?.nome || "Usuário não informado";
    if (document.submitted_at) items.push({ id: `submitted-${document.id}`, title: "Novo documento enviado", detail: origin, date: document.submitted_at, tone: "blue", Icon: FileText, to: "/admin/verificacoes" });
    if (document.reviewed_at && normalize(document.verification_status) === "aprovado") items.push({ id: `doc-approved-${document.id}`, title: "Verificação aprovada", detail: origin, date: document.reviewed_at, tone: "green", Icon: CheckCircle2, to: "/admin/verificacoes" });
    if (document.reviewed_at && ["recusado", "reprovado"].includes(normalize(document.verification_status))) items.push({ id: `doc-rejected-${document.id}`, title: "Verificação reprovada", detail: origin, date: document.reviewed_at, tone: "red", Icon: XCircle, to: "/admin/verificacoes" });
  }
  for (const claim of data.sinistros) {
    items.push({ id: `claim-${claim.id}`, title: "Sinistro aberto", detail: `${claim.apolice?.numero ? `Contrato ${claim.apolice.numero}` : "Contrato não informado"}${claim.apolice?.consulta?.tenant_name ? ` · ${claim.apolice.consulta.tenant_name}` : ""}`, date: claim.created_at, tone: "purple", Icon: ShieldAlert, to: "/sinistros" });
  }
  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 8);
}

function isAwaitingReview(item: JuridicoConsulta) {
  return normalize(item.status) === "pendente" && normalize(item.substatus) === "documentacao_complementar_enviada";
}

function isInReview(item: JuridicoConsulta) {
  return normalize(item.status) === "em_analise" && normalize(item.substatus) !== "falta_documentos";
}

function originName(item: JuridicoConsulta) {
  return item.solicitante?.nome?.trim() || roleLabel(item.role_solicitante) || "Origem não informada";
}

function roleLabel(value: string | null | undefined) {
  const labels: Record<string, string> = { corretor: "Corretor", imobiliaria: "Imobiliária", proprietario: "Proprietário" };
  return labels[normalize(value)] ?? (value || "");
}

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function localDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  return startOfLocalDay(new Date(value));
}

function dayKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function monthKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

function percentage(value: number, total: number) {
  return total ? Math.round((value / total) * 100) : 0;
}

function elapsedTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
}

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  if (minutes < 1440) return `há ${Math.floor(minutes / 60)}h ${minutes % 60 ? `${minutes % 60}m` : ""}`.trim();
  return `há ${Math.floor(minutes / 1440)}d`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR").format(localDate(value));
}

const toneClasses: Record<Tone, { soft: string; text: string }> = {
  neutral: { soft: "bg-neutral-100", text: "text-neutral-700" },
  amber: { soft: "bg-amber-50", text: "text-amber-700" },
  blue: { soft: "bg-blue-50", text: "text-blue-600" },
  green: { soft: "bg-emerald-50", text: "text-emerald-600" },
  red: { soft: "bg-red-50", text: "text-red-600" },
  orange: { soft: "bg-orange-50", text: "text-orange-600" },
  purple: { soft: "bg-violet-50", text: "text-violet-600" },
};
