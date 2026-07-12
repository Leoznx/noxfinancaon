import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertCircle, DollarSign, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { formatDateTime, formatMoney, getSellerContext } from "@/lib/vendedor-portal";

export const Route = createFileRoute("/vendedor/comissoes")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin", "financeiro"]} moduleKey="comissoes_proprias">
      <Comissoes />
    </ProtectedRoute>
  ),
});

const STATUS_LABEL: Record<string, string> = {
  aguardando_primeira_parcela: "Aguardando 1ª parcela",
  pendente: "Pendente",
  elegivel: "Elegível",
  retida: "Retida",
  liberada_parcial: "Liberada parcial",
  liberada_total: "Liberada total",
  estornada: "Estornada",
  cancelada: "Cancelada",
};

function Comissoes() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");

  async function carregar() {
    setLoading(true);
    setErro("");

    try {
      const context = await getSellerContext();
      if (!context.sellerId) throw new Error("Não encontramos um vendedor ativo para este usuário.");

      const { data, error } = await supabase
        .from("seller_commissions" as any)
        .select("*, apolices(numero, status)")
        .eq("seller_id", context.sellerId)
        .order("year", { ascending: false })
        .order("month", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) throw error;
      setRows((data as any[]) ?? []);
    } catch (e: any) {
      setErro(e.message || "Não foi possível carregar suas comissões.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { carregar(); }, []);

  const resumo = useMemo(() => {
    return rows.reduce((acc, row) => {
      acc.comissao += Number(row.commission_amount ?? 0);
      acc.bonus += Number(row.bonus_amount ?? 0);
      acc.retido += Number(row.reserve_amount ?? 0);
      acc.liberado += Number(row.released_amount ?? 0);
      return acc;
    }, { comissao: 0, bonus: 0, retido: 0, liberado: 0 });
  }, [rows]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-yellow-100 p-2 text-yellow-700">
              <DollarSign className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight text-neutral-950">Minhas Comissões</h1>
              <p className="text-sm font-medium text-neutral-500">Valores registrados após vínculo de contrato e regra financeira.</p>
            </div>
          </div>
          <Button variant="outline" className="gap-2" onClick={carregar} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <Resumo icon={DollarSign} label="Comissão" value={formatMoney(resumo.comissao)} />
          <Resumo icon={ShieldCheck} label="Bônus" value={formatMoney(resumo.bonus)} />
          <Resumo icon={Wallet} label="Retido" value={formatMoney(resumo.retido)} />
          <Resumo icon={Wallet} label="Liberado" value={formatMoney(resumo.liberado)} />
        </div>

        {erro && <Estado titulo="Não foi possível carregar comissões" descricao={erro} erro />}

        <Card>
          <CardHeader><CardTitle>Histórico de comissões</CardTitle></CardHeader>
          <CardContent>
            {loading ? (
              <Estado titulo="Carregando comissões..." descricao="Buscando registros financeiros reais." />
            ) : !erro && rows.length === 0 ? (
              <Estado titulo="Nenhuma comissão registrada" descricao="Comissões aparecem após contrato vinculado e primeira parcela conforme o fluxo financeiro." />
            ) : !erro && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Período</TableHead>
                      <TableHead>Apólice</TableHead>
                      <TableHead>Comissão</TableHead>
                      <TableHead>Bônus</TableHead>
                      <TableHead>Retido</TableHead>
                      <TableHead>Liberado</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Liberação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>{String(row.month).padStart(2, "0")}/{row.year}</TableCell>
                        <TableCell>{row.apolices?.numero ?? row.apolice_id ?? row.contract_id ?? "-"}</TableCell>
                        <TableCell>{formatMoney(row.commission_amount)}</TableCell>
                        <TableCell>{formatMoney(row.bonus_amount)}</TableCell>
                        <TableCell>{formatMoney(row.reserve_amount)}</TableCell>
                        <TableCell>{formatMoney(row.released_amount)}</TableCell>
                        <TableCell><Badge variant="outline">{STATUS_LABEL[row.status] ?? row.status}</Badge></TableCell>
                        <TableCell>{formatDateTime(row.released_at || row.reserve_release_at) || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function Resumo({ icon: Icon, label, value }: any) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <Icon className="mb-3 h-4 w-4 text-yellow-700" />
      <p className="text-xs font-medium text-neutral-500">{label}</p>
      <p className="text-2xl font-black text-neutral-950">{value}</p>
    </div>
  );
}

function Estado({ titulo, descricao, erro = false }: { titulo: string; descricao: string; erro?: boolean }) {
  return (
    <div className={`rounded-2xl border p-8 text-center ${erro ? "border-red-200 bg-red-50 text-red-800" : "border-dashed border-neutral-200 bg-white text-neutral-500"}`}>
      <AlertCircle className={`mx-auto mb-2 h-4 w-4 ${erro ? "text-red-600" : "text-neutral-400"}`} />
      <p className="font-bold">{titulo}</p>
      <p className="mt-1 text-sm">{descricao}</p>
    </div>
  );
}
