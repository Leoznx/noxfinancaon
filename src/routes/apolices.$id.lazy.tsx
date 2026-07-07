import { createLazyFileRoute, Link } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import {
  ArrowLeft, FileText, Download, Eye, AlertCircle, MapPin,
  Calendar, User, Building2, Wallet, Copy, FileCheck, Receipt,
  ClipboardCheck, ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createLazyFileRoute("/apolices/$id")({
  component: () => (
    <ProtectedRoute>
      <ErrorBoundary nome="detalhe-apolice">
        <ApoliceDetalhe />
      </ErrorBoundary>
    </ProtectedRoute>
  ),
});

const TIPOS_DOC = [
  { tipo: "contrato", label: "Contrato de Locação", icone: FileCheck, descricao: "Contrato vinculado à garantia da NOX." },
  { tipo: "vistoria", label: "Vistoria do Imóvel", icone: ClipboardCheck, descricao: "Laudo de vistoria de entrada do inquilino." },
  { tipo: "apolice",  label: "Apólice / Garantia",  icone: ShieldCheck,    descricao: "Documento oficial da apólice emitida." },
] as const;

function ApoliceDetalhe() {
  const { id } = Route.useParams();
  const [apolice, setApolice] = useState<any>(null);
  const [documentos, setDocumentos] = useState<any[]>([]);
  const [faturas, setFaturas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setErro(null);
      try {
        const { data: ap, error: apErr } = await supabase
          .from("apolices")
          .select(`
            id, numero, status, vigencia_inicio, vigencia_fim, valor_premio, created_at,
            consulta:consultas_credito(
              inquilino:inquilinos(nome, cpf, cnpj, razao_social, tipo, profile:profiles(nome, email, telefone)),
              imovel:imoveis(endereco, logradouro, numero, bairro, cidade, estado, cep, valor_aluguel),
              plano:planos(nome)
            ),
            imobiliaria:profiles!apolices_imobiliaria_profile_id_fkey(nome, email),
            corretor:profiles!apolices_corretor_profile_id_fkey(nome, email),
            proprietario:profiles!apolices_proprietario_profile_id_fkey(nome, email)
          `)
          .eq("id", id)
          .maybeSingle();
        if (apErr) throw apErr;
        if (!ap) throw new Error("Apólice não encontrada ou sem acesso.");

        const { data: docs } = await supabase
          .from("documentos_contrato")
          .select("*")
          .eq("apolice_id", id);

        const { data: fts } = await supabase
          .from("mensalidades")
          .select("*")
          .eq("apolice_id", id)
          .order("data_vencimento", { ascending: true });

        if (!cancelled) {
          setApolice(ap);
          setDocumentos(docs || []);
          setFaturas(fts || []);
        }
      } catch (e: any) {
        if (!cancelled) setErro(e.message || "Erro ao carregar contrato");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id]);

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
        <div className="bg-red-50 border border-red-200 rounded-xl p-8 max-w-xl mx-auto my-12 text-center">
          <AlertCircle className="w-10 h-10 text-red-600 mx-auto mb-3" />
          <h2 className="text-xl font-bold text-red-900 mb-2">Não foi possível carregar o contrato</h2>
          <p className="text-red-700 mb-6">{erro}</p>
          <Button asChild>
            <Link to="/apolices">Voltar para contratos</Link>
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const consulta = apolice.consulta;
  const inquilino = consulta?.inquilino;
  const imovel = consulta?.imovel;
  const plano = consulta?.plano;

  const formatBRL = (v: number) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const formatDate = (d: string) => (d ? new Date(d).toLocaleDateString("pt-BR") : "—");

  const endereco = imovel
    ? [imovel.logradouro || imovel.endereco, imovel.numero, imovel.bairro, imovel.cidade, imovel.estado]
        .filter(Boolean).join(", ")
    : "Endereço não cadastrado";

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        {/* Voltar */}
        <Link to="/apolices" className="inline-flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-900 font-bold">
          <ArrowLeft size={16} /> Voltar para contratos
        </Link>

        {/* RESUMO */}
        <div className="relative bg-gradient-to-br from-neutral-900 via-neutral-900 to-neutral-800 rounded-3xl p-8 overflow-hidden shadow-xl">
          <div className="absolute top-0 right-0 w-64 h-64 bg-yellow-400 opacity-[0.03] rounded-full blur-[100px] -mr-32 -mt-32" />
          <div className="relative flex flex-col lg:flex-row justify-between gap-6">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-[10px] uppercase tracking-[0.3em] text-yellow-400 font-black">Apólice</span>
                <StatusBadge status={apolice.status} />
              </div>
              <h1 className="text-4xl font-black text-white tracking-tight">#{apolice.numero}</h1>
              <p className="text-sm text-neutral-400 font-medium flex items-center gap-2">
                <MapPin size={14} className="text-yellow-400" /> {endereco}
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <ResumoItem icone={User} label="Inquilino" valor={inquilino?.nome || "Não informado"} />
              <ResumoItem icone={FileText} label="Documento" valor={inquilino?.cpf || inquilino?.cnpj || "Não informado"} />
              <ResumoItem icone={User} label="Telefone" valor={inquilino?.profile?.telefone || "Telefone não informado"} />
              <ResumoItem icone={Building2} label="Imobiliária" valor={apolice.imobiliaria?.nome || "Imobiliária não informada"} />
              <ResumoItem icone={User} label="Corretor" valor={apolice.corretor?.nome || "Corretor não informado"} />
              <ResumoItem icone={Wallet} label="Aluguel" valor={formatBRL(Number(imovel?.valor_aluguel || 0))} />
              <ResumoItem icone={FileText} label="Plano" valor={plano?.nome || "Plano padrão"} />
              <ResumoItem icone={Calendar} label="Vigência" valor={`${formatDate(apolice.vigencia_inicio)} → ${formatDate(apolice.vigencia_fim)}`} />
            </div>
          </div>
        </div>

        {/* DOCUMENTOS DO CONTRATO */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black text-neutral-900">Documentos do contrato</h2>
          <Button asChild variant="outline" className="rounded-lg gap-2 font-bold">
            <Link to="/faturas-inquilinos/$id" params={{ id: apolice.id }}>
              <Receipt size={14} /> Ver faturas do inquilino
            </Link>
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {TIPOS_DOC.map((t) => {
            const doc = documentos.find((d) => d.tipo === t.tipo);
            const disponivel = doc?.status === "disponivel" && doc?.file_url;
            return (
              <Card key={t.tipo} className="p-6 border-neutral-200 rounded-2xl bg-white flex flex-col gap-4">
                <div className="flex items-start justify-between">
                  <div className="w-12 h-12 rounded-xl bg-yellow-50 border border-yellow-200 flex items-center justify-center">
                    <t.icone className="w-5 h-5 text-yellow-700" />
                  </div>
                  <DocStatusBadge status={doc?.status || "nao_enviado"} />
                </div>
                <div className="space-y-1">
                  <h3 className="font-black text-neutral-900">{t.label}</h3>
                  <p className="text-xs text-neutral-500 font-medium">{t.descricao}</p>
                  {doc?.uploaded_at && (
                    <p className="text-[10px] text-neutral-400 uppercase tracking-widest font-bold mt-2">
                      Enviado em {new Date(doc.uploaded_at).toLocaleDateString("pt-BR")}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 pt-2 mt-auto">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 rounded-lg gap-1.5 font-bold"
                    disabled={!disponivel}
                    onClick={() => doc?.file_url && window.open(doc.file_url, "_blank")}
                  >
                    <Eye size={14} /> Visualizar
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg gap-1.5 font-bold"
                    disabled={!disponivel}
                    onClick={() => {
                      if (!doc?.file_url) return;
                      const a = document.createElement("a");
                      a.href = doc.file_url;
                      a.download = doc.file_name || `${t.tipo}.pdf`;
                      a.target = "_blank";
                      a.rel = "noopener";
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                    }}
                  >
                    <Download size={14} /> Baixar
                  </Button>
                </div>
                {!doc && (
                  <p className="text-xs text-neutral-400 italic">Ainda não enviado pelo administrador.</p>
                )}
              </Card>
            );
          })}
        </div>

      </div>
    </DashboardLayout>
  );
}

function ResumoItem({ icone: Icone, label, valor }: any) {
  return (
    <div className="space-y-1">
      <p className="text-[9px] uppercase tracking-widest text-neutral-500 font-black flex items-center gap-1.5">
        <Icone size={12} className="text-yellow-400" /> {label}
      </p>
      <p className="text-sm font-bold text-white truncate">{valor}</p>
    </div>
  );
}

function FaturasView({ faturas, apolice }: { faturas: any[]; apolice: any }) {
  const formatBRL = (v: number) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const formatDate = (d: string) => (d ? new Date(d).toLocaleDateString("pt-BR") : "—");

  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const enriquecidas = faturas.map((f) => {
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
    <div className="space-y-6">
      {/* Resumo financeiro */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiSmall label="Total contratado" valor={formatBRL(total)} cor="neutral" />
        <KpiSmall label="Total pago" valor={formatBRL(pago)} cor="green" />
        <KpiSmall label="Total pendente" valor={formatBRL(pendente)} cor="amber" />
        <KpiSmall label="Total vencido" valor={formatBRL(vencidoTotal)} cor="red" />
        <KpiSmall label="Parcelas em aberto" valor={String(aberto)} cor="amber" />
        <KpiSmall label="Próximo vencimento" valor={proxima ? formatDate(proxima.data_vencimento) : "—"} cor="neutral" />
      </div>

      {vencidoCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3 text-sm">
          <AlertCircle className="text-red-600" />
          <p className="font-bold text-red-900">{vencidoCount} parcela(s) vencida(s).</p>
        </div>
      )}

      {/* Tabela */}
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
                      <p className="text-neutral-900 font-bold">Nenhuma fatura encontrada para este contrato.</p>
                    </div>
                  </td>
                </tr>
              ) : enriquecidas.map((f, i) => (
                <tr key={f.id} className="hover:bg-neutral-50/50 transition-colors">
                  <td className="px-6 py-4 font-black text-neutral-900">
                    #{String(f.numero_parcela ?? i + 1).padStart(2, "0")}
                  </td>
                  <td className="px-6 py-4 text-sm text-neutral-600">{formatDate(f.data_vencimento)}</td>
                  <td className="px-6 py-4 text-right font-bold text-neutral-900">{formatBRL(Number(f.valor))}</td>
                  <td className="px-6 py-4 text-center"><FaturaStatusBadge status={f.statusReal} /></td>
                  <td className="px-6 py-4 text-xs text-neutral-500">
                    {f.data_pagamento ? formatDate(f.data_pagamento) : "—"}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="inline-flex gap-1.5">
                      {f.boleto_url && (
                        <Button size="sm" variant="outline" className="rounded-lg h-8 gap-1" onClick={() => window.open(f.boleto_url, "_blank")}>
                          <Eye size={12} /> Ver
                        </Button>
                      )}
                      {f.boleto_url && (
                        <Button size="sm" variant="ghost" className="rounded-lg h-8 w-8 p-0" title="Baixar PDF"
                          onClick={() => {
                            const a = document.createElement("a");
                            a.href = f.boleto_url; a.target = "_blank"; a.rel = "noopener";
                            a.download = `boleto-${apolice.numero}-${i + 1}.pdf`;
                            document.body.appendChild(a); a.click(); a.remove();
                          }}
                        >
                          <Download size={12} />
                        </Button>
                      )}
                      {f.linha_digitavel && (
                        <Button size="sm" variant="ghost" className="rounded-lg h-8 w-8 p-0" title="Copiar linha digitável"
                          onClick={() => copiar(f.linha_digitavel)}
                        >
                          <Copy size={12} />
                        </Button>
                      )}
                      {f.comprovante_url && (
                        <Button size="sm" variant="ghost" className="rounded-lg h-8 gap-1 text-green-700" title="Ver comprovante"
                          onClick={() => window.open(f.comprovante_url, "_blank")}
                        >
                          <FileCheck size={12} />
                        </Button>
                      )}
                      {!f.boleto_url && !f.linha_digitavel && (
                        <span className="text-[10px] text-neutral-400 italic">Sem boleto disponível</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function KpiSmall({ label, valor, cor }: { label: string; valor: string; cor: "green"|"red"|"amber"|"neutral" }) {
  const map = {
    green: "text-green-700 bg-green-50 border-green-100",
    red: "text-red-700 bg-red-50 border-red-100",
    amber: "text-amber-700 bg-amber-50 border-amber-100",
    neutral: "text-neutral-900 bg-white border-neutral-200",
  } as const;
  return (
    <div className={`rounded-xl border p-4 ${map[cor]}`}>
      <p className="text-[9px] uppercase tracking-widest font-black opacity-70">{label}</p>
      <p className="text-base font-black mt-1 truncate">{valor}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ativa: "bg-green-400/10 text-green-300 border-green-400/30",
    pendente: "bg-amber-400/10 text-amber-300 border-amber-400/30",
    cancelada: "bg-red-400/10 text-red-300 border-red-400/30",
    encerrada: "bg-neutral-400/10 text-neutral-300 border-neutral-400/30",
  };
  return (
    <Badge className={`${map[status] || map.pendente} border text-[10px] uppercase font-black px-2.5 py-0.5`}>
      {status}
    </Badge>
  );
}

function DocStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    disponivel:  { label: "Disponível",   cls: "bg-green-50 text-green-700 border-green-200" },
    pendente:    { label: "Pendente",     cls: "bg-amber-50 text-amber-700 border-amber-200" },
    nao_enviado: { label: "Não enviado",  cls: "bg-neutral-100 text-neutral-500 border-neutral-200" },
  };
  const cfg = map[status] || map.nao_enviado;
  return <Badge className={`${cfg.cls} border text-[9px] uppercase font-black px-2 py-0.5`}>{cfg.label}</Badge>;
}

function FaturaStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pago:           { label: "Pago",            cls: "bg-green-50 text-green-700 border-green-200" },
    pendente:       { label: "Pendente",        cls: "bg-amber-50 text-amber-700 border-amber-200" },
    vencido:        { label: "Vencido",         cls: "bg-red-50 text-red-700 border-red-200" },
    atrasado:       { label: "Vencido",         cls: "bg-red-50 text-red-700 border-red-200" },
    cancelado:      { label: "Cancelado",       cls: "bg-neutral-100 text-neutral-500 border-neutral-200" },
    processamento:  { label: "Em processamento",cls: "bg-blue-50 text-blue-700 border-blue-200" },
  };
  const cfg = map[status] || map.pendente;
  return <Badge className={`${cfg.cls} border text-[9px] uppercase font-black px-2 py-0.5`}>{cfg.label}</Badge>;
}
