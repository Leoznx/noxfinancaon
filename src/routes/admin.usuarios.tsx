import { createFileRoute, Link } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, Briefcase, Building2, Users, FileText } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/usuarios")({
  component: () => (
    <ProtectedRoute roles={["admin", "analista"]}>
      <UsuariosUnificadosPage />
    </ProtectedRoute>
  ),
});

type Bucket = {
  profile_id: string;
  nome: string | null;
  email: string | null;
  telefone: string | null;
  contratos: number;
};

function UsuariosUnificadosPage() {
  const [loading, setLoading] = useState(true);
  const [proprietarios, setProprietarios] = useState<Bucket[]>([]);
  const [imobiliarias, setImobiliarias] = useState<Bucket[]>([]);
  const [inquilinos, setInquilinos] = useState<Bucket[]>([]);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    let cancelado = false;
    (async () => {
      setLoading(true);
      try {
        const { data: apolices, error } = await supabase
          .from("apolices")
          .select(
            "id, status, proprietario_profile_id, imobiliaria_profile_id, consulta:consultas_credito(inquilino:inquilinos(id, nome, documento, email, telefone))"
          )
          .eq("status", "ativa");
        if (error) throw error;

        const propIds = new Set<string>();
        const imobIds = new Set<string>();
        const inqMap = new Map<string, Bucket>();
        const propCount = new Map<string, number>();
        const imobCount = new Map<string, number>();

        (apolices ?? []).forEach((a: any) => {
          if (a.proprietario_profile_id) {
            propIds.add(a.proprietario_profile_id);
            propCount.set(a.proprietario_profile_id, (propCount.get(a.proprietario_profile_id) ?? 0) + 1);
          }
          if (a.imobiliaria_profile_id) {
            imobIds.add(a.imobiliaria_profile_id);
            imobCount.set(a.imobiliaria_profile_id, (imobCount.get(a.imobiliaria_profile_id) ?? 0) + 1);
          }
          const inq = a.consulta?.inquilino;
          if (inq?.id) {
            const cur = inqMap.get(inq.id);
            inqMap.set(inq.id, {
              profile_id: inq.id,
              nome: inq.nome,
              email: inq.email,
              telefone: inq.telefone,
              contratos: (cur?.contratos ?? 0) + 1,
            });
          }
        });

        const [propRes, imobRes] = await Promise.all([
          propIds.size
            ? supabase.from("profiles").select("id, nome, email, telefone").in("id", Array.from(propIds))
            : Promise.resolve({ data: [], error: null } as any),
          imobIds.size
            ? supabase.from("profiles").select("id, nome, email, telefone").in("id", Array.from(imobIds))
            : Promise.resolve({ data: [], error: null } as any),
        ]);

        if (cancelado) return;
        setProprietarios(
          (propRes.data ?? []).map((p: any) => ({
            profile_id: p.id,
            nome: p.nome,
            email: p.email,
            telefone: p.telefone,
            contratos: propCount.get(p.id) ?? 0,
          }))
        );
        setImobiliarias(
          (imobRes.data ?? []).map((p: any) => ({
            profile_id: p.id,
            nome: p.nome,
            email: p.email,
            telefone: p.telefone,
            contratos: imobCount.get(p.id) ?? 0,
          }))
        );
        setInquilinos(Array.from(inqMap.values()));
      } catch (e: any) {
        toast.error("Erro ao carregar usuários: " + (e?.message ?? "desconhecido"));
      } finally {
        if (!cancelado) setLoading(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  const filtrar = (lista: Bucket[]) => {
    const q = busca.trim().toLowerCase();
    if (!q) return lista;
    return lista.filter(
      (b) =>
        (b.nome ?? "").toLowerCase().includes(q) ||
        (b.email ?? "").toLowerCase().includes(q) ||
        (b.telefone ?? "").toLowerCase().includes(q)
    );
  };

  const filtrados = useMemo(
    () => ({
      proprietarios: filtrar(proprietarios),
      imobiliarias: filtrar(imobiliarias),
      inquilinos: filtrar(inquilinos),
    }),
    [busca, proprietarios, imobiliarias, inquilinos]
  );

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">Usuários</h1>
          <p className="text-neutral-500 mt-2 font-medium">
            Apenas usuários com contrato ativo. Leads e cadastros sem contrato ficam na aba Leads.
          </p>
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
          <Input
            placeholder="Buscar por nome, e-mail ou telefone..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-10 h-11"
          />
        </div>

        <Tabs defaultValue="proprietarios" className="w-full">
          <TabsList className="bg-neutral-100 p-1 rounded-lg">
            <TabsTrigger value="proprietarios" className="gap-2">
              <Briefcase size={16} /> Proprietários
              <Badge variant="secondary" className="ml-1">{proprietarios.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="imobiliarias" className="gap-2">
              <Building2 size={16} /> Imobiliárias
              <Badge variant="secondary" className="ml-1">{imobiliarias.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="inquilinos" className="gap-2">
              <Users size={16} /> Inquilinos
              <Badge variant="secondary" className="ml-1">{inquilinos.length}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="proprietarios" className="mt-6">
            <Lista loading={loading} itens={filtrados.proprietarios} vazio="Nenhum proprietário com contrato ativo." />
          </TabsContent>
          <TabsContent value="imobiliarias" className="mt-6">
            <Lista loading={loading} itens={filtrados.imobiliarias} vazio="Nenhuma imobiliária com contrato ativo." />
          </TabsContent>
          <TabsContent value="inquilinos" className="mt-6">
            <Lista loading={loading} itens={filtrados.inquilinos} vazio="Nenhum inquilino com contrato ativo." />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function Lista({ loading, itens, vazio }: { loading: boolean; itens: Bucket[]; vazio: string }) {
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
        <div key={u.profile_id} className="flex items-center justify-between gap-4 px-6 py-4 hover:bg-neutral-50">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-neutral-100 border border-neutral-200 flex items-center justify-center text-xs font-bold uppercase text-neutral-600">
              {(u.nome ?? "?").substring(0, 2)}
            </div>
            <div className="min-w-0">
              <p className="font-bold text-neutral-900 truncate">{u.nome ?? "Sem nome"}</p>
              <p className="text-xs text-neutral-500 truncate">
                {u.email ?? "—"} {u.telefone ? `· ${u.telefone}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 gap-1">
              <FileText size={12} /> {u.contratos} {u.contratos === 1 ? "contrato" : "contratos"}
            </Badge>
            <Link to="/admin/contratos">
              <Button size="sm" variant="outline">Ver contratos</Button>
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
