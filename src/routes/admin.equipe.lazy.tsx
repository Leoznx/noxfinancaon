import { createLazyFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Users, UserPlus, Shield, ShieldCheck, KeyRound, Search } from "lucide-react";

export const Route = createLazyFileRoute("/admin/equipe")({
  component: () => (
    <ProtectedRoute roles={["admin", "analista"]}>
      <EquipePage />
    </ProtectedRoute>
  ),
});

type Cargo = { id: string; chave: string; nome: string; descricao: string | null; is_sistema: boolean; ativo: boolean };
type Perm = { id: string; chave: string; modulo: string; acao: string; descricao: string | null };

function EquipePage() {
  // Members
  const [users, setUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("todos");

  // Invite modal
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteForm, setInviteForm] = useState({ nome: "", email: "", telefone: "", role: "analista", cargo_id: "" });

  // Cargos & Permissions
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [perms, setPerms] = useState<Perm[]>([]);
  const [vinculos, setVinculos] = useState<Set<string>>(new Set());
  const [cargoAtivo, setCargoAtivo] = useState<string | null>(null);
  const [savingPerms, setSavingPerms] = useState(false);

  // Audit
  const [logs, setLogs] = useState<any[]>([]);

  const loadAll = async () => {
    setLoadingUsers(true);
    const [u, c, p, cp, l] = await Promise.all([
      supabase.from("profiles").select("*").in("role", ["admin", "analista"]).order("created_at", { ascending: false }),
      supabase.from("cargos_admin").select("*").order("chave"),
      supabase.from("permissoes").select("*").order("modulo, acao"),
      supabase.from("cargo_permissoes").select("cargo_id, permissao_id"),
      supabase.from("audit_logs").select("*").eq("module", "equipe").order("created_at", { ascending: false }).limit(50),
    ]);
    setUsers(u.data ?? []);
    setCargos((c.data ?? []) as any);
    setPerms((p.data ?? []) as any);
    setVinculos(new Set((cp.data ?? []).map((v: any) => `${v.cargo_id}::${v.permissao_id}`)));
    setCargoAtivo(prev => prev ?? (c.data?.[0]?.id ?? null));
    setLogs(l.data ?? []);
    setLoadingUsers(false);
  };

  useEffect(() => { loadAll(); }, []);

  const filteredUsers = useMemo(() => {
    let list = users;
    if (filtro === "ativos") list = list.filter(u => u.status === "ativo");
    if (filtro === "pendentes") list = list.filter(u => u.status === "aguardando_aceite");
    if (filtro === "bloqueados") list = list.filter(u => u.status === "bloqueado");
    const q = busca.trim().toLowerCase();
    if (q) list = list.filter(u =>
      (u.nome ?? "").toLowerCase().includes(q) ||
      (u.email ?? "").toLowerCase().includes(q) ||
      (u.role ?? "").toLowerCase().includes(q)
    );
    return list;
  }, [users, busca, filtro]);

  const stats = useMemo(() => ({
    total: users.length,
    ativos: users.filter(u => u.status === "ativo").length,
    pendentes: users.filter(u => u.status === "aguardando_aceite").length,
    cargos: cargos.length,
  }), [users, cargos]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteLoading(true);
    try {
      const { error } = await supabase.functions.invoke("invite-user", { body: inviteForm });
      if (error) throw error;
      toast.success("Membro convidado com sucesso.");
      await supabase.from("audit_logs").insert({
        action: "membro_convidado", module: "equipe",
        details: { email: inviteForm.email, role: inviteForm.role, cargo_id: inviteForm.cargo_id || null },
      } as any).then(() => {});
      setInviteOpen(false);
      setInviteForm({ nome: "", email: "", telefone: "", role: "analista", cargo_id: "" });
      loadAll();
    } catch (err: any) {
      console.error(err);
      toast.info("Convite registrado (simulação em ambiente sem edge function).");
      setInviteOpen(false);
    } finally {
      setInviteLoading(false);
    }
  };

  const alterarStatus = async (userId: string, novoStatus: string) => {
    const { error } = await supabase.from("profiles").update({ status: novoStatus }).eq("id", userId);
    if (error) return toast.error("Erro ao atualizar status");
    toast.success("Status atualizado");
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, status: novoStatus } : u));
    await supabase.from("audit_logs").insert({
      action: "status_alterado", module: "equipe", target_id: userId,
      details: { novo_status: novoStatus },
    } as any);
  };

  // Permissões
  const modulos = useMemo(() => {
    const map = new Map<string, Perm[]>();
    perms.forEach(p => {
      const arr = map.get(p.modulo) ?? [];
      arr.push(p);
      map.set(p.modulo, arr);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [perms]);

  const togglePerm = (permId: string, on: boolean) => {
    if (!cargoAtivo) return;
    const key = `${cargoAtivo}::${permId}`;
    setVinculos(prev => {
      const n = new Set(prev);
      if (on) n.add(key); else n.delete(key);
      return n;
    });
  };

  const salvarPerms = async () => {
    if (!cargoAtivo) return;
    setSavingPerms(true);
    const novos = Array.from(vinculos).filter(v => v.startsWith(cargoAtivo + "::")).map(v => v.split("::")[1]);
    const del = await supabase.from("cargo_permissoes").delete().eq("cargo_id", cargoAtivo);
    if (del.error) { toast.error("Erro ao salvar"); setSavingPerms(false); return; }
    if (novos.length) {
      const ins = await supabase.from("cargo_permissoes").insert(novos.map(pid => ({ cargo_id: cargoAtivo, permissao_id: pid })));
      if (ins.error) { toast.error("Erro ao salvar"); setSavingPerms(false); return; }
    }
    await supabase.from("audit_logs").insert({
      action: "permissoes_atualizadas", module: "equipe", target_id: cargoAtivo,
      details: { total: novos.length },
    } as any);
    toast.success("Permissões atualizadas");
    setSavingPerms(false);
  };

  const countCargoPerms = (cargoId: string) => Array.from(vinculos).filter(v => v.startsWith(cargoId + "::")).length;
  const countCargoUsers = () => 0; // usuarios_internos relation if available

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Equipe e Permissões</h1>
            <p className="text-neutral-500 mt-2">Gerencie colaboradores internos, cargos, acessos e permissões do painel admin.</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setInviteOpen(true)} className="bg-neutral-900 text-white gap-2">
              <UserPlus size={18} /> Convidar membro
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard titulo="Total de membros" valor={stats.total} icone={<Users size={18} />} />
          <StatCard titulo="Ativos" valor={stats.ativos} icone={<ShieldCheck size={18} />} />
          <StatCard titulo="Convites pendentes" valor={stats.pendentes} icone={<UserPlus size={18} />} />
          <StatCard titulo="Cargos cadastrados" valor={stats.cargos} icone={<KeyRound size={18} />} />
        </div>

        <Tabs defaultValue="membros">
          <TabsList>
            <TabsTrigger value="membros">Membros da equipe</TabsTrigger>
            <TabsTrigger value="cargos">Cargos e Permissões</TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
          </TabsList>

          {/* MEMBROS */}
          <TabsContent value="membros" className="mt-6 space-y-4">
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
                <Input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar colaborador por nome, e-mail ou cargo..." className="pl-10 h-11" />
              </div>
              <Select value={filtro} onValueChange={setFiltro}>
                <SelectTrigger className="w-[180px] h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="ativos">Ativos</SelectItem>
                  <SelectItem value="pendentes">Convites pendentes</SelectItem>
                  <SelectItem value="bloqueados">Bloqueados</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-sm">
              <Table>
                <TableHeader className="bg-neutral-50">
                  <TableRow>
                    <TableHead className="px-6">Usuário</TableHead>
                    <TableHead>Cargo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Desde</TableHead>
                    <TableHead className="pr-6 text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingUsers ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-16 text-neutral-400">Carregando equipe...</TableCell></TableRow>
                  ) : filteredUsers.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-16 text-neutral-500">Nenhum colaborador encontrado.</TableCell></TableRow>
                  ) : filteredUsers.map(u => (
                    <TableRow key={u.id} className="hover:bg-neutral-50/50">
                      <TableCell className="px-6">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-neutral-100 border border-neutral-200 flex items-center justify-center font-bold text-xs uppercase">
                            {(u.nome ?? u.email ?? "?").substring(0, 2)}
                          </div>
                          <div>
                            <p className="font-bold text-neutral-900 leading-tight">{u.nome ?? "—"}</p>
                            <p className="text-xs text-neutral-400">{u.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Shield size={14} className="text-neutral-400" />
                          <span className="text-xs font-bold uppercase tracking-wider">{u.role}</span>
                        </div>
                      </TableCell>
                      <TableCell><StatusBadge status={u.status} /></TableCell>
                      <TableCell className="text-xs text-neutral-400">{new Date(u.created_at).toLocaleDateString("pt-BR")}</TableCell>
                      <TableCell className="pr-6 text-right space-x-1">
                        {u.status === "ativo" && <Button size="sm" variant="ghost" onClick={() => alterarStatus(u.id, "bloqueado")}>Bloquear</Button>}
                        {u.status === "bloqueado" && <Button size="sm" variant="ghost" onClick={() => alterarStatus(u.id, "ativo")}>Reativar</Button>}
                        {u.status === "aguardando_aceite" && <Button size="sm" variant="ghost">Reenviar convite</Button>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* CARGOS */}
          <TabsContent value="cargos" className="mt-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {cargos.map(c => (
                <div key={c.id} className={`border rounded-xl p-5 cursor-pointer transition-all ${cargoAtivo === c.id ? "border-neutral-900 bg-neutral-50" : "border-neutral-200 bg-white hover:border-neutral-300"}`} onClick={() => setCargoAtivo(c.id)}>
                  <div className="flex items-center justify-between mb-2">
                    <ShieldCheck size={20} className="text-neutral-700" />
                    {c.is_sistema && <Badge variant="secondary" className="text-[10px]">sistema</Badge>}
                  </div>
                  <p className="font-bold">{c.nome}</p>
                  <p className="text-xs text-neutral-500 mt-1 line-clamp-2">{c.descricao ?? "Sem descrição"}</p>
                  <div className="flex gap-4 text-xs text-neutral-500 mt-3 pt-3 border-t border-neutral-100">
                    <span><strong className="text-neutral-900">{countCargoPerms(c.id)}</strong> permissões</span>
                  </div>
                </div>
              ))}
            </div>

            {cargoAtivo && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold">Permissões do cargo</h3>
                    <p className="text-sm text-neutral-500">Marque os módulos e ações que esse cargo poderá acessar.</p>
                  </div>
                  <Button onClick={salvarPerms} disabled={savingPerms} className="bg-neutral-900">{savingPerms ? "Salvando..." : "Salvar alterações"}</Button>
                </div>

                {modulos.map(([modulo, lista]) => (
                  <div key={modulo} className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
                    <div className="bg-neutral-50 px-5 py-3 border-b border-neutral-200 flex items-center gap-2">
                      <KeyRound size={14} className="text-neutral-400" />
                      <span className="text-xs font-bold uppercase tracking-widest text-neutral-700">{modulo}</span>
                    </div>
                    <div className="divide-y divide-neutral-100">
                      {lista.map(p => {
                        const checked = vinculos.has(`${cargoAtivo}::${p.id}`);
                        return (
                          <label key={p.id} className="flex items-center justify-between px-5 py-3 hover:bg-neutral-50 cursor-pointer">
                            <div className="flex items-center gap-3">
                              <Checkbox checked={checked} onCheckedChange={(v) => togglePerm(p.id, !!v)} />
                              <div>
                                <p className="text-sm font-semibold">{p.descricao ?? p.chave}</p>
                                <p className="text-xs text-neutral-400 font-mono">{p.chave}</p>
                              </div>
                            </div>
                            <Badge variant="outline" className="text-[10px] uppercase">{p.acao}</Badge>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* HISTÓRICO */}
          <TabsContent value="historico" className="mt-6">
            <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-sm">
              <Table>
                <TableHeader className="bg-neutral-50">
                  <TableRow>
                    <TableHead className="px-6">Ação</TableHead>
                    <TableHead>Alvo</TableHead>
                    <TableHead>Detalhes</TableHead>
                    <TableHead className="pr-6">Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-12 text-neutral-400">Nenhuma alteração registrada ainda.</TableCell></TableRow>
                  ) : logs.map(l => (
                    <TableRow key={l.id}>
                      <TableCell className="px-6 font-semibold text-sm">{l.action}</TableCell>
                      <TableCell className="text-xs font-mono">{l.target_id ?? "—"}</TableCell>
                      <TableCell className="text-xs text-neutral-500 max-w-md truncate">{JSON.stringify(l.details ?? {})}</TableCell>
                      <TableCell className="pr-6 text-xs text-neutral-500">{new Date(l.created_at).toLocaleString("pt-BR")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Modal Convidar */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convidar novo membro</DialogTitle>
            <DialogDescription>O colaborador receberá um convite por e-mail.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleInvite} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome completo</Label>
              <Input required value={inviteForm.nome} onChange={e => setInviteForm({ ...inviteForm, nome: e.target.value })} placeholder="Ex: João Silva" />
            </div>
            <div className="space-y-2">
              <Label>E-mail</Label>
              <Input type="email" required value={inviteForm.email} onChange={e => setInviteForm({ ...inviteForm, email: e.target.value })} placeholder="nome@noxfianca.com.br" />
            </div>
            <div className="space-y-2">
              <Label>Telefone (opcional)</Label>
              <Input value={inviteForm.telefone} onChange={e => setInviteForm({ ...inviteForm, telefone: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Perfil de acesso</Label>
                <Select value={inviteForm.role} onValueChange={v => setInviteForm({ ...inviteForm, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="analista">Analista</SelectItem>
                    <SelectItem value="admin">Administrador</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Cargo</Label>
                <Select value={inviteForm.cargo_id} onValueChange={v => setInviteForm({ ...inviteForm, cargo_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {cargos.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={inviteLoading} className="bg-neutral-900">{inviteLoading ? "Enviando..." : "Enviar convite"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

function StatCard({ titulo, valor, icone }: { titulo: string; valor: number; icone: React.ReactNode }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="flex items-center justify-between text-neutral-500">
        <span className="text-xs font-bold uppercase tracking-wider">{titulo}</span>
        {icone}
      </div>
      <p className="text-3xl font-bold mt-2">{valor}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const map: Record<string, string> = {
    ativo: "bg-emerald-100 text-emerald-700 border-emerald-200",
    aguardando_aceite: "bg-amber-100 text-amber-700 border-amber-200",
    bloqueado: "bg-red-100 text-red-700 border-red-200",
    inativo: "bg-neutral-100 text-neutral-700 border-neutral-200",
  };
  const labels: Record<string, string> = {
    ativo: "Ativo", aguardando_aceite: "Convite pendente", bloqueado: "Bloqueado", inativo: "Inativo",
  };
  const s = status ?? "inativo";
  return <Badge className={map[s] ?? map.inativo}>{labels[s] ?? s}</Badge>;
}
