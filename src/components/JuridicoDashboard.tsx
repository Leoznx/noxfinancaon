import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Scale, FileCheck2, FileClock, FileSearch, FileX2, FileWarning, AlertTriangle, ShieldCheck, Eye, CheckCircle2, XCircle, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

interface Consulta {
  id: string;
  status: string;
  created_at: string;
  tenant_name: string | null;
  tenant_document: string | null;
  property_address: string | null;
  role_solicitante: string | null;
}

const DEMO: Consulta[] = [
  { id: "demo-1", status: "pendente", created_at: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(), tenant_name: "João da Silva Teste", tenant_document: "123.456.789-01", property_address: "Rua das Flores, 100 — São Paulo/SP", role_solicitante: "corretor" },
  { id: "demo-2", status: "pendente", created_at: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(), tenant_name: "Maria Oliveira Teste", tenant_document: "987.654.321-00", property_address: "Av. Paulista, 2000 — São Paulo/SP", role_solicitante: "imobiliaria" },
  { id: "demo-3", status: "pendente", created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), tenant_name: "Carlos Mendes Teste", tenant_document: "456.789.123-00", property_address: "Rua Augusta, 555 — São Paulo/SP", role_solicitante: "proprietario" },
];

const isToday = (iso: string) => {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
};

const tempoAguardando = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / (1000 * 60 * 60));
  if (h < 1) return "<1h";
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

export function JuridicoDashboard() {
  const [consultas, setConsultas] = useState<Consulta[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingDemo, setUsingDemo] = useState(false);
  const [adminId, setAdminId] = useState<string | null>(null);

  const load = async () => {
    const { data, error } = await supabase
      .from("consultas_credito")
      .select("id, status, created_at, tenant_name, tenant_document, property_address, role_solicitante")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      setConsultas(DEMO);
      setUsingDemo(true);
    } else if (!data || data.length === 0) {
      setConsultas(DEMO);
      setUsingDemo(true);
    } else {
      setConsultas(data as Consulta[]);
      setUsingDemo(false);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    supabase.auth.getUser().then(({ data }) => setAdminId(data.user?.id ?? null));

    const interval = setInterval(load, 30000);
    const channel = supabase
      .channel("juridico-consultas")
      .on("postgres_changes", { event: "*", schema: "public", table: "consultas_credito" }, () => load())
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    const novasHoje = consultas.filter((c) => isToday(c.created_at)).length;
    const pendentes = consultas.filter((c) => c.status === "pendente");
    const emAnalise = consultas.filter((c) => c.status === "em_analise").length;
    const aprovadasHoje = consultas.filter((c) => c.status === "aprovado" && isToday(c.created_at)).length;
    const reprovadasHoje = consultas.filter((c) => c.status === "reprovado" && isToday(c.created_at)).length;
    const docsPendentes = consultas.filter((c) => c.status === "documentos_pendentes" || c.status === "ajuste_solicitado").length;
    return { novasHoje, pendentes: pendentes.length, emAnalise, aprovadasHoje, reprovadasHoje, docsPendentes };
  }, [consultas]);

  const prioridades = useMemo(() =>
    consultas
      .filter((c) => c.status === "pendente" || c.status === "em_analise" || c.status === "documentos_pendentes")
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .slice(0, 10),
    [consultas]
  );

  const alerta = useMemo(() => {
    const p = stats.pendentes;
    if (p > 10) return { tone: "grave" as const, msg: "Alerta grave: existem mais de 10 aprovações pendentes. Risco de atraso operacional." };
    if (p > 5) return { tone: "forte" as const, msg: "Alerta forte: existem mais de 5 aprovações pendentes. Priorize a análise jurídica." };
    if (p > 3) return { tone: "leve" as const, msg: "Atenção: existem mais de 3 aprovações aguardando análise." };
    return { tone: "ok" as const, msg: "Fluxo jurídico dentro do controle." };
  }, [stats.pendentes]);

  const aprovar = async (id: string) => {
    if (usingDemo || id.startsWith("demo-")) {
      toast.success("Aprovado (demo)");
      return;
    }
    const { error } = await supabase.from("consultas_credito").update({
      status: "aprovado", approved_by: adminId, approved_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) toast.error("Erro ao aprovar"); else { toast.success("Consulta aprovada"); load(); }
  };

  const reprovar = async (id: string) => {
    if (usingDemo || id.startsWith("demo-")) {
      toast.success("Reprovado (demo)");
      return;
    }
    const motivo = window.prompt("Motivo da reprovação:");
    if (!motivo?.trim()) return;
    const { error } = await supabase.from("consultas_credito").update({
      status: "reprovado", rejected_by: adminId, rejected_at: new Date().toISOString(), rejection_reason: motivo,
    }).eq("id", id);
    if (error) toast.error("Erro ao reprovar"); else { toast.success("Consulta reprovada"); load(); }
  };

  const solicitarAjuste = async (_id: string) => {
    toast.message("Solicitação de ajuste documental registrada", { description: "O solicitante será notificado." });
  };

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
            <Scale className="text-neutral-900" size={28} strokeWidth={1.5} />
            Painel Jurídico
          </h1>
          <p className="text-neutral-500 mt-2 font-medium">
            Acompanhe aprovações, documentos, contratos e pendências jurídicas em tempo real.
          </p>
        </div>
        {usingDemo && (
          <Badge variant="outline" className="text-xs">Exibindo dados de demonstração</Badge>
        )}
      </div>

      {/* Alerta */}
      <div className={`flex items-start gap-3 p-4 border rounded-xl ${alertaStyle}`}>
        <AlertIcon size={20} className="mt-0.5 flex-shrink-0" />
        <p className="font-semibold text-sm">{alerta.msg}</p>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard label="Novas hoje" value={stats.novasHoje} Icon={FileSearch} tone="neutral" />
        <StatCard label="Aguardando análise" value={stats.pendentes} Icon={FileClock} tone="amber" />
        <StatCard label="Em análise" value={stats.emAnalise} Icon={Activity} tone="blue" />
        <StatCard label="Aprovadas hoje" value={stats.aprovadasHoje} Icon={FileCheck2} tone="green" />
        <StatCard label="Reprovadas hoje" value={stats.reprovadasHoje} Icon={FileX2} tone="red" />
        <StatCard label="Docs pendentes" value={stats.docsPendentes} Icon={FileWarning} tone="orange" />
      </div>

      {/* Movimentação */}
      <section className="bg-white border border-neutral-200 rounded-xl p-6">
        <h2 className="text-lg font-bold text-neutral-900 mb-4">Movimentação jurídica de hoje</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MovBar label="Entradas" value={stats.novasHoje} color="bg-neutral-900" />
          <MovBar label="Aprovações" value={stats.aprovadasHoje} color="bg-emerald-600" />
          <MovBar label="Reprovações" value={stats.reprovadasHoje} color="bg-red-600" />
          <MovBar label="Pendentes" value={stats.pendentes} color="bg-amber-500" />
        </div>
      </section>

      {/* Prioridades */}
      <section className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        <div className="p-6 border-b border-neutral-100">
          <h2 className="text-lg font-bold text-neutral-900">Prioridades de análise</h2>
          <p className="text-xs text-neutral-500 mt-1">Ordenadas pelas mais antigas primeiro.</p>
        </div>
        <Table>
          <TableHeader className="bg-neutral-50">
            <TableRow>
              <TableHead className="px-6">Inquilino</TableHead>
              <TableHead>CPF</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Aguardando</TableHead>
              <TableHead className="text-right pr-6">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-12 text-neutral-400">Carregando...</TableCell></TableRow>
            ) : !prioridades.length ? (
              <TableRow><TableCell colSpan={6} className="text-center py-12 text-neutral-500">Nenhuma prioridade no momento.</TableCell></TableRow>
            ) : prioridades.map((c) => {
              const horas = (Date.now() - new Date(c.created_at).getTime()) / (1000 * 60 * 60);
              const urgente = horas > 24;
              return (
                <TableRow key={c.id} className={urgente ? "bg-red-50/40" : ""}>
                  <TableCell className="px-6 font-semibold">{c.tenant_name ?? "—"}</TableCell>
                  <TableCell className="text-xs text-neutral-500">{c.tenant_document ?? "—"}</TableCell>
                  <TableCell className="text-xs uppercase text-neutral-500">{c.role_solicitante ?? "—"}</TableCell>
                  <TableCell><StatusBadge status={c.status} /></TableCell>
                  <TableCell className={`text-xs font-semibold ${urgente ? "text-red-700" : "text-neutral-600"}`}>{tempoAguardando(c.created_at)}</TableCell>
                  <TableCell className="text-right pr-6 space-x-1">
                    {!c.id.startsWith("demo-") ? (
                      <Link to="/consultas/$id/resultado" params={{ id: c.id }}>
                        <Button size="sm" variant="ghost"><Eye size={14} /></Button>
                      </Link>
                    ) : (
                      <Button size="sm" variant="ghost" disabled><Eye size={14} /></Button>
                    )}
                    <Button size="sm" variant="ghost" className="text-emerald-700" onClick={() => aprovar(c.id)}><CheckCircle2 size={14} /></Button>
                    <Button size="sm" variant="ghost" className="text-red-700" onClick={() => reprovar(c.id)}><XCircle size={14} /></Button>
                    <Button size="sm" variant="ghost" className="text-orange-700" onClick={() => solicitarAjuste(c.id)}><FileWarning size={14} /></Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function StatCard({ label, value, Icon, tone }: { label: string; value: number; Icon: any; tone: "neutral" | "amber" | "blue" | "green" | "red" | "orange" }) {
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
      <p className="text-[10px] text-neutral-400 font-bold uppercase tracking-widest mb-1">{label}</p>
      <h3 className="text-3xl font-bold text-neutral-900 tabular-nums">{value}</h3>
    </div>
  );
}

function MovBar({ label, value, color }: { label: string; value: number; color: string }) {
  const max = Math.max(value, 1);
  const pct = Math.min(100, (value / Math.max(max, 5)) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs font-semibold text-neutral-600">{label}</p>
        <p className="text-lg font-bold text-neutral-900 tabular-nums">{value}</p>
      </div>
      <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pendente: { label: "Pendente", cls: "bg-amber-100 text-amber-700 border-amber-200" },
    em_analise: { label: "Em análise", cls: "bg-blue-100 text-blue-700 border-blue-200" },
    aprovado: { label: "Aprovado", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
    reprovado: { label: "Reprovado", cls: "bg-red-100 text-red-700 border-red-200" },
    documentos_pendentes: { label: "Docs pendentes", cls: "bg-orange-100 text-orange-700 border-orange-200" },
    ajuste_solicitado: { label: "Ajuste solicitado", cls: "bg-orange-100 text-orange-700 border-orange-200" },
  };
  const item = map[status] ?? { label: status, cls: "bg-neutral-100 text-neutral-700 border-neutral-200" };
  return <Badge variant="outline" className={item.cls}>{item.label}</Badge>;
}
