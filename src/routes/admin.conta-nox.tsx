import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
import { Scale, DollarSign, Megaphone, Briefcase, KeyRound, Copy, Check, ExternalLink, RefreshCw, Ban, UserCheck } from "lucide-react";
import {
  noxInternalAccounts,
  buildRegistrationLink,
  NOX_INTERNAL_ROLES,
  type NoxInternalRole,
} from "@/lib/nox-internal-accounts";
import {
  listNoxEmployees,
  updateNoxEmployeeRole,
  updateNoxEmployeeStatus,
} from "@/lib/nox-employees.functions";

export const Route = createFileRoute("/admin/conta-nox")({
  component: () => (
    <ProtectedRoute roles={["admin", "admin_master", "analista"]}>
      <ContaNoxPage />
    </ProtectedRoute>
  ),
});

const CARGO_ICON: Record<NoxInternalRole, any> = {
  vendedor: Briefcase,
  financeiro: DollarSign,
  juridico: Scale,
  marketing: Megaphone,
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  ativo: { label: "Ativo", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  bloqueado: { label: "Bloqueado", cls: "bg-red-100 text-red-700 border-red-200" },
  aguardando_confirmacao: {
    label: "Aguardando confirmação",
    cls: "bg-amber-100 text-amber-700 border-amber-200",
  },
};

function normalizeText(value: string | null | undefined) {
  const unicodeCombiningMarks = new RegExp("[\\u0300-\\u036f]", "g");
  return (value ?? "")
    .normalize("NFD")
    .replace(unicodeCombiningMarks, "")
    .toLowerCase()
    .trim();
}

function ContaNoxPage() {
  const listFn = useServerFn(listNoxEmployees);
  const updateStatusFn = useServerFn(updateNoxEmployeeStatus);
  const updateRoleFn = useServerFn(updateNoxEmployeeRole);

  const [copiadoRole, setCopiadoRole] = useState<NoxInternalRole | null>(null);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filtroCargo, setFiltroCargo] = useState("todos");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [pendingRoleChange, setPendingRoleChange] = useState<{ id: string; nome: string; role: NoxInternalRole } | null>(
    null,
  );

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listFn({ data: {} });
      setEmployees(result.employees);
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível carregar os funcionários.");
    } finally {
      setLoading(false);
    }
  }, [listFn]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const copiarLink = async (role: NoxInternalRole) => {
    try {
      await navigator.clipboard.writeText(buildRegistrationLink(role));
      setCopiadoRole(role);
      toast.success("Link de cadastro copiado com sucesso.");
      window.setTimeout(() => setCopiadoRole((cur) => (cur === role ? null : cur)), 2500);
    } catch (error) {
      console.error("Não foi possível copiar o link", error);
      toast.error("Não foi possível copiar o link automaticamente.");
    }
  };

  const abrirCadastro = (role: NoxInternalRole) => {
    window.open(buildRegistrationLink(role), "_blank", "noopener,noreferrer");
  };

  const alternarStatus = async (employee: any) => {
    const novoStatus = employee.status === "bloqueado" ? "ativo" : "bloqueado";
    try {
      await updateStatusFn({ data: { employeeId: employee.id, status: novoStatus } });
      toast.success(novoStatus === "bloqueado" ? "Acesso bloqueado." : "Acesso reativado.");
      carregar();
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível atualizar o status.");
    }
  };

  const confirmarAlteracaoCargo = async () => {
    if (!pendingRoleChange) return;
    try {
      await updateRoleFn({ data: { employeeId: pendingRoleChange.id, role: pendingRoleChange.role } });
      toast.success("Cargo atualizado.");
      setPendingRoleChange(null);
      carregar();
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível atualizar o cargo.");
    }
  };

  const employeesFiltrados = useMemo(() => {
    const termo = normalizeText(searchTerm);
    return employees.filter((emp) => {
      if (filtroCargo !== "todos" && emp.cargo !== filtroCargo) return false;
      if (filtroStatus !== "todos" && emp.status !== filtroStatus) return false;
      if (!termo) return true;
      return (
        normalizeText(emp.nome).includes(termo) ||
        normalizeText(emp.email).includes(termo) ||
        normalizeText(emp.telefone).includes(termo) ||
        normalizeText(emp.cargo).includes(termo)
      );
    });
  }, [employees, searchTerm, filtroCargo, filtroStatus]);

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-yellow-400 p-2.5 text-neutral-900">
            <KeyRound className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-neutral-900">Contas da equipe NOX</h1>
            <p className="mt-1 text-sm text-neutral-500">
              Copie o link correspondente ao cargo do novo colaborador.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {NOX_INTERNAL_ROLES.map((role) => {
            const conta = noxInternalAccounts[role];
            const Icon = CARGO_ICON[role];
            const link = buildRegistrationLink(role);
            return (
              <Card key={role} className="rounded-2xl border-neutral-200">
                <CardContent className="p-4 space-y-3">
                  <div className="inline-flex rounded-lg bg-neutral-900 p-2 text-yellow-400">
                    <Icon size={18} />
                  </div>
                  <div>
                    <p className="text-sm font-black text-neutral-900">{conta.label}</p>
                    <p className="mt-1 text-xs leading-relaxed text-neutral-600">{conta.cardDescription}</p>
                  </div>
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1.5 overflow-hidden whitespace-nowrap text-ellipsis text-[11px] text-neutral-600">
                    {link}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => copiarLink(role)}
                    >
                      {copiadoRole === role ? (
                        <>
                          <Check size={14} className="mr-1.5 text-emerald-600" /> Copiado
                        </>
                      ) : (
                        <>
                          <Copy size={14} className="mr-1.5" /> Copiar link
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="flex-1 bg-neutral-900 text-white hover:bg-neutral-800"
                      onClick={() => abrirCadastro(role)}
                    >
                      <ExternalLink size={14} className="mr-1.5" /> Abrir cadastro
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-black text-neutral-900">Funcionários cadastrados</p>
              <p className="text-xs text-neutral-500">Consulte as contas internas cadastradas na plataforma.</p>
            </div>
            <Button size="sm" variant="outline" onClick={carregar}>
              <RefreshCw size={14} className="mr-1.5" /> Atualizar
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Buscar funcionário por nome ou e-mail"
              autoComplete="off"
              className="h-9 max-w-xs flex-1 rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-neutral-900/10"
            />
            <Select value={filtroCargo} onValueChange={setFiltroCargo}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os cargos</SelectItem>
                {NOX_INTERNAL_ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {noxInternalAccounts[role].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                <SelectItem value="ativo">Ativo</SelectItem>
                <SelectItem value="bloqueado">Bloqueado</SelectItem>
                <SelectItem value="aguardando_confirmacao">Aguardando confirmação</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-white overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Cargo</TableHead>
                  <TableHead>Cadastro</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Último acesso</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm py-6">
                      Carregando…
                    </TableCell>
                  </TableRow>
                ) : employeesFiltrados.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-6">
                      Nenhum funcionário encontrado.
                    </TableCell>
                  </TableRow>
                ) : (
                  employeesFiltrados.map((emp) => {
                    const badge = STATUS_BADGE[emp.status];
                    return (
                      <TableRow key={emp.id}>
                        <TableCell className="font-medium">{emp.nome}</TableCell>
                        <TableCell className="text-xs">{emp.email}</TableCell>
                        <TableCell className="text-xs">{emp.telefone || "—"}</TableCell>
                        <TableCell>
                          {(NOX_INTERNAL_ROLES as readonly string[]).includes(emp.cargo) ? (
                            <Select
                              value={emp.cargo}
                              onValueChange={(novoValor) =>
                                setPendingRoleChange({ id: emp.id, nome: emp.nome, role: novoValor as NoxInternalRole })
                              }
                            >
                              <SelectTrigger className="h-8 w-36">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {NOX_INTERNAL_ROLES.map((role) => (
                                  <SelectItem key={role} value={role}>
                                    {noxInternalAccounts[role].label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant="outline" className="capitalize">
                              {emp.cargo.replace("_", " ")}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {emp.criadoEm ? new Date(emp.criadoEm).toLocaleDateString("pt-BR") : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge className={`${badge.cls} border`}>{badge.label}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {emp.ultimoAcesso ? new Date(emp.ultimoAcesso).toLocaleString("pt-BR") : "—"}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" onClick={() => alternarStatus(emp)}>
                            {emp.status === "bloqueado" ? (
                              <>
                                <UserCheck size={14} className="mr-1" /> Reativar
                              </>
                            ) : (
                              <>
                                <Ban size={14} className="mr-1" /> Bloquear
                              </>
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      <Dialog open={!!pendingRoleChange} onOpenChange={(open) => !open && setPendingRoleChange(null)}>
        <DialogContent className="max-w-md">
          <DialogTitle>Confirmar alteração de cargo</DialogTitle>
          <DialogDescription>
            {pendingRoleChange && (
              <>
                Alterar o cargo de <strong>{pendingRoleChange.nome}</strong> para{" "}
                <strong>{noxInternalAccounts[pendingRoleChange.role].label}</strong>?
              </>
            )}
          </DialogDescription>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => setPendingRoleChange(null)}>
              Cancelar
            </Button>
            <Button type="button" onClick={confirmarAlteracaoCargo} className="bg-neutral-900 hover:bg-neutral-800 text-white">
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
