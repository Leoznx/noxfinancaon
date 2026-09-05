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
import {
  Scale,
  DollarSign,
  Megaphone,
  Briefcase,
  KeyRound,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  Ban,
  UserCheck,
  Clock3,
} from "lucide-react";
import {
  noxInternalAccounts,
  buildRegistrationLink,
  NOX_INTERNAL_ACCOUNT_TYPES,
  type NoxInternalAccountType,
} from "@/lib/nox-internal-accounts";
import {
  createNoxEmployeeInvite,
  listNoxEmployees,
  updateNoxEmployeeRole,
  updateNoxEmployeeStatus,
} from "@/lib/nox-employees.functions";
import { setSellerTimeClockEnabled } from "@/lib/time-clock";

export const Route = createFileRoute("/admin/conta-nox")({
  component: () => (
    <ProtectedRoute roles={["admin", "admin_master", "analista"]}>
      <ContaNoxPage />
    </ProtectedRoute>
  ),
});

const CARGO_ICON: Record<NoxInternalAccountType, any> = {
  sdr: Briefcase,
  closer: UserCheck,
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
  return (value ?? "").normalize("NFD").replace(unicodeCombiningMarks, "").toLowerCase().trim();
}

function ContaNoxPage() {
  const listFn = useServerFn(listNoxEmployees);
  const createInviteFn = useServerFn(createNoxEmployeeInvite);
  const updateStatusFn = useServerFn(updateNoxEmployeeStatus);
  const updateRoleFn = useServerFn(updateNoxEmployeeRole);

  const [copiadoRole, setCopiadoRole] = useState<NoxInternalAccountType | null>(null);
  const [generatingRole, setGeneratingRole] = useState<NoxInternalAccountType | null>(null);
  const [generatedLinks, setGeneratedLinks] = useState<
    Partial<Record<NoxInternalAccountType, string>>
  >({});
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filtroCargo, setFiltroCargo] = useState("todos");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [pendingRoleChange, setPendingRoleChange] = useState<{
    id: string;
    nome: string;
    accountType: NoxInternalAccountType;
  } | null>(null);
  const [clockEmployee, setClockEmployee] = useState<{
    id: string;
    nome: string;
    enabled: boolean;
    status: string;
  } | null>(null);
  const [savingClock, setSavingClock] = useState(false);

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

  const gerarLink = async (role: NoxInternalAccountType) => {
    setGeneratingRole(role);
    try {
      const result = await createInviteFn({ data: { accountType: role } });
      const link = buildRegistrationLink(role, result.token);
      setGeneratedLinks((current) => ({ ...current, [role]: link }));
      return link;
    } finally {
      setGeneratingRole((current) => (current === role ? null : current));
    }
  };

  const copiarLink = async (role: NoxInternalAccountType) => {
    try {
      const link = await gerarLink(role);
      await navigator.clipboard.writeText(link);
      setCopiadoRole(role);
      toast.success("Link de cadastro copiado com sucesso.");
      window.setTimeout(() => setCopiadoRole((cur) => (cur === role ? null : cur)), 2500);
    } catch (error) {
      console.error("Não foi possível copiar o link", error);
      toast.error("Não foi possível copiar o link automaticamente.");
    }
  };

  const abrirCadastro = async (role: NoxInternalAccountType) => {
    try {
      const link = await gerarLink(role);
      window.open(link, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Não foi possível criar o convite protegido.");
    }
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
      await updateRoleFn({
        data: { employeeId: pendingRoleChange.id, accountType: pendingRoleChange.accountType },
      });
      toast.success("Cargo atualizado.");
      setPendingRoleChange(null);
      carregar();
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível atualizar o cargo.");
    }
  };

  const salvarControlePonto = async (enabled: boolean) => {
    if (!clockEmployee) return;
    setSavingClock(true);
    try {
      await setSellerTimeClockEnabled(clockEmployee.id, enabled);
      setEmployees((current) =>
        current.map((employee) =>
          employee.id === clockEmployee.id ? { ...employee, timeClockEnabled: enabled } : employee,
        ),
      );
      toast.success(enabled ? "Controle de ponto ativado." : "Controle de ponto desativado.");
      setClockEmployee(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível alterar o controle de ponto.",
      );
    } finally {
      setSavingClock(false);
    }
  };

  const employeesFiltrados = useMemo(() => {
    const termo = normalizeText(searchTerm);
    return employees.filter((emp) => {
      if (filtroCargo !== "todos" && emp.accountType !== filtroCargo) return false;
      if (filtroStatus !== "todos" && emp.status !== filtroStatus) return false;
      if (!termo) return true;
      return (
        normalizeText(emp.nome).includes(termo) ||
        normalizeText(emp.email).includes(termo) ||
        normalizeText(emp.telefone).includes(termo) ||
        normalizeText(emp.accountType).includes(termo)
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
            <h1 className="text-2xl font-black tracking-tight text-neutral-900">
              Contas da equipe NOX
            </h1>
            <p className="mt-1 text-sm text-neutral-500">
              Copie o link correspondente ao cargo do novo colaborador.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {NOX_INTERNAL_ACCOUNT_TYPES.map((role) => {
            const conta = noxInternalAccounts[role];
            const Icon = CARGO_ICON[role];
            const link = generatedLinks[role];
            return (
              <Card key={role} className="rounded-2xl border-neutral-200">
                <CardContent className="p-4 space-y-3">
                  <div className="inline-flex rounded-lg bg-neutral-900 p-2 text-yellow-400">
                    <Icon size={18} />
                  </div>
                  <div>
                    <p className="text-sm font-black text-neutral-900">{conta.label}</p>
                    <p className="mt-1 text-xs leading-relaxed text-neutral-600">
                      {conta.cardDescription}
                    </p>
                  </div>
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1.5 overflow-hidden whitespace-nowrap text-ellipsis text-[11px] text-neutral-600">
                    {link || "O link protegido será gerado ao copiar ou abrir."}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      disabled={generatingRole === role}
                      onClick={() => copiarLink(role)}
                    >
                      {copiadoRole === role ? (
                        <>
                          <Check size={14} className="mr-1.5 text-emerald-600" /> Copiado
                        </>
                      ) : (
                        <>
                          <Copy size={14} className="mr-1.5" />{" "}
                          {generatingRole === role ? "Gerando…" : "Copiar link"}
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="flex-1 bg-neutral-900 text-white hover:bg-neutral-800"
                      disabled={generatingRole === role}
                      onClick={() => void abrirCadastro(role)}
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
              <p className="text-xs text-neutral-500">
                Consulte as contas internas cadastradas na plataforma.
              </p>
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
                {NOX_INTERNAL_ACCOUNT_TYPES.map((role) => (
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

          <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
            {/* Mobile/tablet estreito (< md): cards empilhados, sem tabela pra arrastar. */}
            <div className="md:hidden divide-y divide-neutral-100">
              {loading ? (
                <p className="py-6 text-center text-sm">Carregando…</p>
              ) : employeesFiltrados.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Nenhum funcionário encontrado.
                </p>
              ) : (
                employeesFiltrados.map((emp) => {
                  const badge = STATUS_BADGE[emp.status];
                  return (
                    <div key={emp.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium truncate">{emp.nome}</p>
                            {emp.cargo === "vendedor" && (
                              <button
                                type="button"
                                title={`Controle de ponto: ${emp.timeClockEnabled ? "Sim" : "Não"}`}
                                aria-label={`Configurar controle de ponto de ${emp.nome}`}
                                onClick={() =>
                                  setClockEmployee({
                                    id: emp.id,
                                    nome: emp.nome,
                                    enabled: !!emp.timeClockEnabled,
                                    status: emp.status,
                                  })
                                }
                                className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors ${
                                  emp.timeClockEnabled
                                    ? "border-yellow-300 bg-yellow-100 text-neutral-900"
                                    : "border-neutral-200 bg-neutral-50 text-neutral-500 hover:bg-yellow-50 hover:text-neutral-900"
                                }`}
                              >
                                <Clock3 size={14} />
                              </button>
                            )}
                          </div>
                          <p className="text-xs text-neutral-500 truncate">{emp.email}</p>
                          <p className="text-xs text-neutral-500">{emp.telefone || "—"}</p>
                        </div>
                        <Badge className={`${badge.cls} border shrink-0`}>{badge.label}</Badge>
                      </div>
                      <div className="mt-3">
                        {(NOX_INTERNAL_ACCOUNT_TYPES as readonly string[]).includes(
                          emp.accountType,
                        ) ? (
                          <Select
                            value={emp.accountType}
                            onValueChange={(novoValor) =>
                              setPendingRoleChange({
                                id: emp.id,
                                nome: emp.nome,
                                accountType: novoValor as NoxInternalAccountType,
                              })
                            }
                          >
                            <SelectTrigger className="h-8 w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {NOX_INTERNAL_ACCOUNT_TYPES.map((role) => (
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
                      </div>
                      <div className="mt-2 text-xs text-neutral-500">
                        Cadastro:{" "}
                        {emp.criadoEm ? new Date(emp.criadoEm).toLocaleDateString("pt-BR") : "—"} ·
                        Último acesso:{" "}
                        {emp.ultimoAcesso
                          ? new Date(emp.ultimoAcesso).toLocaleString("pt-BR")
                          : "—"}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-3 w-full"
                        onClick={() => alternarStatus(emp)}
                      >
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
                    </div>
                  );
                })
              )}
            </div>

            {/* Tablet/desktop (md:+): tabela completa. */}
            <div className="hidden md:block overflow-x-auto">
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
                      <TableCell
                        colSpan={8}
                        className="text-center text-sm text-muted-foreground py-6"
                      >
                        Nenhum funcionário encontrado.
                      </TableCell>
                    </TableRow>
                  ) : (
                    employeesFiltrados.map((emp) => {
                      const badge = STATUS_BADGE[emp.status];
                      return (
                        <TableRow key={emp.id}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <span>{emp.nome}</span>
                              {emp.cargo === "vendedor" && (
                                <button
                                  type="button"
                                  title={`Controle de ponto: ${emp.timeClockEnabled ? "Sim" : "Não"}`}
                                  aria-label={`Configurar controle de ponto de ${emp.nome}`}
                                  onClick={() =>
                                    setClockEmployee({
                                      id: emp.id,
                                      nome: emp.nome,
                                      enabled: !!emp.timeClockEnabled,
                                      status: emp.status,
                                    })
                                  }
                                  className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors ${
                                    emp.timeClockEnabled
                                      ? "border-yellow-300 bg-yellow-100 text-neutral-900"
                                      : "border-neutral-200 bg-neutral-50 text-neutral-500 hover:bg-yellow-50 hover:text-neutral-900"
                                  }`}
                                >
                                  <Clock3 size={14} />
                                </button>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">{emp.email}</TableCell>
                          <TableCell className="text-xs">{emp.telefone || "—"}</TableCell>
                          <TableCell>
                            {(NOX_INTERNAL_ACCOUNT_TYPES as readonly string[]).includes(
                              emp.accountType,
                            ) ? (
                              <Select
                                value={emp.accountType}
                                onValueChange={(novoValor) =>
                                  setPendingRoleChange({
                                    id: emp.id,
                                    nome: emp.nome,
                                    accountType: novoValor as NoxInternalAccountType,
                                  })
                                }
                              >
                                <SelectTrigger className="h-8 w-36">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {NOX_INTERNAL_ACCOUNT_TYPES.map((role) => (
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
                            {emp.criadoEm
                              ? new Date(emp.criadoEm).toLocaleDateString("pt-BR")
                              : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge className={`${badge.cls} border`}>{badge.label}</Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            {emp.ultimoAcesso
                              ? new Date(emp.ultimoAcesso).toLocaleString("pt-BR")
                              : "—"}
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
      </div>

      <Dialog
        open={!!pendingRoleChange}
        onOpenChange={(open) => !open && setPendingRoleChange(null)}
      >
        <DialogContent className="max-w-md">
          <DialogTitle>Confirmar alteração de cargo</DialogTitle>
          <DialogDescription>
            {pendingRoleChange && (
              <>
                Alterar o cargo de <strong>{pendingRoleChange.nome}</strong> para{" "}
                <strong>{noxInternalAccounts[pendingRoleChange.accountType].label}</strong>?
              </>
            )}
          </DialogDescription>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => setPendingRoleChange(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={confirmarAlteracaoCargo}
              className="bg-neutral-900 hover:bg-neutral-800 text-white"
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!clockEmployee}
        onOpenChange={(open) => !open && !savingClock && setClockEmployee(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogTitle className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-yellow-100 text-neutral-900">
              <Clock3 size={18} />
            </span>
            Controle de ponto
          </DialogTitle>
          <DialogDescription>
            Permitir que <strong>{clockEmployee?.nome}</strong> registre o ponto?
          </DialogDescription>
          <div
            className="grid grid-cols-2 gap-3 py-2"
            role="group"
            aria-label="Ativar controle de ponto"
          >
            <Button
              type="button"
              variant={!clockEmployee?.enabled ? "default" : "outline"}
              disabled={savingClock}
              onClick={() => void salvarControlePonto(false)}
              className={
                !clockEmployee?.enabled ? "bg-neutral-900 text-white hover:bg-neutral-800" : ""
              }
            >
              Não
            </Button>
            <Button
              type="button"
              variant={clockEmployee?.enabled ? "default" : "outline"}
              disabled={savingClock || clockEmployee?.status === "bloqueado"}
              onClick={() => void salvarControlePonto(true)}
              className={
                clockEmployee?.enabled ? "bg-yellow-400 text-neutral-900 hover:bg-yellow-300" : ""
              }
            >
              Sim
            </Button>
          </div>
          {clockEmployee?.status === "bloqueado" && (
            <p className="text-xs text-amber-700">
              Reative a conta antes de habilitar novas marcações.
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={savingClock}
              onClick={() => setClockEmployee(null)}
            >
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
