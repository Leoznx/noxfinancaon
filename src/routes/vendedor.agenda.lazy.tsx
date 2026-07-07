import { createLazyFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { CalendarClock, Plus, CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";

export const Route = createLazyFileRoute("/vendedor/agenda")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin"]}>
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
  { v: "", l: "Sem lembrete" },
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

const DEMO = [
  { id: "d1", title: "Reunião com João da Silva", type: "reuniao", status: "agendado", priority: "alta", scheduled_at: new Date(Date.now() + 3600e3).toISOString(), lead_name: "João da Silva", notes: "Apresentação inicial" },
  { id: "d2", title: "Retorno para Maria Oliveira", type: "retorno", status: "confirmado", priority: "normal", scheduled_at: new Date(Date.now() + 2 * 3600e3).toISOString(), lead_name: "Maria Oliveira" },
  { id: "d3", title: "Apresentação para Carlos Mendes", type: "apresentacao", status: "agendado", priority: "alta", scheduled_at: new Date(Date.now() + 5 * 3600e3).toISOString(), lead_name: "Carlos Mendes" },
  { id: "d4", title: "Follow-up Ana Costa", type: "follow_up", status: "remarcado", priority: "urgente", scheduled_at: new Date(Date.now() + 7 * 3600e3).toISOString(), lead_name: "Ana Costa" },
];

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
function isToday(iso: string) {
  const d = new Date(iso); const n = new Date();
  return d.toDateString() === n.toDateString();
}

function Agenda() {
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [filterStatus, setFilterStatus] = useState("todos");
  const [openNew, setOpenNew] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const carregar = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: iu } = await supabase.from("internal_users" as any)
      .select("id").eq("auth_user_id", user.id).maybeSingle();
    const sid = (iu as any)?.id ?? null;
    setSellerId(sid);
    if (!sid) { setItems(DEMO); return; }
    const { data } = await supabase.from("seller_appointments" as any)
      .select("*, sales_leads(full_name)")
      .eq("seller_id", sid)
      .order("scheduled_at", { ascending: true });
    const rows = (data as any[]) ?? [];
    setItems(rows.length ? rows.map((r) => ({ ...r, lead_name: r.sales_leads?.full_name })) : DEMO);
    const { data: ld } = await supabase.from("sales_leads" as any)
      .select("id, full_name").eq("assigned_seller_id", sid).order("full_name");
    setLeads((ld as any[]) ?? []);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const filtrados = useMemo(() =>
    filterStatus === "todos" ? items : items.filter((i) => i.status === filterStatus),
    [items, filterStatus]
  );
  const hoje = useMemo(() => filtrados.filter((i) => isToday(i.scheduled_at)), [filtrados]);
  const atrasados = useMemo(() =>
    filtrados.filter((i) => new Date(i.scheduled_at) < new Date() && !["concluido", "cancelado"].includes(i.status)),
    [filtrados]
  );

  async function salvar(payload: any) {
    if (!sellerId) { toast.error("Vendedor não identificado."); return; }
    const data = {
      seller_id: sellerId,
      lead_id: payload.lead_id || null,
      title: payload.title,
      type: payload.type,
      status: payload.status,
      priority: payload.priority,
      scheduled_at: new Date(payload.scheduled_at).toISOString(),
      reminder_minutes: payload.reminder_minutes ? Number(payload.reminder_minutes) : null,
      notes: payload.notes || null,
    };
    if (payload.id) {
      const { error } = await supabase.from("seller_appointments" as any).update(data).eq("id", payload.id);
      if (error) return toast.error(error.message);
      toast.success("Compromisso atualizado");
    } else {
      const { error } = await supabase.from("seller_appointments" as any).insert(data);
      if (error) return toast.error(error.message);
      toast.success("Compromisso criado");
    }
    setOpenNew(false); setEditing(null); await carregar();
  }

  async function mudarStatus(id: string, status: string) {
    if (String(id).startsWith("d")) { toast.info("Exemplo demo"); return; }
    const { error } = await supabase.from("seller_appointments" as any).update({ status }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Status atualizado"); carregar();
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <CalendarClock className="w-7 h-7 text-yellow-600" />
            <div>
              <h1 className="text-2xl font-bold">Minha Agenda</h1>
              <p className="text-sm text-muted-foreground">Reuniões, retornos, follow-ups e compromissos comerciais.</p>
            </div>
          </div>
          <FormDialog open={openNew} setOpen={setOpenNew} leads={leads} onSubmit={salvar}>
            <Button className="bg-yellow-500 hover:bg-yellow-600 text-black"><Plus className="w-4 h-4 mr-1" /> Novo compromisso</Button>
          </FormDialog>
        </div>

        {atrasados.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            <p className="text-sm text-red-800">Você tem <b>{atrasados.length}</b> compromisso(s) atrasado(s). Priorize esses contatos.</p>
          </div>
        )}

        <div className="flex items-center gap-3">
          <Label className="text-sm">Filtro:</Label>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {STATUS.map((s) => <SelectItem key={s.v} value={s.v}>{s.l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <Tabs defaultValue="hoje" className="w-full">
          <TabsList>
            <TabsTrigger value="hoje">Hoje ({hoje.length})</TabsTrigger>
            <TabsTrigger value="lista">Lista ({filtrados.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="hoje" className="space-y-3 mt-4">
            {hoje.length === 0 && <p className="text-sm text-muted-foreground">Nada agendado para hoje.</p>}
            {hoje.map((i) => <Linha key={i.id} item={i} onEdit={setEditing} onStatus={mudarStatus} />)}
          </TabsContent>
          <TabsContent value="lista" className="space-y-3 mt-4">
            {filtrados.length === 0 && <p className="text-sm text-muted-foreground">Sem compromissos.</p>}
            {filtrados.map((i) => <Linha key={i.id} item={i} onEdit={setEditing} onStatus={mudarStatus} />)}
          </TabsContent>
        </Tabs>

        {editing && (
          <FormDialog open={!!editing} setOpen={(o: boolean) => !o && setEditing(null)} leads={leads} initial={editing} onSubmit={salvar} />
        )}
      </div>
    </DashboardLayout>
  );
}

function Linha({ item, onEdit, onStatus }: any) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2 min-w-[150px]">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">{fmtDateTime(item.scheduled_at)}</span>
        </div>
        <div className="flex-1 min-w-[200px]">
          <p className="font-semibold">{item.title}</p>
          <p className="text-xs text-muted-foreground">
            {TIPOS.find((t) => t.v === item.type)?.l ?? item.type}
            {item.lead_name && <> · Lead: {item.lead_name}</>}
          </p>
        </div>
        <Badge className={STATUS_COLOR[item.status] ?? ""}>{STATUS.find((s) => s.v === item.status)?.l ?? item.status}</Badge>
        <Badge variant="outline">{PRIORIDADES.find((p) => p.v === item.priority)?.l ?? item.priority}</Badge>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={() => onEdit(item)}>Editar</Button>
          <Button size="sm" variant="outline" onClick={() => onStatus(item.id, "concluido")}><CheckCircle2 className="w-3 h-3" /></Button>
          <Button size="sm" variant="outline" onClick={() => onStatus(item.id, "cancelado")}><XCircle className="w-3 h-3" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}

function FormDialog({ open, setOpen, leads, initial, onSubmit, children }: any) {
  const [form, setForm] = useState<any>(() => initial ?? {
    title: "", type: "reuniao", status: "agendado", priority: "normal",
    scheduled_at: new Date(Date.now() + 3600e3).toISOString().slice(0, 16),
    reminder_minutes: "", notes: "", lead_id: "",
  });
  useEffect(() => {
    if (initial) {
      setForm({
        ...initial,
        scheduled_at: new Date(initial.scheduled_at).toISOString().slice(0, 16),
        reminder_minutes: initial.reminder_minutes?.toString() ?? "",
        lead_id: initial.lead_id ?? "",
      });
    }
  }, [initial]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{initial ? "Editar compromisso" : "Novo compromisso"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Título</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Tipo</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TIPOS.map((t) => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUS.map((s) => <SelectItem key={s.v} value={s.v}>{s.l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Prioridade</Label>
              <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORIDADES.map((p) => <SelectItem key={p.v} value={p.v}>{p.l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Lembrete</Label>
              <Select value={form.reminder_minutes} onValueChange={(v) => setForm({ ...form, reminder_minutes: v })}>
                <SelectTrigger><SelectValue placeholder="Sem lembrete" /></SelectTrigger>
                <SelectContent>{LEMBRETES.map((r) => <SelectItem key={r.v || "none"} value={r.v || "none"}>{r.l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Data e hora</Label>
            <Input type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} />
          </div>
          {leads.length > 0 && (
            <div><Label>Lead vinculado</Label>
              <Select value={form.lead_id || "none"} onValueChange={(v) => setForm({ ...form, lead_id: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {leads.map((l: any) => <SelectItem key={l.id} value={l.id}>{l.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div><Label>Observações</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button className="bg-yellow-500 hover:bg-yellow-600 text-black" onClick={() => onSubmit({
            ...form,
            reminder_minutes: form.reminder_minutes === "none" ? "" : form.reminder_minutes,
          })}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
