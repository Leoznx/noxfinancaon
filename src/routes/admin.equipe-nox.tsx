import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  Users2,
  Target,
  Bell,
  DollarSign,
  ChevronLeft,
  ChevronRight,
  Users,
  Briefcase,
  Gift,
  History,
  Clock3,
} from "lucide-react";
import { z } from "zod";
import { addMonths, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth } from "@/components/AuthProvider";
import { registrarAuditoria } from "@/lib/auditoria";
import { formatMoney, formatDateTime, toDatetimeLocal } from "@/lib/vendedor-portal";
import {
  fetchSellerTeamMonthlyProgress,
  type SellerTeamMonthlyProgress,
} from "@/lib/seller-progress";
import { TabAuditoria, TabColaboradores, TabEquipeComercial } from "./admin.equipe-permissoes";
import { SellerRewardsTab } from "@/components/admin/SellerRewardsTab";
import { TimeClockHistoryTab } from "@/components/admin/TimeClockHistoryTab";

const VALID_TABS = [
  "metas",
  "recompensas",
  "agenda",
  "comissoes",
  "colaboradores",
  "equipe-comercial",
  "historico-ponto",
  "auditoria",
] as const;
type TabKey = (typeof VALID_TABS)[number];

const searchSchema = z.object({ tab: z.enum(VALID_TABS).optional() });

export const Route = createFileRoute("/admin/equipe-nox")({
  validateSearch: (s) => searchSchema.parse(s),
  component: () => (
    <ProtectedRoute roles={["admin", "admin_master", "analista"]} moduleKey="equipe_nox">
      <EquipeNoxPage />
    </ProtectedRoute>
  ),
});

function EquipeNoxPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const search = useSearch({ from: "/admin/equipe-nox" });
  const activeTab: TabKey = (search.tab as TabKey) ?? "metas";
  const setTab = (t: TabKey) =>
    navigate({ to: "/admin/equipe-nox", search: { tab: t } as any, replace: true });
  const canManageTimeClock = user?.role === "admin" || user?.role === "admin_master" || user?.internalRole === "admin_master";

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-yellow-100 p-2 text-yellow-700">
            <Users2 className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-neutral-950">Equipe NOX</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Metas, jornada, agenda, comissões, colaboradores e auditoria em um só lugar.
            </p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList className="h-auto w-full flex-wrap justify-start">
            <TabsTrigger value="metas">
              <Target className="mr-2 h-4 w-4" />
              Metas
            </TabsTrigger>
            <TabsTrigger value="recompensas">
              <Gift className="mr-2 h-4 w-4" />
              Recompensas
            </TabsTrigger>
            <TabsTrigger value="agenda">
              <Bell className="mr-2 h-4 w-4" />
              Agenda
            </TabsTrigger>
            <TabsTrigger value="comissoes">
              <DollarSign className="mr-2 h-4 w-4" />
              Comissões
            </TabsTrigger>
            <TabsTrigger value="colaboradores">
              <Users className="mr-2 h-4 w-4" />
              Colaboradores
            </TabsTrigger>
            <TabsTrigger value="equipe-comercial">
              <Briefcase className="mr-2 h-4 w-4" />
              Equipe Comercial
            </TabsTrigger>
            {canManageTimeClock && <TabsTrigger value="historico-ponto">
              <Clock3 className="mr-2 h-4 w-4" />
              Histórico de ponto
            </TabsTrigger>}
            <TabsTrigger value="auditoria">
              <History className="mr-2 h-4 w-4" />
              Auditoria
            </TabsTrigger>
          </TabsList>
          <TabsContent value="metas" className="mt-4">
            <TabMetas />
          </TabsContent>
          <TabsContent value="recompensas" className="mt-4">
            <SellerRewardsTab />
          </TabsContent>
          <TabsContent value="agenda" className="mt-4">
            <TabAgenda />
          </TabsContent>
          <TabsContent value="comissoes" className="mt-4">
            <TabComissoes />
          </TabsContent>
          <TabsContent value="colaboradores" className="mt-4">
            <TabColaboradores />
          </TabsContent>
          <TabsContent value="equipe-comercial" className="mt-4">
            <TabEquipeComercial />
          </TabsContent>
          {canManageTimeClock && <TabsContent value="historico-ponto" className="mt-4">
            <TimeClockHistoryTab />
          </TabsContent>}
          <TabsContent value="auditoria" className="mt-4">
            <TabAuditoria />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function SeletorMes({
  month,
  year,
  onChange,
}: {
  month: number;
  year: number;
  onChange: (m: number, y: number) => void;
}) {
  const label = format(new Date(year, month - 1, 1), "MMMM 'de' yyyy", { locale: ptBR });
  const mudar = (delta: number) => {
    const data = addMonths(new Date(year, month - 1, 1), delta);
    onChange(data.getMonth() + 1, data.getFullYear());
  };
  return (
    <div className="flex items-center gap-1">
      <Button size="sm" variant="outline" onClick={() => mudar(-1)}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="w-36 text-center text-sm font-bold capitalize">{label}</span>
      <Button size="sm" variant="outline" onClick={() => mudar(1)}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

/* ===================== METAS ===================== */
function TabMetas() {
  const { user } = useAuth();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [linhas, setLinhas] = useState<SellerTeamMonthlyProgress[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [salvandoId, setSalvandoId] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      setLinhas(await fetchSellerTeamMonthlyProgress(month, year));
      setEdits({});
    } catch (error: any) {
      toast.error(error.message || "Não foi possível carregar as metas da equipe.");
    } finally {
      setLoading(false);
    }
  }, [month, year]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    const refresh = () => void carregar();
    const channel = supabase
      .channel("admin-seller-goals-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "seller_goals" }, refresh)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_appointments" },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_client_partnerships" },
        refresh,
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "apolices" }, refresh)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [carregar]);

  const salvar = async (linha: SellerTeamMonthlyProgress) => {
    const edit = edits[linha.seller_id] ??
      (linha.target_clients == null ? "" : String(linha.target_clients));
    const targetClients = Number(edit);
    if (edit.trim() === "" || !Number.isInteger(targetClients) || targetClients < 0) {
      toast.error("Preencha a meta de cadastros com um número inteiro igual ou maior que zero.");
      return;
    }
    setSalvandoId(linha.seller_id);
    const { error } = await supabase.from("seller_goals" as any).upsert(
      {
        seller_id: linha.seller_id,
        month,
        year,
        target_meetings: 0,
        target_clients: targetClients,
        target_contracts: 0,
      },
      { onConflict: "seller_id,month,year" },
    );
    setSalvandoId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Meta de cadastros de ${linha.seller_name} atualizada.`);
    registrarAuditoria({
      actorUserId: user?.id,
      actorRole: user?.internalRole || user?.role,
      action: "definir_metas_mensais",
      tableName: "seller_goals",
      recordId: linha.seller_id,
      before: {
        target_meetings: linha.target_meetings,
        target_clients: linha.target_clients,
        target_contracts: linha.target_contracts,
        month,
        year,
      },
      after: {
        target_meetings: 0,
        target_clients: targetClients,
        target_contracts: 0,
        month,
        year,
      },
    });
    void carregar();
  };

  const updateEdit = (linha: SellerTeamMonthlyProgress, value: string) => {
    setEdits((current) => ({ ...current, [linha.seller_id]: value }));
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>Meta mensal de cadastros por vendedor</CardTitle>
          <p className="text-sm text-muted-foreground">
            Defina a prioridade de novos parceiros cadastrados. O progresso é automático e atualizado em tempo real.
          </p>
        </div>
        <SeletorMes
          month={month}
          year={year}
          onChange={(m, y) => {
            setMonth(m);
            setYear(y);
          }}
        />
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>
        ) : linhas.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhum vendedor ativo cadastrado.
          </p>
        ) : (
          linhas.map((linha) => {
            const edit = edits[linha.seller_id];
            return (
              <div
                key={linha.seller_id}
                className="space-y-4 rounded-xl border border-neutral-100 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-bold text-neutral-950">{linha.seller_name}</p>
                  <Button
                    size="sm"
                    disabled={salvandoId === linha.seller_id}
                    onClick={() => salvar(linha)}
                  >
                    {salvandoId === linha.seller_id ? "Salvando…" : "Salvar meta"}
                  </Button>
                </div>
                <div className="grid gap-3 lg:grid-cols-1">
                  <MetaEditor
                    label="Cadastros realizados"
                    current={linha.clients_registered}
                    target={linha.target_clients}
                    value={
                      edit ??
                      (linha.target_clients == null ? "" : String(linha.target_clients))
                    }
                    onChange={(value) => updateEdit(linha, value)}
                  />
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function MetaEditor({
  label,
  current,
  target,
  value,
  onChange,
}: {
  label: string;
  current: number;
  target: number | null;
  value: string;
  onChange: (value: string) => void;
}) {
  const pct = target && target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  return (
    <div className="rounded-xl bg-neutral-50 p-3">
      <Label className="text-xs font-bold">{label}</Label>
      <div className="mt-2 flex items-center gap-2">
        <Input
          type="number"
          min={0}
          step={1}
          value={value}
          placeholder="Definir"
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="shrink-0 text-xs font-bold text-neutral-500">{current} feitos</span>
      </div>
      <Progress value={pct} className="mt-2 h-2" />
    </div>
  );
}

/* ===================== AGENDA ===================== */
const STATUS_LABEL: Record<string, string> = {
  agendado: "Agendado",
  confirmado: "Confirmado",
  remarcado: "Remarcado",
  em_andamento: "Em andamento",
  concluido: "Concluído",
  cancelado: "Cancelado",
  nao_compareceu: "Não compareceu",
};
const STATUS_COLOR: Record<string, string> = {
  agendado: "bg-blue-100 text-blue-800",
  confirmado: "bg-emerald-100 text-emerald-800",
  remarcado: "bg-amber-100 text-amber-800",
  em_andamento: "bg-indigo-100 text-indigo-800",
  concluido: "bg-green-100 text-green-800",
  cancelado: "bg-neutral-200 text-neutral-700",
  nao_compareceu: "bg-red-100 text-red-800",
};

function TabAgenda() {
  const { user } = useAuth();
  const [vendedores, setVendedores] = useState<any[]>([]);
  const [grupos, setGrupos] = useState<{ id: string; rows: any[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [destino, setDestino] = useState<"geral" | "individual">("geral");
  const [sellerId, setSellerId] = useState("");
  const [titulo, setTitulo] = useState("");
  const [dataHora, setDataHora] = useState(() => toDatetimeLocal());
  const [notas, setNotas] = useState("");
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    const [{ data: vs }, { data: rows }] = await Promise.all([
      supabase
        .from("internal_users" as any)
        .select("id, full_name")
        .eq("role", "vendedor")
        .eq("status", "ativo")
        .order("full_name"),
      supabase
        .from("seller_appointments" as any)
        .select("*, internal_users(full_name)")
        .not("meeting_group_id", "is", null)
        .order("scheduled_at", { ascending: false }),
    ]);
    setVendedores((vs as any[]) ?? []);
    const mapa = new Map<string, any[]>();
    for (const row of (rows as any[]) ?? []) {
      const lista = mapa.get(row.meeting_group_id) ?? [];
      lista.push(row);
      mapa.set(row.meeting_group_id, lista);
    }
    setGrupos(Array.from(mapa.entries()).map(([id, groupRows]) => ({ id, rows: groupRows })));
    setLoading(false);
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const criar = async () => {
    if (!titulo.trim()) {
      toast.error("Informe um título para a reunião.");
      return;
    }
    if (destino === "individual" && !sellerId) {
      toast.error("Selecione o vendedor.");
      return;
    }
    if (vendedores.length === 0) {
      toast.error("Nenhum vendedor ativo cadastrado.");
      return;
    }

    setSalvando(true);
    const groupId = crypto.randomUUID();
    const alvos = destino === "geral" ? vendedores.map((v) => v.id) : [sellerId];
    const scheduledIso = new Date(dataHora).toISOString();
    const linhas = alvos.map((id) => ({
      seller_id: id,
      meeting_group_id: groupId,
      title: titulo.trim(),
      type: "reuniao",
      status: "agendado",
      priority: "normal",
      scheduled_at: scheduledIso,
      notes: notas || null,
      lead_id: null,
    }));
    const { error } = await supabase.from("seller_appointments" as any).insert(linhas);
    setSalvando(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(
      destino === "geral"
        ? `Reunião agendada para ${alvos.length} vendedores.`
        : "Reunião agendada.",
    );
    registrarAuditoria({
      actorUserId: user?.id,
      actorRole: user?.internalRole || user?.role,
      action: "criar_reuniao_equipe",
      tableName: "seller_appointments",
      recordId: groupId,
      after: {
        title: titulo.trim(),
        destino,
        vendedores: alvos.length,
        scheduled_at: scheduledIso,
      },
    });
    setTitulo("");
    setNotas("");
    carregar();
  };

  const cancelarGrupo = async (groupId: string) => {
    const { error } = await supabase
      .from("seller_appointments" as any)
      .update({ status: "cancelado" })
      .eq("meeting_group_id", groupId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Reunião cancelada.");
    registrarAuditoria({
      actorUserId: user?.id,
      actorRole: user?.internalRole || user?.role,
      action: "cancelar_reuniao_equipe",
      tableName: "seller_appointments",
      recordId: groupId,
      after: { status: "cancelado" },
    });
    carregar();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Nova reunião de equipe</CardTitle>
          <p className="text-sm text-muted-foreground">
            Agende uma reunião individual com um vendedor ou geral para todos os vendedores ativos.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setDestino("geral")}
              className={`rounded-md border px-3 py-1.5 text-xs font-bold ${destino === "geral" ? "border-yellow-400 bg-yellow-50 text-yellow-800" : "bg-white"}`}
            >
              Geral (todos os vendedores)
            </button>
            <button
              type="button"
              onClick={() => setDestino("individual")}
              className={`rounded-md border px-3 py-1.5 text-xs font-bold ${destino === "individual" ? "border-yellow-400 bg-yellow-50 text-yellow-800" : "bg-white"}`}
            >
              Individual
            </button>
          </div>
          {destino === "individual" && (
            <Select value={sellerId} onValueChange={setSellerId}>
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue placeholder="Selecione o vendedor" />
              </SelectTrigger>
              <SelectContent>
                {vendedores.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Input
            placeholder="Título da reunião"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
          />
          <Input
            type="datetime-local"
            value={dataHora}
            onChange={(e) => setDataHora(e.target.value)}
          />
          <Textarea
            placeholder="Pauta / observações (opcional)"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
          />
          <Button
            className="bg-yellow-500 text-black hover:bg-yellow-600"
            disabled={salvando}
            onClick={criar}
          >
            {salvando ? "Agendando…" : "Agendar reunião"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reuniões agendadas pela Equipe NOX</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : grupos.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma reunião de equipe agendada ainda.
            </p>
          ) : (
            grupos.map((grupo) => {
              const primeira = grupo.rows[0];
              const todosMesmoStatus = grupo.rows.every((r) => r.status === primeira.status);
              const alvo =
                grupo.rows.length > 1 && grupo.rows.length === vendedores.length
                  ? `Todos os vendedores (${grupo.rows.length})`
                  : grupo.rows
                      .map((r) => r.internal_users?.full_name)
                      .filter(Boolean)
                      .join(", ");
              return (
                <div key={grupo.id} className="rounded-xl border border-neutral-100 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-neutral-950">{primeira.title}</p>
                      <p className="text-xs text-neutral-500">
                        {formatDateTime(primeira.scheduled_at)} · {alvo}
                      </p>
                      {primeira.notes && (
                        <p className="mt-1 text-xs text-neutral-500">{primeira.notes}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        className={
                          todosMesmoStatus
                            ? (STATUS_COLOR[primeira.status] ?? "")
                            : "bg-neutral-200 text-neutral-700"
                        }
                      >
                        {todosMesmoStatus
                          ? (STATUS_LABEL[primeira.status] ?? primeira.status)
                          : "Misto"}
                      </Badge>
                      {primeira.status !== "cancelado" && (
                        <Button size="sm" variant="outline" onClick={() => cancelarGrupo(grupo.id)}>
                          Cancelar
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ===================== COMISSÕES ===================== */
const STATUS_COMISSAO = [
  { v: "aguardando_primeira_parcela", l: "Aguardando 1ª parcela" },
  { v: "pendente", l: "Pendente" },
  { v: "elegivel", l: "Elegível" },
  { v: "retida", l: "Retida" },
  { v: "liberada_parcial", l: "Liberada parcial" },
  { v: "liberada_total", l: "Liberada total" },
  { v: "estornada", l: "Estornada" },
  { v: "cancelada", l: "Cancelada" },
];

function TabComissoes() {
  const { user } = useAuth();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [vendedores, setVendedores] = useState<any[]>([]);
  const [linhas, setLinhas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [openNovo, setOpenNovo] = useState(false);
  const [editando, setEditando] = useState<any | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    const [{ data: vs }, { data: rows }] = await Promise.all([
      supabase
        .from("internal_users" as any)
        .select("id, full_name")
        .eq("role", "vendedor")
        .eq("status", "ativo")
        .order("full_name"),
      supabase
        .from("seller_commissions" as any)
        .select("*, internal_users(full_name)")
        .eq("month", month)
        .eq("year", year)
        .order("created_at", { ascending: false }),
    ]);
    setVendedores((vs as any[]) ?? []);
    setLinhas((rows as any[]) ?? []);
    setLoading(false);
  }, [month, year]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const salvar = async (form: any) => {
    if (!form.seller_id) {
      toast.error("Selecione o vendedor.");
      return;
    }
    const payload = {
      seller_id: form.seller_id,
      month,
      year,
      commission_amount: Number(form.commission_amount || 0),
      bonus_amount: Number(form.bonus_amount || 0),
      reserve_amount: Number(form.reserve_amount || 0),
      released_amount: Number(form.released_amount || 0),
      status: form.status,
    };
    const result = form.id
      ? await supabase
          .from("seller_commissions" as any)
          .update(payload)
          .eq("id", form.id)
      : await supabase.from("seller_commissions" as any).insert(payload);
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    toast.success(form.id ? "Comissão atualizada." : "Comissão lançada.");
    registrarAuditoria({
      actorUserId: user?.id,
      actorRole: user?.internalRole || user?.role,
      action: form.id ? "editar_comissao_manual" : "lancar_comissao_manual",
      tableName: "seller_commissions",
      recordId: form.id ?? form.seller_id,
      after: payload,
    });
    setOpenNovo(false);
    setEditando(null);
    carregar();
  };

  const totalMes = linhas.reduce(
    (s, l) => s + Number(l.commission_amount ?? 0) + Number(l.bonus_amount ?? 0),
    0,
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Comissões da equipe</CardTitle>
            <p className="text-sm text-muted-foreground">
              Lance ou ajuste comissões manuais por vendedor. Total do mês: {formatMoney(totalMes)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SeletorMes
              month={month}
              year={year}
              onChange={(m, y) => {
                setMonth(m);
                setYear(y);
              }}
            />
            <ComissaoFormDialog
              open={openNovo}
              setOpen={setOpenNovo}
              vendedores={vendedores}
              onSubmit={salvar}
            >
              <Button size="sm">Lançar comissão</Button>
            </ComissaoFormDialog>
          </div>
        </CardHeader>
        <CardContent>
          {/* Mobile/tablet estreito (< md): cards empilhados, sem tabela pra arrastar. */}
          <div className="md:hidden divide-y divide-neutral-100">
            {loading ? (
              <p className="py-6 text-center text-sm">Carregando…</p>
            ) : linhas.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nenhuma comissão lançada neste mês.
              </p>
            ) : (
              linhas.map((l) => (
                <div key={l.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium">{l.internal_users?.full_name ?? "—"}</p>
                    <Badge variant="outline" className="shrink-0">
                      {STATUS_COMISSAO.find((s) => s.v === l.status)?.l ?? l.status}
                    </Badge>
                  </div>
                  <div className="mt-1.5 text-xs text-neutral-500">
                    Comissão {formatMoney(l.commission_amount)} · Bônus{" "}
                    {formatMoney(l.bonus_amount)} · Reserva {formatMoney(l.reserve_amount)} ·
                    Liberado {formatMoney(l.released_amount)}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={() => setEditando(l)}
                  >
                    Editar
                  </Button>
                </div>
              ))
            )}
          </div>

          {/* Tablet/desktop (md:+): tabela completa. */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendedor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Comissão</TableHead>
                  <TableHead>Bônus</TableHead>
                  <TableHead>Reserva</TableHead>
                  <TableHead>Liberado</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-6 text-center text-sm">
                      Carregando…
                    </TableCell>
                  </TableRow>
                ) : linhas.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-6 text-center text-sm text-muted-foreground"
                    >
                      Nenhuma comissão lançada neste mês.
                    </TableCell>
                  </TableRow>
                ) : (
                  linhas.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-medium">
                        {l.internal_users?.full_name ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {STATUS_COMISSAO.find((s) => s.v === l.status)?.l ?? l.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatMoney(l.commission_amount)}</TableCell>
                      <TableCell>{formatMoney(l.bonus_amount)}</TableCell>
                      <TableCell>{formatMoney(l.reserve_amount)}</TableCell>
                      <TableCell>{formatMoney(l.released_amount)}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => setEditando(l)}>
                          Editar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {editando && (
        <ComissaoFormDialog
          open={!!editando}
          setOpen={(v: boolean) => !v && setEditando(null)}
          vendedores={vendedores}
          initial={editando}
          onSubmit={salvar}
        />
      )}
    </div>
  );
}

function ComissaoFormDialog({ open, setOpen, vendedores, initial, onSubmit, children }: any) {
  const [form, setForm] = useState<any>(
    () =>
      initial ?? {
        seller_id: "",
        commission_amount: "",
        bonus_amount: "",
        reserve_amount: "",
        released_amount: "",
        status: "pendente",
      },
  );

  useEffect(() => {
    if (initial) {
      setForm({
        ...initial,
        commission_amount: String(initial.commission_amount ?? 0),
        bonus_amount: String(initial.bonus_amount ?? 0),
        reserve_amount: String(initial.reserve_amount ?? 0),
        released_amount: String(initial.released_amount ?? 0),
      });
    } else if (open) {
      setForm({
        seller_id: "",
        commission_amount: "",
        bonus_amount: "",
        reserve_amount: "",
        released_amount: "",
        status: "pendente",
      });
    }
  }, [initial, open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar comissão" : "Lançar comissão manual"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Vendedor</Label>
            <Select
              value={form.seller_id}
              onValueChange={(v) => setForm({ ...form, seller_id: v })}
              disabled={!!initial}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {vendedores.map((v: any) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Comissão (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.commission_amount}
                onChange={(e) => setForm({ ...form, commission_amount: e.target.value })}
              />
            </div>
            <div>
              <Label>Bônus (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.bonus_amount}
                onChange={(e) => setForm({ ...form, bonus_amount: e.target.value })}
              />
            </div>
            <div>
              <Label>Reserva (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.reserve_amount}
                onChange={(e) => setForm({ ...form, reserve_amount: e.target.value })}
              />
            </div>
            <div>
              <Label>Liberado (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.released_amount}
                onChange={(e) => setForm({ ...form, released_amount: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_COMISSAO.map((s) => (
                  <SelectItem key={s.v} value={s.v}>
                    {s.l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={() => onSubmit(form)}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
