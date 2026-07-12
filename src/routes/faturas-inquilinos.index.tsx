import { createFileRoute, Link } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { Receipt, Eye, AlertCircle, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/faturas-inquilinos/")({
  component: () => (
    <ProtectedRoute moduleKey="faturas">
      <ErrorBoundary nome="faturas-inquilinos">
        <FaturasInquilinosLista />
      </ErrorBoundary>
    </ProtectedRoute>
  ),
});

type StatusFatura = "em_dia" | "a_vencer" | "vencido";

type Linha = {
  apolice_id: string;
  numero: string;
  inquilino_nome: string;
  inquilino_doc: string;
  cidade: string;
  valor_parcela: number;
  proximo_venc: string | null;
  status: StatusFatura;
};

const formatBRL = (v: number) =>
  (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const formatDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("pt-BR") : "—";

function extrairCidade(im: any): string {
  if (!im) return "Cidade não informada";
  if (im.cidade) return im.cidade;
  const end = im.endereco || im.logradouro;
  if (typeof end === "string" && end.includes(",")) {
    const partes = end.split(",").map((s: string) => s.trim()).filter(Boolean);
    if (partes.length >= 2) return partes[partes.length - 2] || partes[partes.length - 1];
  }
  return "Cidade não informada";
}

function FaturasInquilinosLista() {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErro(null);
    try {
      const { data: aps, error: apErr } = await supabase
        .from("apolices")
        .select(`
          id, numero, status,
          consulta:consultas_credito(
            inquilino:inquilinos(nome, cpf, cnpj, razao_social),
            imovel:imoveis(endereco, logradouro, numero, bairro, cidade, estado)
          )
        `)
        .order("created_at", { ascending: false });
      if (apErr) throw apErr;

      const ids = (aps || []).map((a: any) => a.id);
      const parcelasByAp: Record<string, any[]> = {};
      if (ids.length) {
        const { data: ms } = await supabase
          .from("mensalidades")
          .select("apolice_id, valor, data_vencimento, status")
          .in("apolice_id", ids);
        for (const m of ms || []) {
          (parcelasByAp[m.apolice_id] ||= []).push(m);
        }
      }

      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);

      const rows: Linha[] = (aps || []).map((a: any) => {
        const inq = a.consulta?.inquilino;
        const im = a.consulta?.imovel;
        const parcelas = parcelasByAp[a.id] || [];

        const pendentes = parcelas
          .filter((p) => p.status !== "pago" && p.status !== "cancelado")
          .sort(
            (x, y) =>
              new Date(x.data_vencimento).getTime() -
              new Date(y.data_vencimento).getTime(),
          );

        const vencida = pendentes.find((p) => new Date(p.data_vencimento) < hoje);
        const proxima = pendentes.find((p) => new Date(p.data_vencimento) >= hoje);
        const referencia = vencida || proxima || parcelas[0];

        let status: StatusFatura;
        if (vencida) status = "vencido";
        else if (proxima) status = "a_vencer";
        else status = "em_dia";

        return {
          apolice_id: a.id,
          numero: a.numero,
          inquilino_nome:
            inq?.nome || inq?.razao_social || "Inquilino não informado",
          inquilino_doc: inq?.cpf || inq?.cnpj || "",
          cidade: extrairCidade(im),
          valor_parcela: Number(referencia?.valor || 0),
          proximo_venc: (proxima || vencida)?.data_vencimento || null,
          status,
        };
      });

      setLinhas(rows);
    } catch (e: any) {
      setErro(e.message || "Erro ao carregar faturas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-black text-neutral-900 tracking-tight">
            Faturas Inquilinos
          </h1>
          <p className="text-sm text-neutral-500 font-medium mt-1">
            Acompanhe boletos e parcelas dos inquilinos vinculados.
          </p>
        </div>

        {loading ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-16 bg-neutral-100 rounded-2xl" />
            <div className="h-16 bg-neutral-100 rounded-2xl" />
            <div className="h-16 bg-neutral-100 rounded-2xl" />
          </div>
        ) : erro ? (
          <Card className="p-10 text-center border-red-200 bg-red-50">
            <AlertCircle className="w-10 h-10 text-red-600 mx-auto mb-3" />
            <p className="font-black text-red-900 mb-2">
              Não foi possível carregar as faturas. Tente novamente.
            </p>
            <p className="text-sm text-red-700 mb-4">{erro}</p>
            <Button onClick={load} className="rounded-lg gap-2 font-bold">
              <RefreshCw size={14} /> Tentar novamente
            </Button>
          </Card>
        ) : linhas.length === 0 ? (
          <Card className="p-12 text-center bg-white border-neutral-200">
            <Receipt className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
            <p className="font-black text-neutral-900">Nenhuma fatura encontrada</p>
            <p className="text-sm text-neutral-500 mt-1">
              As faturas dos inquilinos vinculados aparecerão aqui quando houver
              contratos ativos.
            </p>
          </Card>
        ) : (
          <>
            {/* Desktop / tablet */}
            <Card className="border-neutral-200 shadow-sm overflow-hidden bg-white hidden md:block">
              <div className="overflow-x-auto">
                <table className="w-full text-left min-w-[720px]">
                  <thead className="bg-neutral-50 text-neutral-500 text-[10px] font-black uppercase tracking-widest">
                    <tr>
                      <th className="px-5 py-3">Inquilino</th>
                      <th className="px-5 py-3">Cidade</th>
                      <th className="px-5 py-3 text-right">Valor da parcela</th>
                      <th className="px-5 py-3 text-center">Status</th>
                      <th className="px-5 py-3">Próximo vencimento</th>
                      <th className="px-5 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y border-t">
                    {linhas.map((l) => (
                      <tr key={l.apolice_id} className="hover:bg-neutral-50/50">
                        <td className="px-5 py-3 max-w-[280px]">
                          <p className="font-black text-neutral-900 text-sm line-clamp-2">
                            {l.inquilino_nome}
                          </p>
                          {l.inquilino_doc && (
                            <p className="text-xs text-neutral-500 truncate">
                              {l.inquilino_doc}
                            </p>
                          )}
                          {l.numero && (
                            <p className="text-[10px] text-neutral-400 uppercase tracking-widest font-bold mt-0.5 truncate">
                              #{l.numero}
                            </p>
                          )}
                        </td>
                        <td className="px-5 py-3 text-sm text-neutral-700">
                          {l.cidade}
                        </td>
                        <td className="px-5 py-3 text-right font-bold text-neutral-900 text-sm">
                          {formatBRL(l.valor_parcela)}
                        </td>
                        <td className="px-5 py-3 text-center">
                          <StatusBadge status={l.status} />
                        </td>
                        <td className="px-5 py-3 text-sm text-neutral-700">
                          {formatDate(l.proximo_venc)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <Button
                            asChild
                            size="sm"
                            variant="outline"
                            className="rounded-lg h-8 gap-1.5 font-bold"
                          >
                            <Link
                              to="/faturas-inquilinos/$id"
                              params={{ id: l.apolice_id }}
                            >
                              <Eye size={12} /> Ver faturas
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Mobile */}
            <div className="grid gap-3 md:hidden">
              {linhas.map((l) => (
                <Card
                  key={l.apolice_id}
                  className="p-4 bg-white border-neutral-200 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <p className="font-black text-neutral-900 text-sm line-clamp-2">
                        {l.inquilino_nome}
                      </p>
                      <p className="text-xs text-neutral-500 truncate">
                        {l.cidade}
                      </p>
                    </div>
                    <StatusBadge status={l.status} />
                  </div>
                  <div className="flex items-center justify-between text-xs mb-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-neutral-400 font-bold">
                        Parcela
                      </p>
                      <p className="font-black text-neutral-900 text-sm">
                        {formatBRL(l.valor_parcela)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase tracking-widest text-neutral-400 font-bold">
                        Próx. vencimento
                      </p>
                      <p className="font-bold text-neutral-700 text-sm">
                        {formatDate(l.proximo_venc)}
                      </p>
                    </div>
                  </div>
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="w-full rounded-lg gap-1.5 font-bold"
                  >
                    <Link
                      to="/faturas-inquilinos/$id"
                      params={{ id: l.apolice_id }}
                    >
                      <Eye size={12} /> Ver faturas
                    </Link>
                  </Button>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function StatusBadge({ status }: { status: StatusFatura }) {
  const map = {
    em_dia: {
      label: "Em dia",
      cls: "bg-green-50 text-green-700 border-green-200",
    },
    a_vencer: {
      label: "A vencer",
      cls: "bg-orange-50 text-orange-700 border-orange-200",
    },
    vencido: {
      label: "Vencido",
      cls: "bg-red-50 text-red-700 border-red-200",
    },
  } as const;
  const cfg = map[status];
  return (
    <Badge
      className={`${cfg.cls} border text-[9px] uppercase font-black px-2.5 py-0.5 rounded-full min-w-[72px] justify-center`}
    >
      {cfg.label}
    </Badge>
  );
}
