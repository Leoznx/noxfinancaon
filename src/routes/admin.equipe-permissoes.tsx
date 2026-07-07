import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Users, ShieldCheck, Briefcase, History, UserX, UserCheck } from "lucide-react";
import { z } from "zod";

const VALID_TABS = ["colaboradores", "permissoes", "equipe-comercial", "auditoria"] as const;
type TabKey = (typeof VALID_TABS)[number];

const searchSchema = z.object({
  tab: z.enum(VALID_TABS).optional(),
});

export const Route = createFileRoute("/admin/equipe-permissoes")({
  validateSearch: (s) => searchSchema.parse(s),
  component: () => (
    <ProtectedRoute roles={["admin", "admin_master", "analista"]}>
      <EquipePermissoesPage />
    </ProtectedRoute>
  ),
});

// Cargos visíveis na UI — Admin Master fica oculto (Admin já é o Admin Master)
const CARGOS_VISIVEIS = ["juridico", "financeiro", "marketing", "suporte", "vendedor"];
const CARGO_LABEL: Record<string, string> = {
  juridico: "Jurídico", financeiro: "Financeiro", marketing: "Marketing",
  suporte: "Suporte", vendedor: "Vendedor", admin_master: "Admin Master",
};

function EquipePermissoesPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/admin/equipe-permissoes" });
  const activeTab: TabKey = (search.tab as TabKey) ?? "colaboradores";

  const setTab = (t: TabKey) =>
    navigate({ to: "/admin/equipe-permissoes", search: { tab: t } as any, replace: true });

  // Resumo
  const [resumo, setResumo] = useState({ ativos: 0, bloqueados: 0, vendedoresAtivos: 0, permissoes: 0 });
  useEffect(() => {
    (async () => {
      try {
        const [a, b, v, p] = await Promise.all([
          supabase.from("internal_users" as any).select("id", { count: "exact", head: true }).eq("status", "ativo"),
          supabase.from("internal_users" as any).select("id", { count: "exact", head: true }).eq("status", "bloqueado"),
          supabase.from("internal_users" as any).select("id", { count: "exact", head: true }).eq("status", "ativo").eq("role", "vendedor"),
          supabase.from("role_permissions" as any).select("id", { count: "exact", head: true }),
        ]);
        setResumo({
          ativos: a.count ?? 0,
          bloqueados: b.count ?? 0,
          vendedoresAtivos: v.count ?? 0,
          permissoes: p.count ?? 0,
        });
      } catch (e) { console.warn("resumo failed", e); }
    })();
  }, [activeTab]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Equipe e Permissões</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gerencie colaboradores internos, cargos, permissões e desempenho comercial da equipe NOX.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <CardResumo icon={UserCheck} label="Colaboradores ativos" value={resumo.ativos} />
          <CardResumo icon={UserX} label="Colaboradores bloqueados" value={resumo.bloqueados} />
          <CardResumo icon={Briefcase} label="Vendedores ativos" value={resumo.vendedoresAtivos} />
          <CardResumo icon={ShieldCheck} label="Permissões configuradas" value={resumo.permissoes} />
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList className="grid grid-cols-2 md:grid-cols-4 w-full">
            <TabsTrigger value="colaboradores"><Users className="w-4 h-4 mr-2" />Colaboradores</TabsTrigger>
            <TabsTrigger value="permissoes"><ShieldCheck className="w-4 h-4 mr-2" />Cargos e Permissões</TabsTrigger>
            <TabsTrigger value="equipe-comercial"><Briefcase className="w-4 h-4 mr-2" />Equipe Comercial</TabsTrigger>
            <TabsTrigger value="auditoria"><History className="w-4 h-4 mr-2" />Auditoria</TabsTrigger>
          </TabsList>

          <TabsContent value="colaboradores" className="mt-4"><TabColaboradores /></TabsContent>
          <TabsContent value="permissoes" className="mt-4"><TabPermissoes /></TabsContent>
          <TabsContent value="equipe-comercial" className="mt-4"><TabEquipeComercial /></TabsContent>
          <TabsContent value="auditoria" className="mt-4"><TabAuditoria /></TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function CardResumo({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-neutral-100 flex items-center justify-center">
          <Icon className="w-5 h-5 text-neutral-700" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/* ===================== COLABORADORES ===================== */
function TabColaboradores() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const carregar = async () => {
    setLoading(true);
    const { data } = await supabase.from("internal_users" as any).select("*").order("created_at", { ascending: false });
    setRows((data as any[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { carregar(); }, []);

  const alterarCargo = async (id: string, role: string) => {
    const { error } = await supabase.from("internal_users" as any).update({ role }).eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Cargo atualizado"); carregar(); }
  };
  const alterarStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("internal_users" as any).update({ status }).eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Status atualizado"); carregar(); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Colaboradores Internos</CardTitle>
        <p className="text-sm text-muted-foreground">
          Equipe interna — Jurídico, Financeiro, Marketing, Suporte e Vendedor.
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead><TableHead>E-mail</TableHead>
              <TableHead>Cargo</TableHead><TableHead>Status</TableHead>
              <TableHead>Criado em</TableHead><TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} className="text-center text-sm py-6">Carregando…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">Nenhum colaborador cadastrado.</TableCell></TableRow>
            ) : rows.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.full_name}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>
                  {u.role === "admin_master" ? (
                    <Badge variant="outline">Admin Master</Badge>
                  ) : (
                    <Select value={u.role} onValueChange={(v) => alterarCargo(u.id, v)}>
                      <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CARGOS_VISIVEIS.map((c) => <SelectItem key={c} value={c}>{CARGO_LABEL[c]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={u.status === "ativo" ? "default" : u.status === "bloqueado" ? "destructive" : "secondary"}>
                    {u.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {u.created_at ? new Date(u.created_at).toLocaleDateString("pt-BR") : "—"}
                </TableCell>
                <TableCell>
                  {u.status === "ativo" ? (
                    <Button size="sm" variant="outline" onClick={() => alterarStatus(u.id, "bloqueado")}>Bloquear</Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => alterarStatus(u.id, "ativo")}>Ativar</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ===================== CARGOS E PERMISSÕES ===================== */
const MODULOS = [
  "aprovacoes","contratos","apolices","documentos","financeiro","faturamento",
  "comissoes","saques","leads","suporte","equipe_comercial","colaboradores","configuracoes",
];
const ACOES: ("can_view"|"can_create"|"can_edit"|"can_delete"|"can_approve"|"can_export")[] =
  ["can_view","can_create","can_edit","can_delete","can_approve","can_export"];
const ACOES_LABEL: Record<string,string> = {
  can_view:"Ver", can_create:"Criar", can_edit:"Editar", can_delete:"Excluir", can_approve:"Aprovar", can_export:"Exportar",
};

function TabPermissoes() {
  const [rows, setRows] = useState<any[]>([]);
  const [selectedRole, setSelectedRole] = useState<string>("juridico");

  const carregar = async () => {
    const { data } = await supabase.from("role_permissions" as any).select("*");
    setRows((data as any[]) ?? []);
  };
  useEffect(() => { carregar(); }, []);

  const find = (role: string, mod: string) => rows.find((r) => r.role === role && r.module === mod);

  const toggle = async (role: string, mod: string, acao: string, value: boolean) => {
    const existing = find(role, mod);
    if (existing) {
      const { error } = await supabase.from("role_permissions" as any).update({ [acao]: value }).eq("id", existing.id);
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await supabase.from("role_permissions" as any).insert({ role, module: mod, [acao]: value });
      if (error) { toast.error(error.message); return; }
    }
    toast.success("Permissões atualizadas com sucesso.");
    carregar();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cargos e Permissões</CardTitle>
        <p className="text-sm text-muted-foreground">
          O Admin possui acesso total ao sistema. Os cargos abaixo controlam apenas acessos dos colaboradores internos.
        </p>
        <div className="flex gap-2 mt-3 flex-wrap">
          {CARGOS_VISIVEIS.map((r) => (
            <button key={r} onClick={() => setSelectedRole(r)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border ${selectedRole===r ? "bg-primary text-primary-foreground border-primary" : "bg-card"}`}>
              {CARGO_LABEL[r]}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Módulo</TableHead>
              {ACOES.map((a) => <TableHead key={a} className="text-center">{ACOES_LABEL[a]}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {MODULOS.map((mod) => {
              const row = find(selectedRole, mod);
              return (
                <TableRow key={mod}>
                  <TableCell className="font-medium capitalize">{mod.replace("_", " ")}</TableCell>
                  {ACOES.map((a) => (
                    <TableCell key={a} className="text-center">
                      <Switch checked={!!row?.[a]} onCheckedChange={(v) => toggle(selectedRole, mod, a, v)} />
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ===================== EQUIPE COMERCIAL ===================== */
function TabEquipeComercial() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const carregar = async () => {
    setLoading(true);
    const { data: vendedores } = await supabase.from("internal_users" as any)
      .select("id, full_name, email, status").eq("role", "vendedor");
    const now = new Date();
    const m = now.getMonth() + 1, y = now.getFullYear();
    const enriched = await Promise.all(((vendedores as any[]) ?? []).map(async (v) => {
      const { data: perf } = await supabase.from("seller_performance" as any)
        .select("*").eq("seller_id", v.id).eq("month", m).eq("year", y).maybeSingle();
      const { count: leads } = await supabase.from("sales_leads" as any)
        .select("id", { count: "exact", head: true }).eq("assigned_seller_id", v.id);
      const { data: comm } = await supabase.from("seller_commissions" as any)
        .select("status, reserve_amount, released_amount").eq("seller_id", v.id).eq("month", m).eq("year", y);
      const reservas = (comm as any[] | null)?.reduce((s, r) => s + Number(r.reserve_amount ?? 0), 0) ?? 0;
      const estornos = (comm as any[] | null)?.filter((r) => r.status === "estornada").length ?? 0;
      return { ...v, perf, leadsCount: leads ?? 0, reservas, estornos };
    }));
    setRows(enriched);
    setLoading(false);
  };
  useEffect(() => { carregar(); }, []);

  const materializar = async () => {
    const now = new Date();
    const { error } = await supabase.rpc("materializar_comissoes_vendedor" as any,
      { p_mes: now.getMonth()+1, p_ano: now.getFullYear() });
    if (error) toast.error(error.message); else { toast.success("Comissões materializadas"); carregar(); }
  };

  const sorted = useMemo(
    () => [...rows].sort((a, b) => (b.perf?.contracts_activated ?? 0) - (a.perf?.contracts_activated ?? 0)),
    [rows]
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Equipe Comercial</CardTitle>
          <p className="text-sm text-muted-foreground">Performance, metas, comissões, reservas e ranking dos vendedores.</p>
        </div>
        <Button size="sm" onClick={materializar}>Materializar mês</Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Vendedor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Leads</TableHead>
              <TableHead>Fechados</TableHead>
              <TableHead>Ativados</TableHead>
              <TableHead>Cancelados</TableHead>
              <TableHead>Receita LTV</TableHead>
              <TableHead>Comissão</TableHead>
              <TableHead>Bônus</TableHead>
              <TableHead>Reserva</TableHead>
              <TableHead>Estornos</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={12} className="text-center py-6 text-sm">Carregando…</TableCell></TableRow>
            ) : sorted.length === 0 ? (
              <TableRow><TableCell colSpan={12} className="text-center py-6 text-sm text-muted-foreground">Sem vendedores cadastrados.</TableCell></TableRow>
            ) : sorted.map((v, i) => (
              <TableRow key={v.id}>
                <TableCell className="font-bold">{i+1}</TableCell>
                <TableCell>{v.full_name}</TableCell>
                <TableCell><Badge variant={v.status === "ativo" ? "default" : "secondary"}>{v.status}</Badge></TableCell>
                <TableCell>{v.leadsCount}</TableCell>
                <TableCell>{v.perf?.contracts_closed ?? 0}</TableCell>
                <TableCell>{v.perf?.contracts_activated ?? 0}</TableCell>
                <TableCell>{v.perf?.contracts_canceled ?? 0}</TableCell>
                <TableCell>R$ {Number(v.perf?.generated_revenue_ltv ?? 0).toFixed(2)}</TableCell>
                <TableCell>R$ {Number(v.perf?.commission_total ?? 0).toFixed(2)}</TableCell>
                <TableCell>R$ {Number(v.perf?.bonus_total ?? 0).toFixed(2)} {v.perf?.bonus_bloqueado ? <Badge variant="destructive" className="ml-1">bloq.</Badge> : null}</TableCell>
                <TableCell>R$ {Number(v.reservas).toFixed(2)}</TableCell>
                <TableCell>{v.estornos}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ===================== AUDITORIA ===================== */
function TabAuditoria() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("internal_audit_logs" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      setRows((data as any[]) ?? []);
      setLoading(false);
    })();
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Auditoria interna</CardTitle>
        <p className="text-sm text-muted-foreground">Últimas 200 ações registradas dos colaboradores internos.</p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data/Hora</TableHead>
              <TableHead>Usuário</TableHead>
              <TableHead>Cargo</TableHead>
              <TableHead>Ação</TableHead>
              <TableHead>Módulo</TableHead>
              <TableHead>Registro</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-6 text-sm">Carregando…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-6 text-sm text-muted-foreground">Nenhum registro de auditoria.</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs">{new Date(r.created_at).toLocaleString("pt-BR")}</TableCell>
                <TableCell className="text-xs">{r.actor_user_id?.substring(0, 8) ?? "—"}</TableCell>
                <TableCell>{r.actor_role ?? "—"}</TableCell>
                <TableCell>{r.action}</TableCell>
                <TableCell>{r.table_name ?? "—"}</TableCell>
                <TableCell className="text-xs">{r.record_id?.substring(0, 8) ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
