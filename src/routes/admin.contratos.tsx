import { createFileRoute, Link } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Eye } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/contratos")({
  component: () => (
    <ProtectedRoute roles={["admin", "analista", "juridico", "admin_master"]} moduleKey="contratos">
      <ContratosAdminPage />
    </ProtectedRoute>
  ),
});

function ContratosAdminPage() {
  const [linhas, setLinhas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<string>("todos");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("apolices")
        .select(
          "id, numero, status, vigencia_inicio, vigencia_fim, valor_premio, created_at, consulta:consultas_credito(tenant_name, tenant_document, property_address, rent_value)"
        )
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) toast.error("Erro ao carregar contratos");
      else setLinhas(data ?? []);
      setLoading(false);
    })();
  }, []);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhas.filter((a) => {
      if (status !== "todos" && a.status !== status) return false;
      if (!q) return true;
      return (
        (a.numero ?? "").toLowerCase().includes(q) ||
        (a.consulta?.tenant_name ?? "").toLowerCase().includes(q) ||
        (a.consulta?.tenant_document ?? "").toLowerCase().includes(q) ||
        (a.consulta?.property_address ?? "").toLowerCase().includes(q)
      );
    });
  }, [linhas, busca, status]);

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">Contratos Ativos</h1>
          <p className="text-neutral-500 mt-2 font-medium">Histórico completo de contratos cadastrados na plataforma.</p>
        </div>

        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nº, inquilino, CPF ou endereço..." className="pl-10 h-11" />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-48 h-11"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os status</SelectItem>
              <SelectItem value="ativa">Ativa</SelectItem>
              <SelectItem value="encerrada">Encerrada</SelectItem>
              <SelectItem value="cancelada">Cancelada</SelectItem>
              <SelectItem value="suspensa">Suspensa</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-sm">
          <Table>
            <TableHeader className="bg-neutral-50">
              <TableRow>
                <TableHead className="px-6">Nº Contrato</TableHead>
                <TableHead>Inquilino</TableHead>
                <TableHead>Imóvel</TableHead>
                <TableHead>Vigência</TableHead>
                <TableHead>Prêmio</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right pr-6">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-16 text-neutral-400">Carregando...</TableCell></TableRow>
              ) : !filtradas.length ? (
                <TableRow><TableCell colSpan={7} className="text-center py-16 text-neutral-500">Nenhum contrato encontrado.</TableCell></TableRow>
              ) : filtradas.map((a) => (
                <TableRow key={a.id} className="hover:bg-neutral-50/50">
                  <TableCell className="px-6 font-bold text-neutral-900">{a.numero}</TableCell>
                  <TableCell>
                    <p className="font-semibold">{a.consulta?.tenant_name ?? "—"}</p>
                    <p className="text-xs text-neutral-500">{a.consulta?.tenant_document ?? ""}</p>
                  </TableCell>
                  <TableCell className="text-xs text-neutral-500 max-w-[220px] truncate">{a.consulta?.property_address ?? "—"}</TableCell>
                  <TableCell className="text-xs text-neutral-500">
                    {new Date(a.vigencia_inicio).toLocaleDateString("pt-BR")} → {new Date(a.vigencia_fim).toLocaleDateString("pt-BR")}
                  </TableCell>
                  <TableCell>R$ {Number(a.valor_premio).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</TableCell>
                  <TableCell><StatusBadge status={a.status} /></TableCell>
                  <TableCell className="text-right pr-6">
                    <Link to="/apolices/$id" params={{ id: a.id }}>
                      <Button size="sm" variant="ghost" className="gap-1"><Eye size={14} /> Detalhes</Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </DashboardLayout>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ativa: "bg-emerald-100 text-emerald-700 border-emerald-200",
    encerrada: "bg-neutral-100 text-neutral-700 border-neutral-200",
    cancelada: "bg-red-100 text-red-700 border-red-200",
    suspensa: "bg-amber-100 text-amber-700 border-amber-200",
  };
  return <Badge className={map[status] ?? "bg-neutral-100 text-neutral-700"}>{status}</Badge>;
}
