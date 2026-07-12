import { createFileRoute, Link } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  Eye,
  Mail,
  MessageCircle,
  MoveRight,
  Phone,
  RefreshCw,
  Search,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  LEAD_STATUS,
  defaultFollowUpDate,
  formatDateTime,
  getSellerContext,
  isPastOpenDate,
  isToday,
  leadStatusClass,
  leadStatusLabel,
  normalizeLeadStatus,
  toDatetimeLocal,
  whatsappUrl,
} from "@/lib/vendedor-portal";

export const Route = createFileRoute("/vendedor/leads")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin"]} moduleKey="leads_proprios">
      <MeusLeads />
    </ProtectedRoute>
  ),
});

function MeusLeads() {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState("todos");
  const [followFiltro, setFollowFiltro] = useState("todos");
  const [salvandoId, setSalvandoId] = useState<string | null>(null);
  const [observacoes, setObservacoes] = useState<Record<string, string>>({});
  const [datasFollow, setDatasFollow] = useState<Record<string, string>>({});
  const [detalhe, setDetalhe] = useState<any | null>(null);

  async function carregar() {
    setLoading(true);
    setErro("");

    try {
      const context = await getSellerContext();
      let query = supabase
        .from("sales_leads" as any)
        .select("*, vendedor:assigned_seller_id(id, full_name, email)")
        .order("created_at", { ascending: false });

      if (context.isSeller) {
        query = query.eq("assigned_seller_id", context.sellerId);
      }

      const { data, error } = await query;
      if (error) throw error;

      const lista = ((data as any[]) ?? []).map((lead) => ({
        ...lead,
        status: normalizeLeadStatus(lead.status),
      }));
      setLeads(lista);
      setObservacoes(Object.fromEntries(lista.map((lead) => [lead.id, lead.notes ?? ""])));
      setDatasFollow(Object.fromEntries(lista.map((lead) => [lead.id, toDatetimeLocal(lead.next_action_at)])));
    } catch (e: any) {
      setErro(e.message || "Não foi possível carregar seus leads.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  const leadsFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();

    return leads.filter((lead) => {
      const bateBusca = !termo
        || lead.full_name?.toLowerCase().includes(termo)
        || lead.phone?.toLowerCase().includes(termo)
        || lead.email?.toLowerCase().includes(termo)
        || lead.origin?.toLowerCase().includes(termo)
        || lead.vendedor?.full_name?.toLowerCase().includes(termo);
      const bateStatus = statusFiltro === "todos" || lead.status === statusFiltro;
      const bateFollow = followFiltro === "todos"
        || (followFiltro === "hoje" && lead.status === "em_atendimento" && isToday(lead.next_action_at))
        || (followFiltro === "atrasado" && lead.status === "em_atendimento" && isPastOpenDate(lead.next_action_at));
      return bateBusca && bateStatus && bateFollow;
    });
  }, [leads, busca, statusFiltro, followFiltro]);

  const resumo = useMemo(() => ({
    total: leads.length,
    pendentes: leads.filter((lead) => lead.status === "pendente").length,
    atendimento: leads.filter((lead) => lead.status === "em_atendimento").length,
    atendidos: leads.filter((lead) => lead.status === "atendido").length,
    convertidos: leads.filter((lead) => lead.status === "convertido").length,
    atrasados: leads.filter((lead) => lead.status === "em_atendimento" && isPastOpenDate(lead.next_action_at)).length,
  }), [leads]);

  async function atualizarLead(lead: any, payload: Record<string, any>, successMessage: string) {
    setSalvandoId(lead.id);
    const anterior = leads;
    setLeads((prev) => prev.map((item) => item.id === lead.id ? { ...item, ...payload } : item));

    const { error } = await supabase
      .from("sales_leads" as any)
      .update({ ...payload, last_interaction_at: new Date().toISOString() })
      .eq("id", lead.id);

    if (error) {
      setLeads(anterior);
      toast.error(error.message || "Não foi possível atualizar o lead.");
    } else {
      toast.success(successMessage);
      await carregar();
    }
    setSalvandoId(null);
  }

  async function alterarStatus(lead: any, status: string) {
    const payload: any = {
      status,
      notes: observacoes[lead.id] ?? lead.notes ?? null,
    };

    if (status === "em_atendimento") {
      payload.next_action_at = datasFollow[lead.id]
        ? new Date(datasFollow[lead.id]).toISOString()
        : defaultFollowUpDate().toISOString();
    }

    if (["atendido", "convertido", "perdido"].includes(status)) {
      payload.next_action_at = null;
    }

    await atualizarLead(lead, payload, `Lead marcado como ${leadStatusLabel(status).toLowerCase()}.`);
  }

  async function salvarObservacao(lead: any) {
    await atualizarLead(
      lead,
      { notes: observacoes[lead.id] ?? "" },
      "Observação salva.",
    );
  }

  async function registrarFollowup(lead: any, concluir = false) {
    setSalvandoId(lead.id);
    const data = datasFollow[lead.id] ? new Date(datasFollow[lead.id]).toISOString() : defaultFollowUpDate().toISOString();
    const { error } = await supabase.rpc("registrar_lead_followup" as any, {
      p_lead_id: lead.id,
      p_observacao: observacoes[lead.id] || null,
      p_reagendar_para: concluir ? null : data,
      p_concluir: concluir,
    });

    if (error) {
      toast.error(error.message || "Não foi possível registrar o follow-up.");
    } else {
      toast.success(concluir ? "Lead marcado como atendido." : "Follow-up registrado e reagendado.");
      await carregar();
    }
    setSalvandoId(null);
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-yellow-100 p-2 text-yellow-700">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight text-neutral-950">Meus Leads</h1>
              <p className="text-sm font-medium text-neutral-500">Atenda sua carteira e mantenha o histórico sincronizado com o admin.</p>
            </div>
          </div>
          <Button variant="outline" className="gap-2" onClick={carregar} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <ResumoCard icon={Users} label="Total" value={resumo.total} />
          <ResumoCard icon={Clock} label="Pendentes" value={resumo.pendentes} />
          <ResumoCard icon={CalendarClock} label="Em atendimento" value={resumo.atendimento} />
          <ResumoCard icon={CheckCircle2} label="Atendidos" value={resumo.atendidos} />
          <ResumoCard icon={CheckCircle2} label="Convertidos" value={resumo.convertidos} />
          <ResumoCard icon={Clock} label="Atrasados" value={resumo.atrasados} destaque={resumo.atrasados > 0} />
        </div>

        <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[1fr_220px_220px]">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-neutral-400" />
              <Input className="h-11 pl-9" placeholder="Buscar por nome, telefone, e-mail, origem ou vendedor..." value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
            <Select value={statusFiltro} onValueChange={setStatusFiltro}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                {LEAD_STATUS.map((status) => <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={followFiltro} onValueChange={setFollowFiltro}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos follow-ups</SelectItem>
                <SelectItem value="hoje">Para hoje</SelectItem>
                <SelectItem value="atrasado">Atrasados</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>

        {erro && <EstadoMensagem titulo="Não foi possível carregar os leads" descricao={erro} erro />}

        {loading ? (
          <EstadoMensagem titulo="Carregando seus leads..." descricao="Buscando dados reais da sua carteira." />
        ) : !erro && leadsFiltrados.length === 0 ? (
          <EstadoMensagem titulo="Nenhum lead encontrado" descricao="Quando houver leads distribuídos para você, eles aparecerão aqui." />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {leadsFiltrados.map((lead) => (
              <article key={lead.id} className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <StatusBadge status={lead.status} />
                      <CanalBadge canal={lead.canal} />
                      {lead.origin && <Badge variant="outline" className="text-neutral-500">{lead.origin}</Badge>}
                      {isPastOpenDate(lead.next_action_at) && lead.status === "em_atendimento" && <Badge className="border-red-200 bg-red-100 text-red-700">Follow-up atrasado</Badge>}
                      {isToday(lead.next_action_at) && lead.status === "em_atendimento" && <Badge className="border-yellow-200 bg-yellow-100 text-yellow-800">Follow-up hoje</Badge>}
                    </div>
                    <h2 className="truncate text-xl font-black text-neutral-950">{lead.full_name}</h2>
                    <p className="text-sm text-neutral-500">{lead.city || lead.interest || "Lead comercial NOX"}</p>
                  </div>
                  <Select value={lead.status} onValueChange={(valor) => alterarStatus(lead, valor)}>
                    <SelectTrigger className="h-10 w-full md:w-52"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LEAD_STATUS.map((status) => <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <ContatoItem icon={Phone} label="Telefone" value={lead.phone || "-"} href={lead.phone ? `tel:${lead.phone}` : undefined} />
                  <ContatoItem icon={MessageCircle} label="WhatsApp" value="Abrir conversa" href={whatsappUrl(lead.full_name, lead.phone)} />
                  <ContatoItem icon={Mail} label="E-mail" value={lead.email || "-"} href={lead.email ? `mailto:${lead.email}` : undefined} />
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-[1fr_220px]">
                  <div>
                    <label className="mb-1.5 block text-xs font-black uppercase tracking-widest text-neutral-400">Observações</label>
                    <Textarea
                      className="min-h-[98px]"
                      value={observacoes[lead.id] ?? ""}
                      onChange={(e) => setObservacoes((prev) => ({ ...prev, [lead.id]: e.target.value }))}
                      placeholder="Registre o que aconteceu no contato..."
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-black uppercase tracking-widest text-neutral-400">Próximo follow-up</label>
                    <Input
                      type="datetime-local"
                      value={datasFollow[lead.id] ?? ""}
                      onChange={(e) => setDatasFollow((prev) => ({ ...prev, [lead.id]: e.target.value }))}
                    />
                    <p className="mt-2 text-xs font-medium text-neutral-500">
                      Atual: {formatDateTime(lead.next_action_at) || "sem follow-up"}
                    </p>
                  </div>
                </div>

                <div className="mt-5 flex flex-col gap-2 md:flex-row md:flex-wrap md:justify-end">
                  <Button variant="outline" className="gap-2" onClick={() => setDetalhe(lead)}>
                    <Eye className="h-4 w-4" />
                    Ver detalhes
                  </Button>
                  <Button variant="outline" onClick={() => salvarObservacao(lead)} disabled={salvandoId === lead.id}>
                    Salvar observação
                  </Button>
                  <Button variant="outline" onClick={() => registrarFollowup(lead)} disabled={salvandoId === lead.id || ["atendido", "convertido", "perdido"].includes(lead.status)}>
                    Agendar follow-up
                  </Button>
                  <Button variant="outline" className="gap-2" onClick={() => alterarStatus(lead, "perdido")} disabled={salvandoId === lead.id}>
                    <XCircle className="h-4 w-4" />
                    Perdido
                  </Button>
                  <Button className="gap-2 bg-neutral-950 text-white hover:bg-neutral-800" onClick={() => alterarStatus(lead, "convertido")} disabled={salvandoId === lead.id}>
                    <CheckCircle2 className="h-4 w-4" />
                    Convertido
                  </Button>
                  <Button asChild variant="outline" className="gap-2" onClick={() => alterarStatus(lead, "em_atendimento")}>
                    <Link to="/vendedor/pipeline">
                      <MoveRight className="h-4 w-4" />
                      Pipeline
                    </Link>
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}

        <Dialog open={!!detalhe} onOpenChange={(open) => !open && setDetalhe(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Detalhes do lead</DialogTitle></DialogHeader>
            {detalhe && (
              <div className="grid gap-3 text-sm md:grid-cols-2">
                <Info label="Nome" value={detalhe.full_name} />
                <Info label="Status" value={leadStatusLabel(detalhe.status)} />
                <Info label="Telefone" value={detalhe.phone || "-"} />
                <Info label="E-mail" value={detalhe.email || "-"} />
                <Info label="Canal" value={detalhe.canal === "trafego_pago" ? "Tráfego Pago" : "Orgânico"} />
                <Info label="Origem" value={detalhe.origin || "-"} />
                <Info label="Entrada" value={formatDateTime(detalhe.created_at)} />
                <Info label="Última atualização" value={formatDateTime(detalhe.updated_at)} />
                <Info label="Próximo follow-up" value={formatDateTime(detalhe.next_action_at) || "-"} />
                <Info label="Responsável" value={detalhe.vendedor?.full_name || "-"} />
                <Info label="Cidade/interesse" value={detalhe.city || detalhe.interest || "-"} />
                <div className="md:col-span-2">
                  <p className="text-xs font-black uppercase tracking-widest text-neutral-400">Observações</p>
                  <p className="mt-1 rounded-xl bg-neutral-50 p-3 font-medium text-neutral-800">{detalhe.notes || "Sem observações."}</p>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

function ResumoCard({ icon: Icon, label, value, destaque = false }: any) {
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm ${destaque ? "border-yellow-300" : "border-neutral-200"}`}>
      <Icon className={`mb-3 h-4 w-4 ${destaque ? "text-yellow-700" : "text-neutral-400"}`} />
      <p className="text-xs font-medium text-neutral-500">{label}</p>
      <p className="text-2xl font-black text-neutral-950">{value}</p>
    </div>
  );
}

function ContatoItem({ icon: Icon, label, value, href }: any) {
  const content = (
    <div className="rounded-xl border border-neutral-100 bg-neutral-50 p-3 transition hover:border-yellow-200 hover:bg-yellow-50">
      <Icon className="mb-2 h-4 w-4 text-yellow-700" />
      <p className="text-[10px] font-black uppercase tracking-widest text-neutral-400">{label}</p>
      <p className="truncate text-sm font-bold text-neutral-900">{value}</p>
    </div>
  );
  if (!href) return content;
  return <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{content}</a>;
}

function StatusBadge({ status }: { status: string }) {
  return <Badge className={leadStatusClass(status)}>{leadStatusLabel(status)}</Badge>;
}

function CanalBadge({ canal }: { canal?: string | null }) {
  const pago = canal === "trafego_pago";
  return (
    <Badge className={pago ? "border-purple-200 bg-purple-100 text-purple-800" : "border-emerald-200 bg-emerald-100 text-emerald-800"}>
      {pago ? "Tráfego Pago" : "Orgânico"}
    </Badge>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-black uppercase tracking-widest text-neutral-400">{label}</p>
      <p className="mt-1 font-bold text-neutral-900">{value}</p>
    </div>
  );
}

function EstadoMensagem({ titulo, descricao, erro = false }: { titulo: string; descricao: string; erro?: boolean }) {
  return (
    <div className={`rounded-2xl border p-12 text-center ${erro ? "border-red-200 bg-red-50 text-red-800" : "border-dashed border-neutral-200 bg-white text-neutral-500"}`}>
      <p className="font-bold">{titulo}</p>
      <p className="mt-1 text-sm">{descricao}</p>
    </div>
  );
}
