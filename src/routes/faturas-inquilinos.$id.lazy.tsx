import { createLazyFileRoute, Link } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { supabase } from "@/integrations/supabase/client";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft, Receipt, AlertCircle, Eye, Download, Copy,
  FileCheck, MapPin, RefreshCw,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createLazyFileRoute("/faturas-inquilinos/$id")({
  component: () => (
    <ProtectedRoute>
      <ErrorBoundary nome="faturas-inquilino-detalhe">
        <FaturasInquilinoDetalhe />
      </ErrorBoundary>
    </ProtectedRoute>
  ),
});

const formatBRL = (v: number) =>
  (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const formatDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("pt-BR") : "—";

function FaturasInquilinoDetalhe() {
  const { id } = Route.useParams();
  const [apolice, setApolice] = useState<any>(null);
  const [parcelas, setParcelas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const { data: ap, error: apErr } = await supabase
        .from("apolices")
        .select(`
          id, numero, status, vigencia_inicio, vigencia_fim,
          consulta:consultas_credito(
            inquilino:inquilinos(nome, cpf, cnpj, razao_social),
            imovel:imoveis(endereco, logradouro, numero, bairro, cidade, estado, valor_aluguel)
          ),
          imobiliaria:profiles!apolices_imobiliaria_profile_id_fkey(nome),
          corretor:profiles!apolices_corretor_profile_id_fkey(nome),
          proprietario:profiles!apolices_proprietario_profile_id_fkey(nome)
        `)
        .eq("id", id)
        .maybeSingle();
      if (apErr) throw apErr;
      if (!ap) throw new Error("Contrato não encontrado ou sem acesso.");

      const { data: ms } = await supabase
        .from("mensalidades")
        .select("*")
        .eq("apolice_id", id)
        .order("data_vencimento", { ascending: true });

      setApolice(ap);
      setParcelas(ms || []);
    } catch (e: any) {
      setErro(e.message || "Erro ao carregar faturas");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="space-y-6 animate-pulse">
          <div className="h-10 bg-neutral-100 rounded-xl w-64" />
          <div className="h-48 bg-neutral-100 rounded-3xl" />
          <div className="h-64 bg-neutral-100 rounded-2xl" />
        </div>
      </DashboardLayout>
    );
  }

  if (erro || !apolice) {
    return (
      <DashboardLayout>
        <Card className="p-10 text-center border-red-200 bg-red-50 max-w-xl mx-auto my-12">
          <AlertCircle className="w-10 h-10 text-red-600 mx-auto mb-3" />
          <p className="font-black text-red-900 mb-2">
            Não foi possível carregar as faturas. Tente novamente.
          </p>
          <p className="text-sm text-red-700 mb-4">{erro}</p>
          <div className="flex gap-2 justify-center">
            <Button onClick={load} className="rounded-lg gap-2 font-bold">
              <RefreshCw size={14} /> Tentar novamente
            </Button>
            <Button asChild variant="outline" className="rounded-lg font-bold">
              <Link to="/faturas-inquilinos">Voltar</Link>
            </Button>
          </div>
        </Card>
      </DashboardLayout>
    );
  }

  const consulta = apolice.consulta;
  const inquilino = consulta?.inquilino;
  const imovel = consulta?.imovel;
  const endereco = imovel
    ? [imovel.logradouro || imovel.endereco, imovel.numero, imovel.bairro, imovel.cidade, imovel.estado]
        .filter(Boolean).join(", ")
    : "Endereço não cadastrado";

  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const enriquecidas = parcelas.map((f) => {
    const venc = new Date(f.data_vencimento);
    const vencido = f.status === "pendente" && venc < hoje;
    return { ...f, statusReal: vencido ? "vencido" : f.status };
  });

  const total = enriquecidas.reduce((s, f) => s + Number(f.valor || 0), 0);
  const pago = enriquecidas.filter((f) => f.statusReal === "pago").reduce((s, f) => s + Number(f.valor || 0), 0);
  const pendente = enriquecidas.filter((f) => f.statusReal === "pendente").reduce((s, f) => s + Number(f.valor || 0), 0);
  const vencidoTotal = enriquecidas.filter((f) => f.statusReal === "vencido").reduce((s, f) => s + Number(f.valor || 0), 0);
  const aberto = enriquecidas.filter((f) => f.statusReal === "pendente").length;
  const vencidoCount = enriquecidas.filter((f) => f.statusReal === "vencido").length;
  const proxima = enriquecidas.find((f) => f.statusReal === "pendente");

  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success("Linha digitável copiada!");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <Link
          to="/faturas-inquilinos"
          className="inline-flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-900 font-bold"
        >
          <ArrowLeft size={16} /> Voltar para faturas
        </Link>

        {/* Resumo do inquilino */}
        <div className="relative bg-gradient-to-br from-neutral-900 via-neutral-900 to-neutral-800 rounded-3xl p-8 overflow-hidden shadow-xl">
          <div className="absolute top-0 right-0 w-64 h-64 bg-yellow-400 opacity-[0.03] rounded-full blur-[100px] -mr-32 -mt-32" />
          <div className="relative flex flex-col lg:flex-row justify-between gap-6">
            <div className="space-y-3">
              <span className="text-[10px] uppercase tracking-[0.3em] text-yellow-400 font-black">
                Faturas do inquilino
              </span>
              <h1 className="text-3xl font-black text-white tracking-tight">
                {inquilino?.nome || inquilino?.razao_social || "Inquilino"}
              </h1>
              <p className="text-sm text-neutral-400 font-medium">
                {inquilino?.cpf || inquilino?.cnpj || "Documento não informado"}
              </p>
              <p className="text-sm text-neutral-300 font-medium flex items-center gap-2">
                <MapPin size={14} className="text-yellow-400" /> {endereco}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <DarkItem label="Contrato" valor={`#${apolice.numero}`} />
              <DarkItem label="Status" valor={apolice.status} />
              <DarkItem label="Imobiliária" valor={apolice.imobiliaria?.nome || "—"} />
              <DarkItem label="Corretor" valor={apolice.corretor?.nome || "—"} />
              <DarkItem label="Proprietário" valor={apolice.proprietario?.nome || "—"} />
              <DarkItem label="Aluguel" valor={formatBRL(Number(imovel?.valor_aluguel || 0))} />
            </div>
          </div>
        </div>

        {/* Cards financeiros */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Kpi label="Total contratado" valor={formatBRL(total)} cor="neutral" />
          <Kpi label="Total pago" valor={formatBRL(pago)} cor="green" />
          <Kpi label="Total pendente" valor={formatBRL(pendente)} cor="amber" />
          <Kpi label="Total vencido" valor={formatBRL(vencidoTotal)} cor="red" />
          <Kpi label="Parcelas em aberto" valor={String(aberto)} cor="amber" />
          <Kpi label="Próximo vencimento" valor={proxima ? formatDate(proxima.data_vencimento) : "—"} cor="neutral" />
        </div>

        {vencidoCount > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3 text-sm">
            <AlertCircle className="text-red-600" />
            <p className="font-bold text-red-900">
              Existe parcela vencida para este inquilino. ({vencidoCount} parcela(s))
            </p>
          </div>
        )}

        {/* Tabela de parcelas */}
        <Card className="border-neutral-200 shadow-sm overflow-hidden bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[760px]">
              <thead className="bg-neutral-50 text-neutral-500 text-[10px] font-black uppercase tracking-widest">
                <tr>
                  <th className="px-6 py-4">Parcela</th>
                  <th className="px-6 py-4">Vencimento</th>
                  <th className="px-6 py-4 text-right">Valor</th>
                  <th className="px-6 py-4 text-center">Status</th>
                  <th className="px-6 py-4">Pagamento</th>
                  <th className="px-6 py-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y border-t">
                {enriquecidas.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-16">
                      <div className="flex flex-col items-center gap-2">
                        <Receipt className="text-neutral-300" size={36} />
                        <p className="text-neutral-900 font-bold">
                          Nenhuma fatura encontrada
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  enriquecidas.map((f, i) => (
                    <tr key={f.id} className="hover:bg-neutral-50/50">
                      <td className="px-6 py-4 font-black text-neutral-900">
                        #{String(f.numero_parcela ?? i + 1).padStart(2, "0")}
                      </td>
                      <td className="px-6 py-4 text-sm text-neutral-600">
                        {formatDate(f.data_vencimento)}
                      </td>
                      <td className="px-6 py-4 text-right font-bold text-neutral-900">
                        {formatBRL(Number(f.valor))}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <FaturaStatusBadge status={f.statusReal} />
                      </td>
                      <td className="px-6 py-4 text-xs text-neutral-500">
                        {f.data_pagamento ? formatDate(f.data_pagamento) : "—"}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="inline-flex gap-1.5">
                          {f.boleto_url ? (
                            <>
                              <Button size="sm" variant="outline" className="rounded-lg h-8 gap-1"
                                onClick={() => window.open(f.boleto_url, "_blank")}>
                                <Eye size={12} /> Ver
                              </Button>
                              <Button size="sm" variant="ghost" className="rounded-lg h-8 w-8 p-0" title="Baixar PDF"
                                onClick={() => {
                                  const a = document.createElement("a");
                                  a.href = f.boleto_url; a.target = "_blank"; a.rel = "noopener";
                                  a.download = `boleto-${apolice.numero}-${i + 1}.pdf`;
                                  document.body.appendChild(a); a.click(); a.remove();
                                }}>
                                <Download size={12} />
                              </Button>
                            </>
                          ) : (
                            <span className="text-[10px] text-neutral-400 italic">
                              Boleto não disponível
                            </span>
                          )}
                          {f.linha_digitavel && (
                            <Button size="sm" variant="ghost" className="rounded-lg h-8 w-8 p-0"
                              title="Copiar linha digitável"
                              onClick={() => copiar(f.linha_digitavel)}>
                              <Copy size={12} />
                            </Button>
                          )}
                          {f.comprovante_url ? (
                            <Button size="sm" variant="ghost" className="rounded-lg h-8 gap-1 text-green-700"
                              title="Ver comprovante"
                              onClick={() => window.open(f.comprovante_url, "_blank")}>
                              <FileCheck size={12} />
                            </Button>
                          ) : f.status === "pago" ? (
                            <span className="text-[10px] text-neutral-400 italic">
                              Comprovante não enviado
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function DarkItem({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[9px] uppercase tracking-widest text-neutral-500 font-black">
        {label}
      </p>
      <p className="text-sm font-bold text-white truncate">{valor}</p>
    </div>
  );
}

function Kpi({
  label, valor, cor,
}: { label: string; valor: string; cor: "green" | "red" | "amber" | "neutral" }) {
  const map = {
    green: "text-green-700 bg-green-50 border-green-100",
    red: "text-red-700 bg-red-50 border-red-100",
    amber: "text-amber-700 bg-amber-50 border-amber-100",
    neutral: "text-neutral-900 bg-white border-neutral-200",
  } as const;
  return (
    <div className={`rounded-xl border p-4 ${map[cor]}`}>
      <p className="text-[9px] uppercase tracking-widest font-black opacity-70">
        {label}
      </p>
      <p className="text-base font-black mt-1 truncate">{valor}</p>
    </div>
  );
}

function FaturaStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pago: { label: "Pago", cls: "bg-green-50 text-green-700 border-green-200" },
    pendente: { label: "Pendente", cls: "bg-amber-50 text-amber-700 border-amber-200" },
    vencido: { label: "Vencido", cls: "bg-red-50 text-red-700 border-red-200" },
    atrasado: { label: "Vencido", cls: "bg-red-50 text-red-700 border-red-200" },
    cancelado: { label: "Cancelado", cls: "bg-neutral-100 text-neutral-500 border-neutral-200" },
    processamento: { label: "Em processamento", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  };
  const cfg = map[status] || map.pendente;
  return (
    <Badge className={`${cfg.cls} border text-[9px] uppercase font-black px-2 py-0.5`}>
      {cfg.label}
    </Badge>
  );
}
