import { createFileRoute, Link } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { registrarAuditoria } from "@/lib/auditoria";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Search,
  Briefcase,
  Building2,
  Users,
  FileText,
  UserCog,
  ShieldCheck,
  Eye,
  Crown,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/usuarios")({
  component: () => (
    <ProtectedRoute
      roles={["admin", "analista", "juridico", "suporte", "admin_master"]}
      moduleKey="usuarios"
    >
      <UsuariosUnificadosPage />
    </ProtectedRoute>
  ),
});

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  analista: "Analista",
  corretor: "Corretor",
  imobiliaria: "Imobiliária",
  proprietario: "Proprietário",
  inquilino: "Inquilino",
  financeiro: "Financeiro",
  comercial: "Comercial",
  admin_master: "Admin Master",
  juridico: "Jurídico",
  marketing: "Marketing",
  suporte: "Suporte",
  vendedor: "Vendedor",
};

const ROLES_EQUIPE = [
  "admin",
  "analista",
  "admin_master",
  "juridico",
  "financeiro",
  "marketing",
  "suporte",
  "vendedor",
  "comercial",
];

type UsuarioLinha = {
  id: string;
  nome: string | null;
  email: string;
  telefone: string | null;
  role: string;
  createdAt: string;
  documento: string | null;
  detalhesCadastro: string[];
  temContratoAtivo: boolean;
  qtdConsultas: number;
};

function UsuariosUnificadosPage() {
  const { user } = useAuth();
  const isAdminMaster = user?.role === "admin_master" || user?.internalRole === "admin_master";
  const [loading, setLoading] = useState(true);
  const [usuarios, setUsuarios] = useState<UsuarioLinha[]>([]);
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"todos" | "com_contrato" | "sem_contrato">(
    "todos",
  );
  const [detalhe, setDetalhe] = useState<UsuarioLinha | null>(null);
  const [promovendo, setPromovendo] = useState<UsuarioLinha | null>(null);
  const [promovendoLoading, setPromovendoLoading] = useState(false);

  const carregar = async () => {
    setLoading(true);
    try {
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("id, nome, email, telefone, role, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;

      const ids = (profiles ?? []).map((p: any) => p.id);
      const emails = (profiles ?? []).map((p: any) => p.email);

      const [corretoresRes, inquilinosRes, proprietariosRes, imobiliariasRes, consultasRes] =
        await Promise.all([
          ids.length
            ? supabase
                .from("corretores")
                .select("profile_id, cpf, creci, susep, imobiliaria_id")
                .in("profile_id", ids)
            : Promise.resolve({ data: [] as any[] }),
          ids.length
            ? supabase.from("inquilinos").select("profile_id, cpf, cnpj").in("profile_id", ids)
            : Promise.resolve({ data: [] as any[] }),
          ids.length
            ? supabase.from("proprietarios").select("profile_id, cpf_cnpj").in("profile_id", ids)
            : Promise.resolve({ data: [] as any[] }),
          emails.length
            ? supabase
                .from("imobiliarias")
                .select("contato_email, cnpj, razao_social, nome_fantasia, cidade, estado")
                .in("contato_email", emails)
            : Promise.resolve({ data: [] as any[] }),
          ids.length
            ? supabase
                .from("consultas_credito")
                .select("id, profile_id_solicitante")
                .in("profile_id_solicitante", ids)
            : Promise.resolve({ data: [] as any[] }),
        ]);

      const documentoPorProfile = new Map<string, string>();
      const detalhesPorProfile = new Map<string, string[]>();
      const adicionarDetalhe = (profileId: string, detalhe?: string | null) => {
        if (!detalhe) return;
        const arr = detalhesPorProfile.get(profileId) ?? [];
        arr.push(detalhe);
        detalhesPorProfile.set(profileId, arr);
      };
      (corretoresRes.data ?? []).forEach((c: any) => {
        if (c.cpf) documentoPorProfile.set(c.profile_id, c.cpf);
        adicionarDetalhe(c.profile_id, c.creci ? `CRECI ${c.creci}` : null);
        adicionarDetalhe(c.profile_id, c.susep ? `SUSEP ${c.susep}` : null);
      });
      (inquilinosRes.data ?? []).forEach((i: any) => {
        if (i.cpf || i.cnpj) documentoPorProfile.set(i.profile_id, i.cpf || i.cnpj);
      });
      (proprietariosRes.data ?? []).forEach((p: any) => {
        if (p.cpf_cnpj) documentoPorProfile.set(p.profile_id, p.cpf_cnpj);
      });
      // imobiliarias não tem profile_id - só o link por contato_email (mesmo padrão já usado em dashboard.tsx)
      const cnpjPorEmail = new Map<string, string>();
      const detalhesPorEmail = new Map<string, string[]>();
      (imobiliariasRes.data ?? []).forEach((i: any) => {
        if (i.cnpj) cnpjPorEmail.set(i.contato_email, i.cnpj);
        const detalhes = [
          i.nome_fantasia || i.razao_social ? `Empresa ${i.nome_fantasia || i.razao_social}` : null,
          i.cidade || i.estado
            ? `${i.cidade ?? ""}${i.cidade && i.estado ? "/" : ""}${i.estado ?? ""}`
            : null,
        ].filter(Boolean) as string[];
        if (detalhes.length) detalhesPorEmail.set(i.contato_email, detalhes);
      });

      // Real "tem contrato ativo": profile_id_solicitante -> apolices.consulta_id (status='ativa') -
      // não as colunas *_profile_id de apolices, que ficam NULL em 100% das linhas reais (já
      // confirmado nesta sessão em dashboard-stats.ts/niveis-parceria.ts).
      const consultaIdsPorProfile = new Map<string, string[]>();
      const profilePorConsulta = new Map<string, string>();
      (consultasRes.data ?? []).forEach((c: any) => {
        if (!c.profile_id_solicitante) return;
        const arr = consultaIdsPorProfile.get(c.profile_id_solicitante) ?? [];
        arr.push(c.id);
        consultaIdsPorProfile.set(c.profile_id_solicitante, arr);
        profilePorConsulta.set(c.id, c.profile_id_solicitante);
      });

      const todasConsultaIds = Array.from(profilePorConsulta.keys());
      const { data: apolicesData } = todasConsultaIds.length
        ? await supabase
            .from("apolices")
            .select("consulta_id")
            .eq("status", "ativa")
            .in("consulta_id", todasConsultaIds)
        : { data: [] as any[] };

      const profilesComContrato = new Set<string>();
      (apolicesData ?? []).forEach((a: any) => {
        const pid = profilePorConsulta.get(a.consulta_id);
        if (pid) profilesComContrato.add(pid);
      });

      const linhas: UsuarioLinha[] = (profiles ?? []).map((p: any) => ({
        id: p.id,
        nome: p.nome,
        email: p.email,
        telefone: p.telefone,
        role: p.role,
        createdAt: p.created_at,
        documento: documentoPorProfile.get(p.id) || cnpjPorEmail.get(p.email) || null,
        detalhesCadastro: [
          ...(detalhesPorProfile.get(p.id) ?? []),
          ...(detalhesPorEmail.get(p.email) ?? []),
        ],
        temContratoAtivo: profilesComContrato.has(p.id),
        qtdConsultas: (consultaIdsPorProfile.get(p.id) ?? []).length,
      }));

      setUsuarios(linhas);
    } catch (e: any) {
      toast.error("Erro ao carregar usuários: " + (e?.message ?? "desconhecido"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const porCategoria = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const passaBusca = (u: UsuarioLinha) =>
      !q ||
      (u.nome ?? "").toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.telefone ?? "").toLowerCase().includes(q) ||
      (u.documento ?? "").toLowerCase().includes(q) ||
      u.detalhesCadastro.some((d) => d.toLowerCase().includes(q));
    const passaStatus = (u: UsuarioLinha) =>
      filtroStatus === "todos" ||
      (filtroStatus === "com_contrato" && u.temContratoAtivo) ||
      (filtroStatus === "sem_contrato" && !u.temContratoAtivo);

    const filtrados = usuarios.filter((u) => passaBusca(u) && passaStatus(u));
    return {
      todos: filtrados,
      proprietario: filtrados.filter((u) => u.role === "proprietario"),
      imobiliaria: filtrados.filter((u) => u.role === "imobiliaria"),
      inquilino: filtrados.filter((u) => u.role === "inquilino"),
      corretor: filtrados.filter((u) => u.role === "corretor"),
      equipe: filtrados.filter((u) => ROLES_EQUIPE.includes(u.role)),
    };
  }, [usuarios, busca, filtroStatus]);

  const promoverAdmin = async () => {
    if (!promovendo) return;
    setPromovendoLoading(true);
    const antes = promovendo.role;
    const { error } = await supabase
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", promovendo.id);
    setPromovendoLoading(false);
    if (error) {
      toast.error("Erro ao promover: " + error.message);
      return;
    }
    toast.success(`${promovendo.nome || promovendo.email} agora é Admin.`);
    registrarAuditoria({
      actorUserId: user?.id,
      actorRole: user?.internalRole || user?.role,
      action: "promover_admin",
      tableName: "profiles",
      recordId: promovendo.id,
      before: { role: antes },
      after: { role: "admin" },
    });
    setPromovendo(null);
    carregar();
  };

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">Usuários</h1>
          <p className="text-neutral-500 mt-2 font-medium">
            Todo cadastro feito no site da NOX Fiança, com status real de contrato.
          </p>
        </div>

        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1 max-w-md">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
              size={18}
            />
            <Input
              placeholder="Buscar por nome, e-mail, telefone ou CPF/CNPJ..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-10 h-11"
            />
          </div>
          <Select value={filtroStatus} onValueChange={(v: any) => setFiltroStatus(v)}>
            <SelectTrigger className="w-full md:w-56 h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os status</SelectItem>
              <SelectItem value="com_contrato">Com contrato ativo</SelectItem>
              <SelectItem value="sem_contrato">Sem contrato</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Tabs defaultValue="todos" className="w-full">
          <TabsList className="bg-neutral-100 p-1 rounded-lg h-auto flex-wrap justify-start">
            <TabsTrigger value="todos" className="gap-2">
              Todos{" "}
              <Badge variant="secondary" className="ml-1">
                {porCategoria.todos.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="proprietario" className="gap-2">
              <Briefcase size={16} /> Proprietários{" "}
              <Badge variant="secondary" className="ml-1">
                {porCategoria.proprietario.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="imobiliaria" className="gap-2">
              <Building2 size={16} /> Imobiliárias{" "}
              <Badge variant="secondary" className="ml-1">
                {porCategoria.imobiliaria.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="inquilino" className="gap-2">
              <Users size={16} /> Inquilinos{" "}
              <Badge variant="secondary" className="ml-1">
                {porCategoria.inquilino.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="corretor" className="gap-2">
              <UserCog size={16} /> Corretores{" "}
              <Badge variant="secondary" className="ml-1">
                {porCategoria.corretor.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="equipe" className="gap-2">
              <ShieldCheck size={16} /> Equipe/Admins{" "}
              <Badge variant="secondary" className="ml-1">
                {porCategoria.equipe.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          {(
            ["todos", "proprietario", "imobiliaria", "inquilino", "corretor", "equipe"] as const
          ).map((chave) => (
            <TabsContent key={chave} value={chave} className="mt-6">
              <Lista
                loading={loading}
                itens={porCategoria[chave]}
                vazio="Nenhum usuário encontrado."
                isAdminMaster={isAdminMaster}
                onVerDetalhes={setDetalhe}
                onPromover={setPromovendo}
              />
            </TabsContent>
          ))}
        </Tabs>
      </div>

      <Dialog open={!!detalhe} onOpenChange={(o) => !o && setDetalhe(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Detalhes do usuário</DialogTitle>
          </DialogHeader>
          {detalhe && (
            <div className="space-y-3 text-sm">
              <Info label="Nome" value={detalhe.nome ?? "Sem nome"} />
              <Info label="E-mail" value={detalhe.email} />
              <Info label="Telefone" value={detalhe.telefone ?? "-"} />
              <Info label="CPF/CNPJ" value={detalhe.documento ?? "-"} />
              <Info
                label="Cadastro completo"
                value={detalhe.detalhesCadastro.length ? detalhe.detalhesCadastro.join(" | ") : "-"}
              />
              <Info label="Tipo de usuário" value={ROLE_LABEL[detalhe.role] ?? detalhe.role} />
              <Info
                label="Cadastro"
                value={new Date(detalhe.createdAt).toLocaleDateString("pt-BR")}
              />
              <Info label="Consultas realizadas" value={String(detalhe.qtdConsultas)} />
              <Info label="Contrato ativo" value={detalhe.temContratoAtivo ? "Sim" : "Não"} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetalhe(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!promovendo} onOpenChange={(o) => !o && setPromovendo(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Transformar em Admin</DialogTitle>
            <DialogDescription>
              {promovendo?.nome || promovendo?.email} passará a ter acesso total ao sistema como
              Admin. Essa ação é registrada na Auditoria.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPromovendo(null)}>
              Cancelar
            </Button>
            <Button
              onClick={promoverAdmin}
              disabled={promovendoLoading}
              className="bg-neutral-900 hover:bg-neutral-800 text-white"
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-neutral-100 pb-2">
      <span className="text-neutral-500">{label}</span>
      <span className="font-semibold text-neutral-900 text-right">{value}</span>
    </div>
  );
}

function Lista({
  loading,
  itens,
  vazio,
  isAdminMaster,
  onVerDetalhes,
  onPromover,
}: {
  loading: boolean;
  itens: UsuarioLinha[];
  vazio: string;
  isAdminMaster: boolean;
  onVerDetalhes: (u: UsuarioLinha) => void;
  onPromover: (u: UsuarioLinha) => void;
}) {
  if (loading) {
    return (
      <div className="border border-neutral-200 rounded-xl bg-white py-20 text-center text-neutral-400">
        Carregando...
      </div>
    );
  }
  if (!itens.length) {
    return (
      <div className="border border-dashed border-neutral-300 rounded-xl bg-white py-20 text-center text-neutral-500">
        {vazio}
      </div>
    );
  }
  return (
    <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-sm divide-y divide-neutral-100">
      {itens.map((u) => (
        <div
          key={u.id}
          className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-6 py-4 hover:bg-neutral-50"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-neutral-100 border border-neutral-200 flex items-center justify-center text-xs font-bold uppercase text-neutral-600 shrink-0">
              {(u.nome ?? u.email ?? "?").substring(0, 2)}
            </div>
            <div className="min-w-0">
              <p className="font-bold text-neutral-900 truncate">{u.nome ?? "Sem nome"}</p>
              <p className="text-xs text-neutral-500 truncate">
                {u.email} {u.telefone ? `· ${u.telefone}` : ""}{" "}
                {u.documento ? `· ${u.documento}` : ""}
              </p>
              {u.detalhesCadastro.length > 0 && (
                <p className="text-xs text-neutral-400 truncate">
                  {u.detalhesCadastro.join(" | ")}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Badge variant="outline" className="uppercase text-[10px] font-bold">
              {ROLE_LABEL[u.role] ?? u.role}
            </Badge>
            {u.temContratoAtivo ? (
              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 gap-1">
                <FileText size={12} /> Com contrato ativo
              </Badge>
            ) : (
              <Badge className="bg-neutral-100 text-neutral-500 border-neutral-200">
                Sem contrato
              </Badge>
            )}
            <Button size="sm" variant="outline" className="gap-1" onClick={() => onVerDetalhes(u)}>
              <Eye size={14} /> Ver detalhes
            </Button>
            {u.temContratoAtivo && (
              <Link to="/admin/contratos">
                <Button size="sm" variant="outline">
                  Ver contratos
                </Button>
              </Link>
            )}
            {isAdminMaster && u.role !== "admin" && u.role !== "admin_master" && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1 text-yellow-700 border-yellow-300"
                onClick={() => onPromover(u)}
              >
                <Crown size={14} /> Transformar em Admin
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
