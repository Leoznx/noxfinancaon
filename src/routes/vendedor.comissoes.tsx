import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertCircle, DollarSign, RefreshCw, ShieldCheck, TrendingUp, Wallet } from "lucide-react";
import { formatDateTime, formatMoney, getSellerContext } from "@/lib/vendedor-portal";
import { calcularGanhoTotal, getNivelComissaoVendedor } from "@/lib/comissao-vendedor";
import { fetchMySellerMonthlyProgress, type SellerMonthlyProgress } from "@/lib/seller-progress";

export const Route = createFileRoute("/vendedor/comissoes")({
  component: () => (
    <ProtectedRoute
      roles={["vendedor", "admin_master", "admin", "financeiro"]}
      moduleKey="comissoes_proprias"
    >
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
  const [progress, setProgress] = useState<SellerMonthlyProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro("");

    try {
      const context = await getSellerContext();
      if (!context.sellerId)
        throw new Error("Não encontramos um vendedor ativo para este usuário.");

      const [commissionResult, monthlyProgress] = await Promise.all([
        supabase
          .from("seller_commissions" as any)
          .select("*, apolices(numero, status)")
          .eq("seller_id", context.sellerId)
          .order("year", { ascending: false })
          .order("month", { ascending: false })
          .order("created_at", { ascending: false }),
        fetchMySellerMonthlyProgress(month, year),
      ]);

      if (commissionResult.error) throw commissionResult.error;
      setRows((commissionResult.data as any[]) ?? []);
      setProgress(monthlyProgress);
    } catch (e: any) {
      setErro(e.message || "Não foi possível carregar suas comissões.");
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => {
    void carregar();
    const refresh = () => void carregar();
    const channel = supabase
      .channel("seller-commissions-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_commissions" },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_client_partnerships" },
        refresh,
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "apolices" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "faturas_inquilino" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "mensalidades" }, refresh)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [carregar]);

  const resumo = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.comissao += Number(row.commission_amount ?? 0);
        acc.bonus += Number(row.bonus_amount ?? 0);
        acc.retido += Number(row.reserve_amount ?? 0);
        acc.liberado += Number(row.released_amount ?? 0);
        return acc;
      },
      { comissao: 0, bonus: 0, retido: 0, liberado: 0 },
    );
  }, [rows]);
  const contratosDoMes = progress?.contracts_closed ?? 0;
  const ganhoDoMes = useMemo(() => calcularGanhoTotal(contratosDoMes), [contratosDoMes]);
  const nivel = useMemo(() => getNivelComissaoVendedor(contratosDoMes), [contratosDoMes]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-yellow-100 p-2 text-yellow-700">
              <DollarSign className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight text-neutral-950">
                Minhas Comissões
              </h1>
              <p className="text-sm font-medium text-neutral-500">
                Somente comissão por contrato e bônus cumulativos — sem valor fixo.
              </p>
            </div>
          </div>
          <Button variant="outline" className="gap-2" onClick={carregar} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>

        <Card className="overflow-hidden border-yellow-300 bg-gradient-to-br from-yellow-50 to-white">
          <CardContent className="grid gap-5 p-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-neutral-950 text-yellow-300 hover:bg-neutral-950">
                  Nível {nivel.nome}
                </Badge>
                <Badge variant="outline">{contratosDoMes} contratos fechados no mês</Badge>
              </div>
              <p className="mt-3 text-lg font-black text-neutral-950">{nivel.mensagem}</p>
              <p className="mt-1 text-sm text-neutral-500">
                Seu próximo contrato vale {formatMoney(nivel.valorPorProximoContrato)} de comissão.
              </p>
            </div>
            <div className="rounded-2xl bg-neutral-950 p-5 text-white lg:min-w-64">
              <TrendingUp className="mb-3 h-5 w-5 text-yellow-300" />
              <p className="text-xs font-black uppercase tracking-widest text-neutral-400">
                Produção estimada do mês
              </p>
              <p className="mt-1 text-3xl font-black text-yellow-300">
                {formatMoney(ganhoDoMes.total)}
              </p>
              <p className="mt-2 text-xs text-neutral-300">
                Comissão {formatMoney(ganhoDoMes.comissao)} + bônus {formatMoney(ganhoDoMes.bonus)}
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-3 md:grid-cols-4">
          <Resumo icon={DollarSign} label="Comissão" value={formatMoney(resumo.comissao)} />
          <Resumo icon={ShieldCheck} label="Bônus" value={formatMoney(resumo.bonus)} />
          <Resumo icon={Wallet} label="Retido" value={formatMoney(resumo.retido)} />
          <Resumo icon={Wallet} label="Liberado" value={formatMoney(resumo.liberado)} />
        </div>

        {erro && <Estado titulo="Não foi possível carregar comissões" descricao={erro} erro />}

        <Card>
          <CardHeader>
            <CardTitle>Histórico de comissões</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Estado
                titulo="Carregando comissões..."
                descricao="Buscando registros financeiros reais."
              />
            ) : !erro && rows.length === 0 ? (
              <Estado
                titulo="Nenhuma comissão registrada"
                descricao="Comissões aparecem após contrato vinculado e primeira parcela conforme o fluxo financeiro."
              />
            ) : (
              !erro && (
                <>
                  {/* Mobile/tablet estreito (< md): cards empilhados, sem tabela pra arrastar. */}
                  <div className="md:hidden divide-y divide-neutral-100">
                    {rows.map((row) => (
                      <div key={row.id} className="py-4 first:pt-0 last:pb-0">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-bold text-neutral-900">
                              {String(row.month).padStart(2, "0")}/{row.year}
                            </p>
                            <p className="text-xs text-neutral-500">
                              Apólice{" "}
                              {row.apolices?.numero ?? row.apolice_id ?? row.contract_id ?? "-"}
                            </p>
                          </div>
                          <Badge variant="outline" className="shrink-0">
                            {STATUS_LABEL[row.status] ?? row.status}
                          </Badge>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                          <div>
                            <p className="text-neutral-400 uppercase text-[10px] font-bold tracking-wide">
                              Comissão
                            </p>
                            <p className="font-semibold text-neutral-900">
                              {formatMoney(row.commission_amount)}
                            </p>
                          </div>
                          <div>
                            <p className="text-neutral-400 uppercase text-[10px] font-bold tracking-wide">
                              Bônus
                            </p>
                            <p className="font-semibold text-neutral-900">
                              {formatMoney(row.bonus_amount)}
                            </p>
                          </div>
                          <div>
                            <p className="text-neutral-400 uppercase text-[10px] font-bold tracking-wide">
                              Retido
                            </p>
                            <p className="font-semibold text-neutral-900">
                              {formatMoney(row.reserve_amount)}
                            </p>
                          </div>
                          <div>
                            <p className="text-neutral-400 uppercase text-[10px] font-bold tracking-wide">
                              Liberado
                            </p>
                            <p className="font-semibold text-neutral-900">
                              {formatMoney(row.released_amount)}
                            </p>
                          </div>
                        </div>
                        <p className="mt-2 text-[10px] text-neutral-400">
                          Liberação:{" "}
                          {formatDateTime(row.released_at || row.reserve_release_at) || "-"}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Tablet/desktop (md:+): tabela completa. */}
                  <div className="hidden md:block overflow-x-auto">
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
                            <TableCell>
                              {String(row.month).padStart(2, "0")}/{row.year}
                            </TableCell>
                            <TableCell>
                              {row.apolices?.numero ?? row.apolice_id ?? row.contract_id ?? "-"}
                            </TableCell>
                            <TableCell>{formatMoney(row.commission_amount)}</TableCell>
                            <TableCell>{formatMoney(row.bonus_amount)}</TableCell>
                            <TableCell>{formatMoney(row.reserve_amount)}</TableCell>
                            <TableCell>{formatMoney(row.released_amount)}</TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {STATUS_LABEL[row.status] ?? row.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {formatDateTime(row.released_at || row.reserve_release_at) || "-"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )
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

function Estado({
  titulo,
  descricao,
  erro = false,
}: {
  titulo: string;
  descricao: string;
  erro?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-8 text-center ${erro ? "border-red-200 bg-red-50 text-red-800" : "border-dashed border-neutral-200 bg-white text-neutral-500"}`}
    >
      <AlertCircle
        className={`mx-auto mb-2 h-4 w-4 ${erro ? "text-red-600" : "text-neutral-400"}`}
      />
      <p className="font-bold">{titulo}</p>
      <p className="mt-1 text-sm">{descricao}</p>
    </div>
  );
}
