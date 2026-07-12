import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { RouteErrorFallback } from "@/components/RouteErrorFallback";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, Eye } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/consultas")({
  component: () => (
    <ProtectedRoute roles={["admin", "analista", "admin_master"]} moduleKey="consultas">
      <ConsultasAdminPage />
    </ProtectedRoute>
  ),
  errorComponent: ({ error, reset }) => (
    <RouteErrorFallback
      error={error}
      reset={reset}
      message="Não foi possível carregar as consultas."
    />
  ),
});

function ConsultasAdminPage() {
  const [linhas, setLinhas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<string>("todas");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("consultas_credito")
        .select(
          "id, status, created_at, tenant_name, tenant_document, property_address, rent_value, role_solicitante, profile_id_solicitante",
        )
        .in("status", ["aprovado", "reprovado", "recusado"])
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) toast.error("Erro ao carregar consultas");
      else setLinhas(data ?? []);
      setLoading(false);
    })();
  }, []);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhas.filter((c) => {
      // "reprovado" (reprovação manual) e "recusado" (recusa automática do CredPago)
      // são os dois jeitos que uma consulta finaliza como negada — agrupa como um só
      // filtro pro admin, já que a distinção é interna, não faz sentido pra quem usa.
      if (status === "reprovado" && c.status !== "reprovado" && c.status !== "recusado")
        return false;
      if (status !== "todas" && status !== "reprovado" && c.status !== status) return false;
      if (!q) return true;
      return (
        (c.tenant_name ?? "").toLowerCase().includes(q) ||
        (c.tenant_document ?? "").toLowerCase().includes(q) ||
        (c.property_address ?? "").toLowerCase().includes(q)
      );
    });
  }, [linhas, busca, status]);

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">Consultas</h1>
          <p className="text-neutral-500 mt-2 font-medium">
            Consultas já analisadas (aprovadas ou reprovadas). Pendentes ficam em Aprovações.
          </p>
        </div>

        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1 max-w-md">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
              size={18}
            />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por inquilino, CPF ou endereço..."
              className="pl-10 h-11"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-48 h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todos</SelectItem>
              <SelectItem value="aprovado">Aprovadas</SelectItem>
              <SelectItem value="reprovado">Reprovadas</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-sm">
          <Table>
            <TableHeader className="bg-neutral-50">
              <TableRow>
                <TableHead className="px-6">Inquilino</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Imóvel</TableHead>
                <TableHead>Aluguel</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Data</TableHead>
                <TableHead className="text-right pr-6">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-16 text-neutral-400">
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : !filtradas.length ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-16 text-neutral-500">
                    Nenhuma consulta encontrada.
                  </TableCell>
                </TableRow>
              ) : (
                filtradas.map((c) => (
                  <TableRow key={c.id} className="hover:bg-neutral-50/50">
                    <TableCell className="px-6 font-semibold">{c.tenant_name ?? "—"}</TableCell>
                    <TableCell className="text-xs text-neutral-500">
                      {c.tenant_document ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-neutral-500 max-w-[220px] truncate">
                      {c.property_address ?? "—"}
                    </TableCell>
                    <TableCell>
                      {c.rent_value
                        ? `R$ ${Number(c.rent_value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs uppercase text-neutral-500">
                      {c.role_solicitante ?? "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="text-xs text-neutral-400">
                      {new Date(c.created_at).toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell className="text-right pr-6">
                      <a href={`/consultas/${c.id}/resultado`}>
                        <Button size="sm" variant="ghost" className="gap-1">
                          <Eye size={14} /> Ver
                        </Button>
                      </a>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </DashboardLayout>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    aprovado: "bg-emerald-100 text-emerald-700 border-emerald-200",
    pendente: "bg-amber-100 text-amber-700 border-amber-200",
    reprovado: "bg-red-100 text-red-700 border-red-200",
    recusado: "bg-red-100 text-red-700 border-red-200",
  };
  const labels: Record<string, string> = {
    aprovado: "Aprovado",
    pendente: "Pendente",
    reprovado: "Reprovado",
    recusado: "Recusado",
  };
  return (
    <Badge className={map[status] ?? "bg-neutral-100 text-neutral-700"}>
      {labels[status] ?? status}
    </Badge>
  );
}
