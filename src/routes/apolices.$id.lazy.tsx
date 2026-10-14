import { createLazyFileRoute, Link } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { supabase } from "@/integrations/supabase/client";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import {
  ArrowLeft, FileText, Download, Eye, AlertCircle, MapPin,
  Calendar, User, Building2, Wallet, Copy, FileCheck, Receipt,
  ClipboardCheck, ShieldCheck, Upload, Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { useAuth } from "@/components/AuthProvider";

export const Route = createLazyFileRoute("/apolices/$id")({
  component: () => (
    <ProtectedRoute>
      <ErrorBoundary nome="detalhe-apolice">
        <ApoliceDetalhe />
      </ErrorBoundary>
    </ProtectedRoute>
  ),
});

const DOCUMENT_BUCKETS = ["contratos-assinados", "approval-documents", "anexos", "documentos-proposta"] as const;
const ACCEPTED_CONTRACT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

type ContractDocument = {
  id: string;
  file_name?: string | null;
  file_url?: string | null;
  storage_path?: string | null;
  status?: string | null;
  uploaded_at?: string | null;
  updated_at?: string | null;
  tipo?: string | null;
  document_type?: string | null;
  document_subtype?: string | null;
  contract_signature_id?: string | null;
};

function ApoliceDetalhe() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const [apolice, setApolice] = useState<any>(null);
  const [documentos, setDocumentos] = useState<any[]>([]);
  const [documentosProposta, setDocumentosProposta] = useState<ContractDocument[]>([]);
  const [assinatura, setAssinatura] = useState<any>(null);
  const [faturas, setFaturas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [replacingDocument, setReplacingDocument] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setErro(null);
      try {
        const { data: ap, error: apErr } = await supabase
          .from("apolices")
          .select(`
            id, consulta_id, numero, status, vigencia_inicio, vigencia_fim, valor_premio, created_at,
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

        const [docsResult, proposalDocsResult, signatureResult, invoicesResult] = await Promise.all([
          supabase.from("documentos_contrato").select("*").eq("apolice_id", id),
          (supabase.from("documentos_proposta") as any)
            .select("id, file_name, file_url, file_type, document_type, document_subtype, contract_signature_id, updated_at")
            .or(`consulta_id.eq.${ap.consulta_id},apolice_id.eq.${id}`)
            .order("updated_at", { ascending: false }),
          (supabase as any).from("contract_signatures")
            .select("id, status, signature_status, sent_at, signed_at")
            .eq("consultation_id", ap.consulta_id)
            .maybeSingle(),
          (supabase as any)
            .from("faturas_inquilino")
            .select(`
              id, numero_parcela, installment_total, vencimento, valor, status,
              pago_em, confirmed_at, payment_url, boleto_url, linha_digitavel,
              asaas_payment:asaas_payments(invoice_url, boleto_url, boleto_barcode, pix_copy_paste)
            `)
            .eq("apolice_id", id)
            .order("vencimento", { ascending: true }),
        ]);

        if (docsResult.error) throw docsResult.error;
        if (proposalDocsResult.error) throw proposalDocsResult.error;
        if (signatureResult.error) throw signatureResult.error;
        if (invoicesResult.error) throw invoicesResult.error;

        let proposalDocs = (proposalDocsResult.data || []) as ContractDocument[];
        const signature = signatureResult.data;
        const missingPreparedDocument =
          signature?.id &&
          !["signed", "active"].includes(String(signature.status || "")) &&
          !proposalDocs.some((document) => document.contract_signature_id === signature.id);

        if (missingPreparedDocument) {
          const { data: materialized } = await supabase.functions.invoke("contract-document", {
            body: { policyId: id },
          });
          if (materialized?.ok) {
            const refreshed = await (supabase.from("documentos_proposta") as any)
              .select("id, file_name, file_url, file_type, document_type, document_subtype, contract_signature_id, updated_at")
              .or(`consulta_id.eq.${ap.consulta_id},apolice_id.eq.${id}`)
              .order("updated_at", { ascending: false });
            proposalDocs = (refreshed.data || []) as ContractDocument[];
          }
        }

        if (!cancelled) {
          setApolice(ap);
          setDocumentos(docsResult.data || []);
          setDocumentosProposta(proposalDocs);
          setAssinatura(signature || null);
          setFaturas(
            (invoicesResult.data || []).map((invoice: any) => ({
              ...invoice,
              data_vencimento: invoice.vencimento,
              data_pagamento: invoice.pago_em || invoice.confirmed_at,
              boleto_url:
                invoice.payment_url ||
                invoice.boleto_url ||
                invoice.asaas_payment?.invoice_url ||
                invoice.asaas_payment?.boleto_url ||
                null,
              linha_digitavel:
                invoice.linha_digitavel ||
                invoice.asaas_payment?.boleto_barcode ||
                invoice.asaas_payment?.pix_copy_paste ||
                null,
            })),
          );
        }
      } catch (e: any) {
        if (!cancelled) setErro(e.message || "Erro ao carregar contrato");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id, refreshKey]);

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

  const isStaff = ["admin", "admin_master", "analista", "juridico", "financeiro"].includes(
    user?.internalRole || user?.role || "",
  );
  const contratoLocacao = documentosProposta.find((document) => document.document_type === "contrato_locacao");
  const documentoD4Sign = documentosProposta.find((document) => Boolean(document.contract_signature_id));
  const assinaturaConcluida =
    ["signed", "active"].includes(String(assinatura?.status || "")) ||
    assinatura?.signature_status === "signed" ||
    Boolean(assinatura?.signed_at) ||
    documentoD4Sign?.document_subtype === "contratos-assinados";
  const podeEditarContrato =
    Boolean(contratoLocacao?.id) &&
    contratoLocacao?.document_subtype === "pendente_assinatura" &&
    !assinaturaConcluida;

  const documentCards = [
    {
      key: "contrato_locacao",
      label: "Contrato de locação",
      icon: FileCheck,
      description: podeEditarContrato
        ? "Arquivo informado como não assinado. Você pode substituí-lo até a assinatura ser concluída."
        : "Contrato de locação anexado durante a contratação.",
      document: contratoLocacao || documentos.find((document) => document.tipo === "contrato"),
      editable: podeEditarContrato,
      pending: Boolean(contratoLocacao) && contratoLocacao?.document_subtype === "pendente_assinatura",
    },
    {
      key: "contrato_nox",
      label: assinaturaConcluida ? "Contrato NOX assinado" : "Apólice para assinatura",
      icon: ShieldCheck,
      description: assinaturaConcluida
        ? "Documento final assinado pelo inquilino."
        : "Documento gerado na contratação e enviado ao inquilino para assinatura.",
      document: documentoD4Sign || documentos.find((document) => document.tipo === "apolice"),
      editable: false,
      pending: Boolean(assinatura) && !assinaturaConcluida,
    },
    {
      key: "vistoria",
      label: "Vistoria do imóvel",
      icon: ClipboardCheck,
      description: "Laudo de vistoria anexado à proposta.",
      document:
        documentosProposta.find((document) => document.document_type === "vistoria_imovel") ||
        documentos.find((document) => document.tipo === "vistoria"),
      editable: false,
      pending: false,
    },
  ];

  async function resolveDocumentUrl(document: ContractDocument) {
    const path = document.storage_path || document.file_url;
    if (!path) return null;
    if (/^https?:\/\//i.test(path)) return path;

    const preferredBucket = document.document_subtype === "contratos-assinados"
      || document.document_subtype === "pendente_assinatura_d4sign"
      ? "contratos-assinados"
      : null;
    const buckets = preferredBucket
      ? [preferredBucket, ...DOCUMENT_BUCKETS.filter((bucket) => bucket !== preferredBucket)]
      : [...DOCUMENT_BUCKETS];
    for (const bucket of buckets) {
      const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
      if (data?.signedUrl) return data.signedUrl;
    }
    return null;
  }

  async function openDocument(document: ContractDocument, download = false) {
    const url = await resolveDocumentUrl(document);
    if (!url) {
      toast.error("Não foi possível abrir este documento.");
      return;
    }
    if (!download) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = document.file_name || "documento.pdf";
    anchor.target = "_blank";
    anchor.rel = "noopener";
    window.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  async function replaceUnsignedContract(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !contratoLocacao?.id || !podeEditarContrato) return;
    if (!ACCEPTED_CONTRACT_TYPES.includes(file.type)) {
      toast.error("Envie um arquivo PDF, JPG, PNG ou WEBP.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("O arquivo deve ter no máximo 10 MB.");
      return;
    }

    setReplacingDocument(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id;
      if (!userId) throw new Error("Sessão inválida.");
      const safeName = file.name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9._-]/g, "-")
        .replace(/-+/g, "-");
      const path = `${userId}/${apolice.consulta_id}/contrato_locacao-${Date.now()}-${safeName}`;
      let uploadError: any = null;
      for (const bucket of ["approval-documents", "anexos", "documentos-proposta"]) {
        const { error } = await supabase.storage.from(bucket).upload(path, file, {
          cacheControl: "3600",
          contentType: file.type,
          upsert: true,
        });
        if (!error) {
          uploadError = null;
          break;
        }
        uploadError = error;
        if (!String(error.message || "").toLowerCase().includes("bucket not found")) break;
      }
      if (uploadError) throw uploadError;

      const { error: updateError } = await (supabase.from("documentos_proposta") as any)
        .update({
          file_name: file.name,
          file_url: path,
          file_type: file.type,
          uploaded_by: userId,
        })
        .eq("id", contratoLocacao.id);
      if (updateError) throw updateError;

      toast.success("Contrato atualizado. A nova versão já está disponível.");
      setRefreshKey((value) => value + 1);
    } catch (error: any) {
      toast.error(error?.message || "Não foi possível atualizar o contrato.");
    } finally {
      setReplacingDocument(false);
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        {/* Voltar */}
        <Link to={isStaff ? "/admin/contratos" : "/apolices"} className="inline-flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-900 font-bold">
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
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={replaceUnsignedContract}
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {documentCards.map((item) => {
            const doc = item.document as ContractDocument | undefined;
            const available = Boolean(doc?.file_url || doc?.storage_path);
            return (
              <Card key={item.key} className="p-6 border-neutral-200 rounded-2xl bg-white flex flex-col gap-4">
                <div className="flex items-start justify-between">
                  <div className="w-12 h-12 rounded-xl bg-yellow-50 border border-yellow-200 flex items-center justify-center">
                    <item.icon className="w-5 h-5 text-yellow-700" />
                  </div>
                  <DocStatusBadge status={available ? (item.pending ? "pendente_assinatura" : "disponivel") : "nao_enviado"} />
                </div>
                <div className="space-y-1">
                  <h3 className="font-black text-neutral-900">{item.label}</h3>
                  <p className="text-xs text-neutral-500 font-medium">{item.description}</p>
                  {doc?.file_name && (
                    <p className="text-xs text-neutral-700 font-bold mt-2 break-all">{doc.file_name}</p>
                  )}
                  {(doc?.uploaded_at || doc?.updated_at) && (
                    <p className="text-[10px] text-neutral-400 uppercase tracking-widest font-bold mt-2">
                      Atualizado em {new Date(doc.uploaded_at || doc.updated_at || "").toLocaleDateString("pt-BR")}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 pt-2 mt-auto">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 rounded-lg gap-1.5 font-bold"
                    disabled={!available}
                    onClick={() => doc && void openDocument(doc)}
                  >
                    <Eye size={14} /> Visualizar
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg gap-1.5 font-bold"
                    disabled={!available}
                    onClick={() => doc && void openDocument(doc, true)}
                  >
                    <Download size={14} /> Baixar
                  </Button>
                  {item.editable && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="col-span-2 rounded-lg gap-1.5 font-bold border-yellow-300 bg-yellow-50 hover:bg-yellow-100"
                      disabled={replacingDocument}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {replacingDocument ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                      {replacingDocument ? "Atualizando..." : "Editar arquivo"}
                    </Button>
                  )}
                </div>
                {!doc && (
                  <p className="text-xs text-neutral-400 italic">
                    {item.key === "contrato_nox" && assinatura
                      ? "O documento está sendo preparado para visualização."
                      : "Documento ainda não enviado."}
                  </p>
                )}
              </Card>
            );
          })}
        </div>

        <div className="pt-2">
          <h2 className="mb-4 text-lg font-black text-neutral-900">Faturamento do contrato</h2>
          <FaturasView faturas={faturas} apolice={apolice} />
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
    const status = String(f.status || "pending").toLowerCase();
    const pago = ["pago", "paid", "received", "confirmed", "paid_via_consolidated"].includes(status);
    const aberto = [
      "pendente", "pending", "created", "waiting_payment", "processing",
      "risk_analysis", "approved", "awaiting_consolidation", "scheduled",
    ].includes(status);
    const vencido = status === "overdue" || status === "vencido" || (aberto && venc < hoje);
    return { ...f, statusReal: pago ? "pago" : vencido ? "vencido" : aberto ? "pendente" : status };
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
    pendente_assinatura: { label: "Não assinado", cls: "bg-amber-50 text-amber-700 border-amber-200" },
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
