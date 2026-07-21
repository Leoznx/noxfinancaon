import { createLazyFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { CalendarClock, Plus, CheckCircle2, XCircle, Clock, AlertTriangle, RefreshCw, ChevronLeft, ChevronRight, CalendarDays, List } from "lucide-react";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  isSameMonth, isSameDay, isToday as isTodayFns, addMonths, subMonths, format,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatDateTime, getSellerContext, isToday, toDatetimeLocal } from "@/lib/vendedor-portal";

export const Route = createLazyFileRoute("/vendedor/agenda")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin"]} moduleKey="agenda">
      <Agenda />
    </ProtectedRoute>
  ),
});

const TIPOS = [
  { v: "reuniao", l: "Reunião" },
  { v: "ligacao", l: "Ligação" },
  { v: "retorno", l: "Retorno" },
  { v: "visita", l: "Visita" },
  { v: "apresentacao", l: "Apresentação" },
  { v: "follow_up", l: "Follow-up" },
  { v: "proposta_enviada", l: "Proposta enviada" },
  { v: "assinatura_pendente", l: "Assinatura pendente" },
  { v: "pos_venda", l: "Pós-venda" },
];

const STATUS = [
  { v: "agendado", l: "Agendado" },
  { v: "confirmado", l: "Confirmado" },
  { v: "remarcado", l: "Remarcado" },
  { v: "em_andamento", l: "Em andamento" },
  { v: "concluido", l: "Concluído" },
  { v: "cancelado", l: "Cancelado" },
  { v: "nao_compareceu", l: "Não compareceu" },
];

const PRIORIDADES = [
  { v: "baixa", l: "Baixa" },
  { v: "normal", l: "Normal" },
  { v: "alta", l: "Alta" },
  { v: "urgente", l: "Urgente" },
];

const LEMBRETES = [
  { v: "none", l: "Sem lembrete" },
  { v: "10", l: "10 min antes" },
  { v: "30", l: "30 min antes" },
  { v: "60", l: "1 h antes" },
  { v: "1440", l: "1 dia antes" },
];

const STATUS_COLOR: Record<string, string> = {
  agendado: "bg-blue-100 text-blue-800",
  confirmado: "bg-emerald-100 text-emerald-800",
  remarcado: "bg-amber-100 text-amber-800",
  em_andamento: "bg-indigo-100 text-indigo-800",
  concluido: "bg-green-100 text-green-800",
  cancelado: "bg-neutral-200 text-neutral-700",
  nao_compareceu: "bg-red-100 text-red-800",
};

// Bolinha por tipo, pra dar pra reconhecer o dia sem abrir nada — reunião de
// empresa e follow-up com lead usam cores bem diferentes de propósito.
const TIPO_DOT: Record<string, string> = {
  reuniao: "bg-indigo-500",
  ligacao: "bg-sky-500",
  retorno: "bg-teal-500",
  visita: "bg-purple-500",
  apresentacao: "bg-fuchsia-500",
  follow_up: "bg-yellow-500",
  proposta_enviada: "bg-blue-500",
  assinatura_pendente: "bg-orange-500",
  pos_venda: "bg-green-500",
};

function chaveDia(data: string | Date) {
  return format(typeof data === "string" ? new Date(data) : data, "yyyy-MM-dd");
}

function Agenda() {
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [filterStatus, setFilterStatus] = useState("todos");
  const [openNew, setOpenNew] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [mesAtual, setMesAtual] = useState(() => startOfMonth(new Date()));
  const [diaSelecionado, setDiaSelecionado] = useState(() => new Date());

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro("");

    try {
      const context = await getSellerContext();
      setSellerId(context.sellerId);
      if (!context.sellerId) {
        setItems([]);
        setLeads([]);
        setErro("Não encontramos um vendedor ativo para este usuário.");
        return;
      }

      const [agendaRes, leadsRes] = await Promise.all([
        supabase
          .from("seller_appointments" as any)
          .select("*, sales_leads(full_name)")
          .eq("seller_id", context.sellerId)
          .order("scheduled_at", { ascending: true }),
        supabase
          .from("sales_leads" as any)
          .select("id, full_name")
          .eq("assigned_seller_id", context.sellerId)
          .order("full_name"),
      ]);

      if (agendaRes.error) throw agendaRes.error;
      if (leadsRes.error) throw leadsRes.error;

      const rows = (agendaRes.data as any[]) ?? [];
      setItems(rows.map((row) => ({ ...row, lead_name: row.sales_leads?.full_name })));
      setLeads((leadsRes.data as any[]) ?? []);
    } catch (e: any) {
      setErro(e.message || "Não foi possível carregar sua agenda.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const filtrados = useMemo(() =>
    filterStatus === "todos" ? items : items.filter((item) => item.status === filterStatus),
    [items, filterStatus],
  );
  const atrasados = useMemo(() =>
    filtrados.filter((item) => new Date(item.scheduled_at) < new Date() && !["concluido", "cancelado"].includes(item.status)),
    [filtrados],
  );

  const itensPorDia = useMemo(() => {
    const mapa = new Map<string, any[]>();
    for (const item of filtrados) {
      const chave = chaveDia(item.scheduled_at);
      const lista = mapa.get(chave) ?? [];
      lista.push(item);
      mapa.set(chave, lista);
    }
    return mapa;
  }, [filtrados]);

  const diasDoCalendario = useMemo(() => {
    const inicio = startOfWeek(startOfMonth(mesAtual), { weekStartsOn: 0 });
    const fim = endOfWeek(endOfMonth(mesAtual), { weekStartsOn: 0 });
    return eachDayOfInterval({ start: inicio, end: fim });
  }, [mesAtual]);

  const itensDoDiaSelecionado = useMemo(
    () => (itensPorDia.get(chaveDia(diaSelecionado)) ?? []).sort(
      (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime(),
    ),
    [itensPorDia, diaSelecionado],
  );

  async function salvar(payload: any) {
    if (!sellerId) { toast.error("Vendedor não identificado."); return; }
    if (!payload.title?.trim()) { toast.error("Informe um título."); return; }
    if (!payload.scheduled_at) { toast.error("Informe data e hora."); return; }

    const data = {
      seller_id: sellerId,
      lead_id: payload.lead_id || null,
      title: payload.title.trim(),
      type: payload.type,
      status: payload.status,
      priority: payload.priority,
      scheduled_at: new Date(payload.scheduled_at).toISOString(),
      reminder_minutes: payload.reminder_minutes && payload.reminder_minutes !== "none" ? Number(payload.reminder_minutes) : null,
      notes: payload.notes || null,
    };

    const result = payload.id
      ? await supabase.from("seller_appointments" as any).update(data).eq("id", payload.id)
      : await supabase.from("seller_appointments" as any).insert(data);

    if (result.error) {
      toast.error(result.error.message);
      return;
    }

    toast.success(payload.id ? "Compromisso atualizado." : "Compromisso criado.");
    setOpenNew(false);
    setEditing(null);
    await carregar();
  }

  async function mudarStatus(id: string, status: string) {
    const { error } = await supabase.from("seller_appointments" as any).update({ status }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Status atualizado.");
    carregar();
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-yellow-100 p-2 text-yellow-700">
              <CalendarClock className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight text-neutral-950">Minha Agenda</h1>
              <p className="text-sm font-medium text-neutral-500">Reuniões, retornos, follow-ups e compromissos comerciais.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-2" onClick={carregar} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
            <FormDialog
              open={openNew}
              setOpen={setOpenNew}
              leads={leads}
              defaultDate={diaSelecionado}
              onSubmit={salvar}
            >
              <Button className="bg-yellow-500 text-black hover:bg-yellow-600"><Plus className="mr-1 h-4 w-4" /> Novo compromisso</Button>
            </FormDialog>
          </div>
        </div>

        {atrasados.length > 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            <p className="text-sm text-red-800">Você tem <b>{atrasados.length}</b> compromisso(s) atrasado(s). Priorize esses contatos.</p>
          </div>
        )}

        {erro && <Estado titulo="Não foi possível carregar a agenda" descricao={erro} erro />}

        {loading ? (
          <Estado titulo="Carregando agenda..." descricao="Buscando seus compromissos reais." />
        ) : !erro && (
          <Tabs defaultValue="calendario" className="w-full">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <TabsList>
                <TabsTrigger value="calendario" className="gap-2"><CalendarDays className="h-4 w-4" /> Calendário</TabsTrigger>
                <TabsTrigger value="lista" className="gap-2"><List className="h-4 w-4" /> Lista ({filtrados.length})</TabsTrigger>
              </TabsList>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-full sm:w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os status</SelectItem>
                  {STATUS.map((status) => <SelectItem key={status.v} value={status.v}>{status.l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <TabsContent value="calendario" className="mt-4">
              <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
                <Card>
                  <CardContent className="p-4">
                    <div className="mb-4 flex items-center justify-between">
                      <p className="text-lg font-black capitalize text-neutral-950">
                        {format(mesAtual, "MMMM 'de' yyyy", { locale: ptBR })}
                      </p>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="outline" onClick={() => setMesAtual((m) => subMonths(m, 1))}><ChevronLeft className="h-4 w-4" /></Button>
                        <Button size="sm" variant="outline" onClick={() => { setMesAtual(startOfMonth(new Date())); setDiaSelecionado(new Date()); }}>Hoje</Button>
                        <Button size="sm" variant="outline" onClick={() => setMesAtual((m) => addMonths(m, 1))}><ChevronRight className="h-4 w-4" /></Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-black uppercase tracking-widest text-neutral-400">
                      {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((dia) => <div key={dia} className="py-2">{dia}</div>)}
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                      {diasDoCalendario.map((dia) => {
                        const doMes = isSameMonth(dia, mesAtual);
                        const hoje = isTodayFns(dia);
                        const selecionado = isSameDay(dia, diaSelecionado);
                        const itensDia = itensPorDia.get(chaveDia(dia)) ?? [];
                        const temAtrasado = itensDia.some((item) => new Date(item.scheduled_at) < new Date() && !["concluido", "cancelado"].includes(item.status));
                        return (
                          <button
                            key={dia.toISOString()}
                            onClick={() => setDiaSelecionado(dia)}
                            className={`flex min-h-[76px] flex-col items-center gap-1 rounded-xl border p-1.5 text-left transition ${
                              selecionado
                                ? "border-yellow-400 bg-yellow-50 ring-2 ring-yellow-200"
                                : hoje
                                  ? "border-yellow-300 bg-yellow-50/40"
                                  : "border-neutral-100 hover:border-neutral-200 hover:bg-neutral-50"
                            } ${!doMes ? "opacity-40" : ""}`}
                          >
                            <span className={`text-xs font-bold ${hoje ? "text-yellow-700" : "text-neutral-700"}`}>{format(dia, "d")}</span>
                            {itensDia.length > 0 && (
                              <div className="flex flex-wrap items-center justify-center gap-0.5">
                                {itensDia.slice(0, 4).map((item) => (
                                  <span key={item.id} className={`h-1.5 w-1.5 rounded-full ${TIPO_DOT[item.type] ?? "bg-neutral-400"}`} />
                                ))}
                                {itensDia.length > 4 && <span className="text-[9px] font-bold text-neutral-400">+{itensDia.length - 4}</span>}
                              </div>
                            )}
                            {temAtrasado && <span className="text-[9px] font-black uppercase text-red-500">Atrasado</span>}
                          </button>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="font-black capitalize text-neutral-950">
                        {isTodayFns(diaSelecionado) ? "Hoje" : format(diaSelecionado, "EEEE, d 'de' MMMM", { locale: ptBR })}
                      </p>
                      <Badge variant="outline">{itensDoDiaSelecionado.length}</Badge>
                    </div>
                    {itensDoDiaSelecionado.length === 0 ? (
                      <Estado titulo="Nada agendado" descricao="Clique em Novo compromisso para agendar um follow-up ou reunião neste dia." />
                    ) : (
                      <div className="space-y-3">
                        {itensDoDiaSelecionado.map((item) => (
                          <LinhaCompacta key={item.id} item={item} onEdit={setEditing} onStatus={mudarStatus} />
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="lista" className="mt-4 space-y-3">
              {filtrados.length === 0 && <Estado titulo="Nenhum compromisso encontrado" descricao="Sua agenda ainda não possui registros neste filtro." />}
              {filtrados.map((item) => <Linha key={item.id} item={item} onEdit={setEditing} onStatus={mudarStatus} />)}
            </TabsContent>
          </Tabs>
        )}

        {editing && (
          <FormDialog open={!!editing} setOpen={(open: boolean) => !open && setEditing(null)} leads={leads} initial={editing} onSubmit={salvar} />
        )}
      </div>
    </DashboardLayout>
  );
}

function LinhaCompacta({ item, onEdit, onStatus }: any) {
  return (
    <div className="rounded-xl border border-neutral-100 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold text-neutral-500">{formatDateTime(item.scheduled_at).split(" ").pop()}</p>
          <p className="truncate font-semibold text-neutral-950">{item.title}</p>
          <p className="text-xs text-neutral-500">
            {TIPOS.find((tipo) => tipo.v === item.type)?.l ?? item.type}
            {item.lead_name && <> · {item.lead_name}</>}
          </p>
        </div>
        <Badge className={`shrink-0 ${STATUS_COLOR[item.status] ?? ""}`}>{STATUS.find((status) => status.v === item.status)?.l ?? item.status}</Badge>
      </div>
      <div className="mt-2 flex gap-1">
        <Button size="sm" variant="outline" className="h-7 flex-1 text-xs" onClick={() => onEdit(item)}>Editar</Button>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" title="Concluir" onClick={() => onStatus(item.id, "concluido")}><CheckCircle2 className="h-3 w-3" /></Button>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" title="Cancelar" onClick={() => onStatus(item.id, "cancelado")}><XCircle className="h-3 w-3" /></Button>
      </div>
    </div>
  );
}

function Linha({ item, onEdit, onStatus }: any) {
  return (
    <Card className="border-neutral-200">
      <CardContent className="flex flex-wrap items-center gap-4 p-4">
        <div className="flex min-w-[170px] items-center gap-2">
          <Clock className="h-4 w-4 text-neutral-400" />
          <span className="text-sm font-bold">{formatDateTime(item.scheduled_at)}</span>
        </div>
        <div className="min-w-[220px] flex-1">
          <p className="font-semibold text-neutral-950">{item.title}</p>
          <p className="text-xs text-neutral-500">
            {TIPOS.find((tipo) => tipo.v === item.type)?.l ?? item.type}
            {item.lead_name && <> · Lead: {item.lead_name}</>}
          </p>
          {item.notes && <p className="mt-1 text-xs text-neutral-500">{item.notes}</p>}
        </div>
        <Badge className={STATUS_COLOR[item.status] ?? ""}>{STATUS.find((status) => status.v === item.status)?.l ?? item.status}</Badge>
        <Badge variant="outline">{PRIORIDADES.find((priority) => priority.v === item.priority)?.l ?? item.priority}</Badge>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={() => onEdit(item)}>Editar</Button>
          <Button size="sm" variant="outline" title="Concluir" onClick={() => onStatus(item.id, "concluido")}><CheckCircle2 className="h-3 w-3" /></Button>
          <Button size="sm" variant="outline" title="Cancelar" onClick={() => onStatus(item.id, "cancelado")}><XCircle className="h-3 w-3" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}

function FormDialog({ open, setOpen, leads, initial, defaultDate, onSubmit, children }: any) {
  const horaPadrao = (data: Date) => {
    const copia = new Date(data);
    copia.setHours(9, 0, 0, 0);
    return toDatetimeLocal(copia.toISOString());
  };

  const [form, setForm] = useState<any>(() => initial ?? {
    title: "",
    type: "reuniao",
    status: "agendado",
    priority: "normal",
    scheduled_at: horaPadrao(defaultDate ?? new Date()),
    reminder_minutes: "none",
    notes: "",
    lead_id: "",
  });

  useEffect(() => {
    if (initial) {
      setForm({
        ...initial,
        scheduled_at: toDatetimeLocal(initial.scheduled_at),
        reminder_minutes: initial.reminder_minutes?.toString() ?? "none",
        lead_id: initial.lead_id ?? "",
      });
    } else if (open && defaultDate) {
      setForm((prev: any) => ({ ...prev, scheduled_at: horaPadrao(defaultDate) }));
    }

  }, [initial, open, defaultDate]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{initial ? "Editar compromisso" : "Novo compromisso"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Título</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Tipo</Label>
              <Select value={form.type} onValueChange={(value) => setForm({ ...form, type: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TIPOS.map((tipo) => <SelectItem key={tipo.v} value={tipo.v}>{tipo.l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Status</Label>
              <Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUS.map((status) => <SelectItem key={status.v} value={status.v}>{status.l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Prioridade</Label>
              <Select value={form.priority} onValueChange={(value) => setForm({ ...form, priority: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORIDADES.map((priority) => <SelectItem key={priority.v} value={priority.v}>{priority.l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Lembrete</Label>
              <Select value={form.reminder_minutes} onValueChange={(value) => setForm({ ...form, reminder_minutes: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{LEMBRETES.map((reminder) => <SelectItem key={reminder.v} value={reminder.v}>{reminder.l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Data e hora</Label><Input type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} /></div>
          {leads.length > 0 && (
            <div><Label>Lead vinculado</Label>
              <Select value={form.lead_id || "none"} onValueChange={(value) => setForm({ ...form, lead_id: value === "none" ? "" : value })}>
                <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum (reunião interna/empresa)</SelectItem>
                  {leads.map((lead: any) => <SelectItem key={lead.id} value={lead.id}>{lead.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div><Label>Observações</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button className="bg-yellow-500 text-black hover:bg-yellow-600" onClick={() => onSubmit(form)}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Estado({ titulo, descricao, erro = false }: { titulo: string; descricao: string; erro?: boolean }) {
  return (
    <div className={`rounded-2xl border p-8 text-center ${erro ? "border-red-200 bg-red-50 text-red-800" : "border-dashed border-neutral-200 bg-white text-neutral-500"}`}>
      <p className="font-bold">{titulo}</p>
      <p className="mt-1 text-sm">{descricao}</p>
    </div>
  );
}
