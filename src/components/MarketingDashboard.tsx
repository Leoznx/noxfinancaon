import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Eye,
  FileText,
  Megaphone,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const isToday = (iso: string | null) => {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  );
};

const tempo = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "<1h";
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

const DEMO_LEADS: any[] = [
  {
    id: "LEAD-MKT-001",
    nome: "Joao da Silva",
    origem: "Blog",
    status: "novo",
    interesse: "Seguro fianca",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(),
  },
  {
    id: "LEAD-MKT-002",
    nome: "Maria Oliveira",
    origem: "Seja parceiro",
    status: "qualificado",
    interesse: "Parceria",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
  },
];

export function MarketingDashboard() {
  const [leads, setLeads] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingDemo, setUsingDemo] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("leads")
      .select("id, nome, telefone, email, origem, status, created_at")
      .order("created_at", { ascending: false })
      .limit(300);

    const leadRows = data ?? [];
    if (!leadRows.length) {
      setLeads(DEMO_LEADS);
      setPosts([
        {
          id: "BLOG-MKT-001",
          titulo: "Como alugar sem fiador",
          status: "publicado",
          created_at: new Date().toISOString(),
        },
      ]);
      setUsingDemo(true);
    } else {
      setLeads(leadRows);
      setPosts([]);
      setUsingDemo(false);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    const ch = supabase
      .channel("marketing-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => load())
      .subscribe();
    return () => {
      clearInterval(interval);
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    const novosHoje = leads.filter((l) => isToday(l.created_at)).length;
    const emAberto = leads.filter((l) =>
      ["novo", "em_aberto", null, undefined].includes(l.status),
    ).length;
    const qualificados = leads.filter((l) => l.status === "qualificado").length;
    const convertidos = leads.filter((l) =>
      ["convertido", "ganho", "fechado"].includes(l.status),
    ).length;
    const inscricoes = 0;
    const artigos = posts.length;
    const taxa = leads.length ? Math.round((convertidos / leads.length) * 100) : 0;
    return { novosHoje, emAberto, qualificados, convertidos, inscricoes, artigos, taxa };
  }, [leads, posts]);

  const alerta = useMemo(() => {
    if (stats.emAberto > 50) {
      return {
        tone: "grave" as const,
        msg: "Alerta grave: existem mais de 50 leads sem tratamento.",
      };
    }
    if (stats.emAberto > 25) {
      return { tone: "forte" as const, msg: "Alerta forte: existem mais de 25 leads parados." };
    }
    if (stats.emAberto > 10) {
      return {
        tone: "leve" as const,
        msg: "Atencao: existem mais de 10 leads aguardando atendimento.",
      };
    }
    return { tone: "ok" as const, msg: "Fluxo de marketing dentro do controle." };
  }, [stats]);

  const prioridades = useMemo(() => {
    return leads
      .filter((l) => ["novo", "em_aberto", null, undefined].includes(l.status))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .slice(0, 12)
      .map((l) => ({
        tipo: "Lead novo",
        id: l.id,
        nome: l.nome ?? "-",
        origem: l.origem ?? "-",
        status: l.status ?? "novo",
        data: l.created_at,
        link: "/admin/leads",
      }));
  }, [leads]);

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
            <Megaphone className="text-neutral-900" size={28} strokeWidth={1.5} />
            Painel Marketing
          </h1>
          <p className="text-neutral-500 mt-2 font-medium">
            Acompanhe leads, campanhas, blog e oportunidades comerciais em tempo real.
          </p>
        </div>
        {usingDemo && (
          <Badge variant="outline" className="text-xs">
            Exibindo dados de demonstracao
          </Badge>
        )}
      </div>

      <div className={`flex items-start gap-3 p-4 border rounded-xl ${alertaStyle}`}>
        <AlertIcon size={20} className="mt-0.5 flex-shrink-0" />
        <p className="font-semibold text-sm">{alerta.msg}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Leads novos hoje" value={stats.novosHoje} Icon={UserPlus} tone="blue" />
        <StatCard label="Leads em aberto" value={stats.emAberto} Icon={Users} tone="amber" />
        <StatCard
          label="Leads qualificados"
          value={stats.qualificados}
          Icon={CheckCircle2}
          tone="green"
        />
        <StatCard
          label="Leads convertidos"
          value={stats.convertidos}
          Icon={Activity}
          tone="neutral"
        />
        <StatCard
          label="Inscricoes recebidas"
          value={stats.inscricoes}
          Icon={FileText}
          tone="neutral"
        />
        <StatCard label="Artigos publicados" value={stats.artigos} Icon={FileText} tone="blue" />
        <StatCard
          label="Taxa de conversao"
          value={`${stats.taxa}%`}
          Icon={BarChart3}
          tone="green"
        />
      </div>

      <section className="bg-white border border-neutral-200 rounded-xl p-6">
        <h2 className="text-lg font-bold text-neutral-900 mb-4">Movimentacao de Marketing</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MovBar label="Novos hoje" value={stats.novosHoje} color="bg-blue-600" />
          <MovBar label="Qualificados" value={stats.qualificados} color="bg-emerald-600" />
          <MovBar label="Convertidos" value={stats.convertidos} color="bg-neutral-900" />
          <MovBar label="Em aberto" value={stats.emAberto} color="bg-amber-500" />
        </div>
      </section>

      <section className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        <div className="p-6 border-b border-neutral-100">
          <h2 className="text-lg font-bold text-neutral-900">Prioridades de Marketing</h2>
          <p className="text-xs text-neutral-500 mt-1">
            Leads mais antigos e sem tratamento aparecem primeiro.
          </p>
        </div>
        <Table>
          <TableHeader className="bg-neutral-50">
            <TableRow>
              <TableHead className="px-6">Tipo</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Aguardando</TableHead>
              <TableHead className="text-right pr-6">Acoes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-neutral-400">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : !prioridades.length ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-neutral-500">
                  Nenhuma prioridade no momento.
                </TableCell>
              </TableRow>
            ) : (
              prioridades.map((p) => (
                <TableRow key={`${p.tipo}-${p.id}`}>
                  <TableCell className="px-6 text-xs font-semibold uppercase text-neutral-600">
                    {p.tipo}
                  </TableCell>
                  <TableCell className="font-semibold">{p.nome}</TableCell>
                  <TableCell className="text-xs text-neutral-500">{p.origem}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {p.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-neutral-600">{tempo(p.data)}</TableCell>
                  <TableCell className="text-right pr-6">
                    <Link to={p.link}>
                      <Button size="sm" variant="ghost">
                        <Eye size={14} />
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  Icon,
  tone,
}: {
  label: string;
  value: number | string;
  Icon: any;
  tone: "neutral" | "amber" | "blue" | "green" | "red" | "orange";
}) {
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
      <div className={`inline-flex p-2 rounded-lg border mb-4 ${tones[tone]}`}>
        <Icon size={18} strokeWidth={1.5} />
      </div>
      <p className="text-[10px] text-neutral-400 font-bold uppercase tracking-widest mb-1">
        {label}
      </p>
      <h3 className="text-3xl font-bold text-neutral-900 tabular-nums">{value}</h3>
    </div>
  );
}

function MovBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.min(100, (value / Math.max(value, 20)) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs font-semibold text-neutral-600">{label}</p>
        <p className="text-lg font-bold text-neutral-900 tabular-nums">{value}</p>
      </div>
      <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
