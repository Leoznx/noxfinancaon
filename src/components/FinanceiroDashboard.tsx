import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Wallet, DollarSign, Receipt, AlertTriangle, ShieldCheck, TrendingUp, TrendingDown, Clock, Banknote, FileWarning, Activity, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Fatura {
  id: string;
  valor: number;
  status: string;
  data_vencimento: string;
  data_pagamento: string | null;
  numero_parcela: number | null;
  apolice_id: string | null;
}

interface Comissao {
  id: string;
  valor: number;
  status: string;
  created_at: string;
}

interface Saque {
  id: string;
  valor_liquido: number;
  status: string;
  created_at: string;
}

const brl = (n: number) =>
  `R$ ${Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const isToday = (iso: string | null) => {
  if (!iso) return false;
  const d = new Date(iso); const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
};
const isThisMonth = (iso: string | null) => {
  if (!iso) return false;
  const d = new Date(iso); const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
};
const diasAtraso = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
};

const DEMO_FATURAS: any[] = [
  { id: "demo-f1", valor: 584.09, status: "vencido", data_vencimento: new Date(Date.now() - 1000*60*60*24*3).toISOString(), data_pagamento: null, numero_parcela: 1, apolice_id: "NOX-FIN-001", _cliente: "João da Silva Teste" },
  { id: "demo-f2", valor: 663.74, status: "pendente", data_vencimento: new Date().toISOString(), data_pagamento: null, numero_parcela: 1, apolice_id: "NOX-FIN-002", _cliente: "Maria Oliveira Teste" },
  { id: "demo-f3", valor: 420.00, status: "pago", data_vencimento: new Date(Date.now() - 1000*60*60*24*2).toISOString(), data_pagamento: new Date().toISOString(), numero_parcela: 2, apolice_id: "NOX-FIN-003", _cliente: "Carlos Mendes Teste" },
];
const DEMO_COMISSOES: any[] = [
  { id: "demo-c1", valor: 250, status: "disponivel", created_at: new Date(Date.now() - 1000*60*60*48).toISOString(), _favorecido: "Corretor Teste" },
  { id: "demo-c2", valor: 180, status: "pendente", created_at: new Date(Date.now() - 1000*60*60*24).toISOString(), _favorecido: "Imobiliária Teste" },
];
const DEMO_SAQUES: any[] = [
  { id: "demo-s1", valor_liquido: 850, status: "pendente", created_at: new Date(Date.now() - 1000*60*60*5).toISOString(), _solicitante: "Vendedor NOX" },
];

export function FinanceiroDashboard() {
  const [faturas, setFaturas] = useState<any[]>([]);
  const [comissoes, setComissoes] = useState<any[]>([]);
  const [saques, setSaques] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingDemo, setUsingDemo] = useState(false);

  const load = async () => {
    const [f, c, s] = await Promise.all([
      supabase.from("faturas_inquilino").select("id, valor, status, data_vencimento, data_pagamento, numero_parcela, apolice_id").order("data_vencimento", { ascending: false }).limit(500),
      supabase.from("comissoes").select("id, valor, status, created_at").in("status", ["pendente", "disponivel", "elegivel", "retida"]).order("created_at", { ascending: false }).limit(200),
      supabase.from("solicitacoes_saque").select("id, valor_liquido, status, created_at").order("created_at", { ascending: false }).limit(200),
    ]);

    const fData = f.data ?? [];
    const cData = c.data ?? [];
    const sData = s.data ?? [];

    if (!fData.length && !cData.length && !sData.length) {
      setFaturas(DEMO_FATURAS); setComissoes(DEMO_COMISSOES); setSaques(DEMO_SAQUES);
      setUsingDemo(true);
    } else {
      setFaturas(fData); setComissoes(cData); setSaques(sData);
      setUsingDemo(false);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    const ch = supabase
      .channel("financeiro-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "faturas_inquilino" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "comissoes" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "solicitacoes_saque" }, () => load())
      .subscribe();
    return () => { clearInterval(interval); supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    const recebidoHoje = faturas.filter(f => f.status === "pago" && isToday(f.data_pagamento)).reduce((a, f) => a + Number(f.valor || 0), 0);
    const aReceberHoje = faturas.filter(f => f.status !== "pago" && f.status !== "cancelado" && isToday(f.data_vencimento)).reduce((a, f) => a + Number(f.valor || 0), 0);
    const vencidasArr = faturas.filter(f => f.status !== "pago" && f.status !== "cancelado" && new Date(f.data_vencimento) < new Date(new Date().toDateString()));
    const vencidos = vencidasArr.reduce((a, f) => a + Number(f.valor || 0), 0);
    const pagamentosPendentes = faturas.filter(f => f.status === "pendente" || f.status === "a_vencer").length;
    const comissoesLiberar = comissoes.filter(c => c.status === "disponivel" || c.status === "elegivel").reduce((a, c) => a + Number(c.valor || 0), 0);
    const saquesPendentes = saques.filter(s => s.status === "pendente").length;
    const repassesPendentes = comissoes.filter(c => c.status === "retida" || c.status === "pendente").reduce((a, c) => a + Number(c.valor || 0), 0);
    const faturamentoMes = faturas.filter(f => f.status === "pago" && isThisMonth(f.data_pagamento)).reduce((a, f) => a + Number(f.valor || 0), 0);
    return { recebidoHoje, aReceberHoje, vencidos, vencidasCount: vencidasArr.length, pagamentosPendentes, comissoesLiberar, comissoesCount: comissoes.filter(c => c.status === "disponivel" || c.status === "elegivel").length, saquesPendentes, repassesPendentes, faturamentoMes };
  }, [faturas, comissoes, saques]);

  const alerta = useMemo(() => {
    const v = stats.vencidasCount;
    if (v > 10) return { tone: "grave" as const, msg: "Alerta grave: existem mais de 10 faturas vencidas. Risco financeiro elevado." };
    if (v > 5) return { tone: "forte" as const, msg: "Alerta forte: existem mais de 5 faturas vencidas. Priorize a cobrança e conferência." };
    if (v > 3) return { tone: "leve" as const, msg: "Atenção: existem mais de 3 faturas vencidas para acompanhar." };
    if (stats.saquesPendentes > 3) return { tone: "leve" as const, msg: "Existem saques aguardando análise financeira." };
    if (stats.comissoesCount > 0) return { tone: "leve" as const, msg: "Existem comissões prontas para conferência/liberação." };
    return { tone: "ok" as const, msg: "Fluxo financeiro dentro do controle." };
  }, [stats]);

  const prioridades = useMemo(() => {
    const vencidas = faturas
      .filter(f => f.status !== "pago" && f.status !== "cancelado" && new Date(f.data_vencimento) < new Date(new Date().toDateString()))
      .sort((a, b) => new Date(a.data_vencimento).getTime() - new Date(b.data_vencimento).getTime())
      .slice(0, 8)
      .map(f => ({ tipo: "Fatura vencida", id: f.id, nome: f._cliente ?? "Inquilino", doc: f.apolice_id ?? "—", valor: Number(f.valor || 0), venc: f.data_vencimento, status: f.status, atraso: diasAtraso(f.data_vencimento), link: "/faturas-inquilinos" }));
    const saquesP = saques.filter(s => s.status === "pendente").slice(0, 5).map(s => ({ tipo: "Saque solicitado", id: s.id, nome: s._solicitante ?? "Solicitante", doc: "—", valor: Number(s.valor_liquido || 0), venc: s.created_at, status: s.status, atraso: 0, link: "/admin/financeiro" }));
    const comP = comissoes.filter(c => c.status === "disponivel" || c.status === "elegivel").slice(0, 5).map(c => ({ tipo: "Comissão a liberar", id: c.id, nome: c._favorecido ?? "Favorecido", doc: "—", valor: Number(c.valor || 0), venc: c.created_at, status: c.status, atraso: 0, link: "/admin/financeiro" }));
    return [...vencidas, ...saquesP, ...comP].slice(0, 12);
  }, [faturas, saques, comissoes]);

  const alertaStyle = {
    grave: "bg-red-50 border-red-300 text-red-900",
    forte: "bg-orange-50 border-orange-300 text-orange-900",
    leve: "bg-amber-50 border-amber-200 text-amber-900",
    ok: "bg-emerald-50 border-emerald-200 text-emerald-900",
  }[alerta.tone];
  const AlertIcon = alerta.tone === "ok" ? ShieldCheck : AlertTriangle;

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-neutral-900 tracking-tight flex items-center gap-3">
            <Wallet className="text-neutral-900" size={28} strokeWidth={1.5} />
            Painel Financeiro
          </h1>
          <p className="text-neutral-500 mt-2 font-medium">
            Acompanhe contas, recebimentos, pagamentos, comissões, faturas e pendências financeiras em tempo real.
          </p>
        </div>
        {usingDemo && <Badge variant="outline" className="text-xs">Exibindo dados de demonstração</Badge>}
      </div>

      <div className={`flex items-start gap-3 p-4 border rounded-xl ${alertaStyle}`}>
        <AlertIcon size={20} className="mt-0.5 flex-shrink-0" />
        <p className="font-semibold text-sm">{alerta.msg}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Recebido hoje" value={brl(stats.recebidoHoje)} Icon={TrendingUp} tone="green" />
        <StatCard label="A receber hoje" value={brl(stats.aReceberHoje)} Icon={Clock} tone="blue" />
        <StatCard label="Vencidos" value={brl(stats.vencidos)} Icon={TrendingDown} tone="red" />
        <StatCard label="Pagamentos pendentes" value={String(stats.pagamentosPendentes)} Icon={Receipt} tone="amber" />
        <StatCard label="Comissões a liberar" value={brl(stats.comissoesLiberar)} Icon={DollarSign} tone="neutral" />
        <StatCard label="Saques solicitados" value={String(stats.saquesPendentes)} Icon={Banknote} tone="orange" />
        <StatCard label="Repasses pendentes" value={brl(stats.repassesPendentes)} Icon={FileWarning} tone="amber" />
        <StatCard label="Faturamento do mês" value={brl(stats.faturamentoMes)} Icon={Activity} tone="green" />
      </div>

      <section className="bg-white border border-neutral-200 rounded-xl p-6">
        <h2 className="text-lg font-bold text-neutral-900 mb-4">Movimentação financeira</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MovBar label="Recebido hoje" value={stats.recebidoHoje} color="bg-emerald-600" />
          <MovBar label="Faturamento do mês" value={stats.faturamentoMes} color="bg-neutral-900" />
          <MovBar label="A receber" value={stats.aReceberHoje} color="bg-blue-600" />
          <MovBar label="Vencidos" value={stats.vencidos} color="bg-red-600" />
        </div>
      </section>

      <section className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        <div className="p-6 border-b border-neutral-100">
          <h2 className="text-lg font-bold text-neutral-900">Prioridades financeiras</h2>
          <p className="text-xs text-neutral-500 mt-1">Vencidos mais antigos primeiro, seguidos de saques e comissões.</p>
        </div>
        <Table>
          <TableHeader className="bg-neutral-50">
            <TableRow>
              <TableHead className="px-6">Tipo</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Documento</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Atraso</TableHead>
              <TableHead className="text-right pr-6">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-neutral-400">Carregando...</TableCell></TableRow>
            ) : !prioridades.length ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-neutral-500">Nenhuma prioridade no momento.</TableCell></TableRow>
            ) : prioridades.map((p) => (
              <TableRow key={`${p.tipo}-${p.id}`} className={p.atraso > 0 ? "bg-red-50/40" : ""}>
                <TableCell className="px-6 text-xs font-semibold uppercase text-neutral-600">{p.tipo}</TableCell>
                <TableCell className="font-semibold">{p.nome}</TableCell>
                <TableCell className="text-xs text-neutral-500">{p.doc}</TableCell>
                <TableCell className="font-semibold tabular-nums">{brl(p.valor)}</TableCell>
                <TableCell className="text-xs text-neutral-500">{new Date(p.venc).toLocaleDateString("pt-BR")}</TableCell>
                <TableCell className={`text-xs font-semibold ${p.atraso > 0 ? "text-red-700" : "text-neutral-400"}`}>{p.atraso > 0 ? `${p.atraso}d` : "—"}</TableCell>
                <TableCell className="text-right pr-6">
                  <Link to={p.link}><Button size="sm" variant="ghost"><Eye size={14} /></Button></Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function StatCard({ label, value, Icon, tone }: { label: string; value: string; Icon: any; tone: "neutral" | "amber" | "blue" | "green" | "red" | "orange" }) {
  const tones: Record<string, string> = {
    neutral: "bg-neutral-50 text-neutral-700 border-neutral-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    red: "bg-red-50 text-red-700 border-red-200",
    orange: "bg-orange-50 text-orange-700 border-orange-200",
  };
  return (
    <div className="p-5 bg-white border border-neutral-200 rounded-xl hover:shadow-md transition-all">
      <div className={`inline-flex p-2 rounded-lg border mb-4 ${tones[tone]}`}><Icon size={18} strokeWidth={1.5} /></div>
      <p className="text-[10px] text-neutral-400 font-bold uppercase tracking-widest mb-1">{label}</p>
      <h3 className="text-2xl font-bold text-neutral-900 tabular-nums">{value}</h3>
    </div>
  );
}

function MovBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.min(100, (value / Math.max(value, 5000)) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs font-semibold text-neutral-600">{label}</p>
        <p className="text-sm font-bold text-neutral-900 tabular-nums">{brl(value)}</p>
      </div>
      <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
