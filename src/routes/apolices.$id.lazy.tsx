import { createLazyFileRoute, Link } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { supabase } from "@/integrations/supabase/client";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import {
  ArrowLeft, FileText, Download, Eye, AlertCircle, MapPin,
  Calendar, User, Building2, Wallet, Copy, FileCheck, Receipt,
  ClipboardCheck, ShieldCheck, Upload, Loader2, Clock3, Home,
  Check, Search, PenLine, CreditCard, Circle,
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
  file_type?: string | null;
  storage_path?: string | null;
  status?: string | null;
  created_at?: string | null;
  uploaded_at?: string | null;
  updated_at?: string | null;
  tipo?: string | null;
  document_type?: string | null;
  document_subtype?: string | null;
  contract_signature_id?: string | null;
};

type ProposalHistory = {
  id: string;
  tipo_evento: string;
  descricao: string;
  created_at: string;
};

const DOCUMENT_LABELS: Record<string, string> = {
  vistoria_imovel: "Vistoria do imóvel",
  contrato_locacao: "Contrato de locação",
  comprovante_residencia: "Comprovante de residência",
  comprovante_residencia_imovel: "Comprovante de residência",
  comprovante_renda: "Comprovante de renda",
  comprovante_renda_analise: "Comprovante de renda da análise",
  documento_foto: "Documento com foto",
  documento_inquilino: "Documento com foto",
  cnh_analise: "Documento com foto da análise",
  contrato: "Contrato NOX",
  apolice: "Apólice NOX",
  vistoria: "Vistoria do imóvel",
  outro: "Documento adicional",
};

function humanize(value?: string | null) {
  if (!value) return "—";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function documentLabel(document: ContractDocument) {
  if (document.contract_signature_id) {
    return document.document_subtype === "contratos-assinados"
      ? "Contrato NOX assinado"
      : "Apólice para assinatura";
  }
  const type = document.document_type || document.tipo || "outro";
  return DOCUMENT_LABELS[type] || humanize(type);
}

function documentDescription(document: ContractDocument) {
  if (document.contract_signature_id) {
    return document.document_subtype === "contratos-assinados"
      ? "Documento final assinado pelo inquilino."
      : "Documento gerado pela NOX e enviado para assinatura.";
  }
  if (document.document_type === "contrato_locacao") {
    return document.document_subtype === "pendente_assinatura"
      ? "Contrato informado como não assinado; pode ser atualizado até a conclusão da assinatura."
      : "Contrato de locação anexado durante a contratação.";
  }
  if (document.document_type === "documento_foto" || document.document_type === "documento_inquilino") {
    return document.document_subtype
      ? `${humanize(document.document_subtype)} do inquilino.`
      : "Documento de identificação do inquilino.";
  }
  return "Arquivo enviado durante o processo de contratação.";
}

function documentIcon(document: ContractDocument) {
  if (document.contract_signature_id || document.tipo === "apolice") return ShieldCheck;
  if (document.document_type === "contrato_locacao" || document.tipo === "contrato") return FileCheck;
  if (document.document_type === "vistoria_imovel" || document.tipo === "vistoria") return ClipboardCheck;
  return FileText;
}

function ApoliceDetalhe() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const [apolice, setApolice] = useState<any>(null);
  const [documentos, setDocumentos] = useState<any[]>([]);
  const [documentosProposta, setDocumentosProposta] = useState<ContractDocument[]>([]);
  const [assinatura, setAssinatura] = useState<any>(null);
  const [faturas, setFaturas] = useState<any[]>([]);
  const [historico, setHistorico] = useState<ProposalHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [replacingDocument, setReplacingDocument] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setErro(null);
      setAviso(null);
      try {
        const { data: ap, error: apErr } = await supabase
          .from("apolices")
          .select(`
            id, consulta_id, numero, status, vigencia_inicio, vigencia_fim, valor_premio, created_at,
            consulta:consultas_credito(
              id, status, resultado, created_at, approved_at, dados_complementares_em, proposta_enviada_em,
              payment_status, payment_type, payment_confirmed_at, insurance_payment_method_label, contract_period_months,
              base_calculo, valor_aluguel, valor_condominio, valor_taxas, valor_premio_mensal, valor_anual,
              selected_exit_cost, insurance_assistance, insurance_coverages, plano_id,
              terms_accepted_at, contract_accepted_at,
              tenant_name, tenant_document, tenant_email, tenant_telefone, tenant_data_nascimento,
              imovel_subtipo, imovel_cep, imovel_endereco, imovel_numero, imovel_complemento,
              imovel_bairro, imovel_cidade, imovel_estado,
              inquilino:inquilinos(
                nome, cpf, cnpj, razao_social, tipo, data_nascimento, estado_civil, profissao, renda, rg, score,
                profile:profiles!inquilinos_profile_id_fkey(nome, email, telefone)
              ),
              imovel:imoveis(
                endereco, logradouro, numero, complemento, bairro, cidade, estado, cep, tipo,
                valor_aluguel, valor_condominio, valor_taxas, valor_iptu, valor_fundo_reserva, valor_taxa_lixo
              ),
              plano:planos(nome, taxa_premio, cobertura_multiplicador, custo_saida),
              solicitante:profiles!consultas_credito_profile_id_solicitante_fkey(nome, email, telefone)
            ),
            imobiliaria:profiles!apolices_imobiliaria_profile_id_fkey(nome, email),
            corretor:profiles!apolices_corretor_profile_id_fkey(nome, email),
            proprietario:profiles!apolices_proprietario_profile_id_fkey(nome, email)
          `)
          .eq("id", id)
          .maybeSingle();
        if (apErr) throw apErr;
        if (!ap) throw new Error("Apólice não encontrada ou sem acesso.");

        const [docsResult, proposalDocsResult, signatureResult, invoicesResult, historyResult] = await Promise.all([
          supabase.from("documentos_contrato").select("*").eq("apolice_id", id),
          (supabase.from("documentos_proposta") as any)
            .select("id, file_name, file_url, file_type, document_type, document_subtype, contract_signature_id, created_at, updated_at")
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
          supabase
            .from("proposta_historico")
            .select("id, tipo_evento, descricao, created_at")
            .eq("consulta_id", ap.consulta_id)
            .order("created_at", { ascending: false })
            .limit(100),
        ]);

        if (docsResult.error && proposalDocsResult.error) {
          throw new Error("Não foi possível carregar a documentação deste contrato.");
        }

        const partialErrors = [
          docsResult.error,
          proposalDocsResult.error,
          signatureResult.error,
          invoicesResult.error,
          historyResult.error,
        ].filter(Boolean);

        let proposalDocs = (proposalDocsResult.data || []) as ContractDocument[];
        const signature = signatureResult.error ? null : signatureResult.data;
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
              .select("id, file_name, file_url, file_type, document_type, document_subtype, contract_signature_id, created_at, updated_at")
              .or(`consulta_id.eq.${ap.consulta_id},apolice_id.eq.${id}`)
              .order("updated_at", { ascending: false });
            if (!refreshed.error) proposalDocs = (refreshed.data || []) as ContractDocument[];
          }
        }

        if (!cancelled) {
          setApolice(ap);
          setDocumentos(docsResult.data || []);
          setDocumentosProposta(proposalDocs);
          setAssinatura(signature || null);
          setHistorico((historyResult.data || []) as ProposalHistory[]);
          setAviso(
            partialErrors.length
              ? "Algumas informações complementares não puderam ser carregadas. Os dados disponíveis estão exibidos abaixo."
              : null,
          );
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
    ? [imovel.logradouro || imovel.endereco, imovel.numero, imovel.complemento, imovel.bairro, imovel.cidade, imovel.estado]
        .filter(Boolean).join(", ")
    : "Endereço não cadastrado";

  const aluguel = Number(imovel?.valor_aluguel || consulta?.valor_aluguel || 0);
  const condominio = Number(imovel?.valor_condominio || consulta?.valor_condominio || 0);
  const taxas = Number(imovel?.valor_taxas || consulta?.valor_taxas || 0);
  const totalLocacao = aluguel + condominio + taxas;
  const cobertura = Number(plano?.cobertura_multiplicador || 0) * totalLocacao;
  const coberturas = Array.isArray(consulta?.insurance_coverages)
    ? consulta.insurance_coverages.map((item: unknown) => humanize(String(item))).join(", ")
    : "Não informadas";

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
  // O envio da via assinada so pode acontecer uma vez: assim que o upload
  // conclui, o document_subtype passa a "assinado_imobiliaria" e o botao
  // some automaticamente na proxima renderizacao.
  const podeEditarContrato =
    Boolean(contratoLocacao?.id) &&
    contratoLocacao?.document_subtype === "pendente_assinatura";
  const allDocuments = [
    ...documentosProposta.map((document) => ({ document, source: "proposal" as const })),
    ...documentos.map((document) => ({ document: document as ContractDocument, source: "contract" as const })),
  ].sort((a, b) => {
    const first = new Date(a.document.updated_at || a.document.uploaded_at || a.document.created_at || 0).getTime();
    const second = new Date(b.document.updated_at || b.document.uploaded_at || b.document.created_at || 0).getTime();
    return second - first;
  });

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

      // Marca o contrato como assinado (document_subtype deixa de ser
      // "pendente_assinatura"), para que o botao "Enviar contrato com assinatura"
      // suma apos o unico envio permitido.
      const { error: updateError } = await (supabase.from("documentos_proposta") as any)
        .update({
          file_name: file.name,
          file_url: path,
          file_type: file.type,
          uploaded_by: userId,
          document_subtype: "assinado_imobiliaria",
        })
        .eq("id", contratoLocacao.id);
      if (updateError) throw updateError;

      toast.success("Contrato assinado enviado. Essa acao so pode ser feita uma vez.");
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

        {aviso && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <AlertCircle className="mt-0.5 shrink-0" size={18} />
            <p className="font-semibold">{aviso}</p>
          </div>
        )}

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
               <ResumoItem icone={Wallet} label="Prêmio" valor={formatBRL(Number(apolice.valor_premio || 0))} />
              <ResumoItem icone={Calendar} label="Vigência" valor={`${formatDate(apolice.vigencia_inicio)} → ${formatDate(apolice.vigencia_fim)}`} />
            </div>
          </div>
        </div>

        <div>
          <div className="mb-4">
            <h2 className="text-lg font-black text-neutral-900">Resumo completo da contratação</h2>
            <p className="mt-1 text-sm text-neutral-500">
              Dados enviados e decisões registradas durante todo o processo deste cliente.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <DetalheCard icon={ClipboardCheck} title="Processo">
              <DetalheLinha label="Status da consulta" value={humanize(consulta?.status)} />
              <DetalheLinha label="Resultado" value={humanize(consulta?.resultado)} />
              <DetalheLinha label="Criado em" value={formatDate(consulta?.created_at)} />
              <DetalheLinha label="Aprovado em" value={formatDate(consulta?.approved_at)} />
              <DetalheLinha label="Dados concluídos" value={formatDate(consulta?.dados_complementares_em)} />
              <DetalheLinha label="Proposta enviada" value={formatDate(consulta?.proposta_enviada_em)} />
              <DetalheLinha label="Período" value={consulta?.contract_period_months ? `${consulta.contract_period_months} meses` : "—"} />
            </DetalheCard>

            <DetalheCard icon={User} title="Cliente">
              <DetalheLinha label="Nome" value={inquilino?.nome || consulta?.tenant_name || "—"} />
              <DetalheLinha label="CPF/CNPJ" value={inquilino?.cpf || inquilino?.cnpj || consulta?.tenant_document || "—"} />
              <DetalheLinha label="Tipo" value={inquilino?.tipo === "pj" ? "Pessoa jurídica" : inquilino?.tipo === "pf" ? "Pessoa física" : humanize(inquilino?.tipo)} />
              <DetalheLinha label="Razão social" value={inquilino?.razao_social || "—"} />
              <DetalheLinha label="RG" value={inquilino?.rg || "—"} />
              <DetalheLinha label="Nascimento" value={formatDate(inquilino?.data_nascimento || consulta?.tenant_data_nascimento)} />
              <DetalheLinha label="E-mail" value={inquilino?.profile?.email || consulta?.tenant_email || "—"} />
              <DetalheLinha label="Telefone" value={inquilino?.profile?.telefone || consulta?.tenant_telefone || "—"} />
              <DetalheLinha label="Profissão" value={inquilino?.profissao || "—"} />
              <DetalheLinha label="Estado civil" value={humanize(inquilino?.estado_civil)} />
              <DetalheLinha label="Renda informada" value={inquilino?.renda ? formatBRL(Number(inquilino.renda)) : "—"} />
              <DetalheLinha label="Score registrado" value={inquilino?.score != null ? String(inquilino.score) : "—"} />
            </DetalheCard>

            <DetalheCard icon={Wallet} title="Plano e valores">
              <DetalheLinha label="Plano escolhido" value={plano?.nome || "Plano padrão"} />
              <DetalheLinha label="Aluguel" value={formatBRL(aluguel)} />
              <DetalheLinha label="Condomínio" value={formatBRL(condominio)} />
              <DetalheLinha label="Outras taxas" value={formatBRL(taxas)} />
              <DetalheLinha label="Total da locação" value={formatBRL(totalLocacao)} strong />
              <DetalheLinha label="Prêmio mensal" value={formatBRL(Number(consulta?.valor_premio_mensal || 0))} />
              <DetalheLinha label="Prêmio do contrato" value={formatBRL(Number(apolice.valor_premio || consulta?.valor_anual || 0))} strong />
              <DetalheLinha label="Cobertura estimada" value={cobertura ? formatBRL(cobertura) : "—"} />
              <DetalheLinha label="Custo de saída" value={formatBRL(Number(consulta?.selected_exit_cost || plano?.custo_saida || 0))} />
              <DetalheLinha label="Forma de pagamento" value={consulta?.insurance_payment_method_label || humanize(consulta?.payment_type)} />
            </DetalheCard>

            <DetalheCard icon={Home} title="Imóvel">
              <DetalheLinha label="Tipo" value={imovel?.tipo || consulta?.imovel_subtipo || "—"} />
              <DetalheLinha label="Endereço" value={endereco} />
              <DetalheLinha label="CEP" value={imovel?.cep || consulta?.imovel_cep || "—"} />
              <DetalheLinha label="IPTU" value={formatBRL(Number(imovel?.valor_iptu || 0))} />
              <DetalheLinha label="Fundo de reserva" value={formatBRL(Number(imovel?.valor_fundo_reserva || 0))} />
              <DetalheLinha label="Taxa de lixo" value={formatBRL(Number(imovel?.valor_taxa_lixo || 0))} />
            </DetalheCard>

            <DetalheCard icon={ShieldCheck} title="Coberturas e pagamento">
              <DetalheLinha label="Coberturas" value={coberturas} />
              <DetalheLinha label="Assistência" value={humanize(consulta?.insurance_assistance)} />
              <DetalheLinha label="Status do pagamento" value={humanize(consulta?.payment_status)} />
              <DetalheLinha label="Responsável pela proposta" value={consulta?.solicitante?.nome || "—"} />
              <DetalheLinha label="E-mail do responsável" value={consulta?.solicitante?.email || "—"} />
            </DetalheCard>
          </div>
        </div>

        {/* DOSSIÊ DE DOCUMENTOS */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-neutral-900">Documentação enviada</h2>
            <p className="mt-1 text-sm text-neutral-500">
              {allDocuments.length} arquivo(s) anexado(s) à contratação.
            </p>
          </div>
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
        {allDocuments.length === 0 ? (
          <Card className="border-dashed border-neutral-300 bg-white p-10 text-center">
            <FileText className="mx-auto mb-3 text-neutral-300" size={34} />
            <p className="font-bold text-neutral-900">Nenhum documento foi enviado para este processo.</p>
          </Card>
        ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {allDocuments.map(({ document: doc, source }) => {
            const Icon = documentIcon(doc);
            const available = Boolean(doc?.file_url || doc?.storage_path);
            const pending = doc.document_subtype === "pendente_assinatura" ||
              (Boolean(doc.contract_signature_id) && !assinaturaConcluida);
            const editable = source === "proposal" && doc.id === contratoLocacao?.id && podeEditarContrato;
            const uploadedAt = doc?.uploaded_at || doc?.updated_at || doc?.created_at;
            return (
              <Card
                key={`${source}-${doc.id}`}
                className={`p-5 border rounded-2xl bg-white flex flex-col min-h-[260px] shadow-sm ${
                  pending ? "border-red-200 ring-1 ring-red-100" : "border-neutral-200"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div
                    className={`w-11 h-11 rounded-xl border flex items-center justify-center shrink-0 ${
                      pending
                        ? "bg-red-50 border-red-200"
                        : "bg-yellow-50 border-yellow-200"
                    }`}
                  >
                    <Icon className={`w-5 h-5 ${pending ? "text-red-600" : "text-yellow-700"}`} />
                  </div>
                  <DocStatusBadge status={available ? (pending ? "pendente_assinatura" : "disponivel") : "nao_enviado"} />
                </div>

                <div className="mt-4 space-y-1.5 flex-1">
                  <h3 className="font-black text-neutral-900 text-base leading-tight">{documentLabel(doc)}</h3>
                  <p className="text-xs text-neutral-500 font-medium leading-relaxed">{documentDescription(doc)}</p>
                  {doc?.file_name && (
                    <p className="text-xs text-neutral-700 font-bold pt-1 break-all line-clamp-2">{doc.file_name}</p>
                  )}
                  {uploadedAt && (
                    <p className="text-[10px] text-neutral-400 uppercase tracking-widest font-bold pt-1">
                      Enviado em {new Date(uploadedAt).toLocaleDateString("pt-BR")}
                    </p>
                  )}
                </div>

                {editable && (
                  <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    <span>
                      Contrato enviado sem assinatura. Envie a via assinada para
                      concluir a contratação — este envio só pode ser feito uma vez.
                    </span>
                  </div>
                )}

                <div className="pt-4 mt-auto flex flex-col gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-lg gap-1.5 font-bold"
                      disabled={!available}
                      onClick={() => doc && void openDocument(doc)}
                    >
                      <Eye size={14} /> Visualizar
                    </Button>
                    <Button
                      size="sm"
                      className="bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg gap-1.5 font-bold"
                      disabled={!available}
                      onClick={() => doc && void openDocument(doc, true)}
                    >
                      <Download size={14} /> Baixar
                    </Button>
                  </div>
                  {editable && (
                    <Button
                      size="sm"
                      className="w-full rounded-lg gap-1.5 font-black bg-red-600 hover:bg-red-700 text-white"
                      disabled={replacingDocument}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {replacingDocument ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                      {replacingDocument ? "Enviando..." : "Enviar contrato assinado"}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
        )}

        <div className="pt-2">
          <h2 className="mb-4 text-lg font-black text-neutral-900">Histórico do processo</h2>
          <ProcessoTimeline
            consulta={consulta}
            apolice={apolice}
            assinaturaConcluida={assinaturaConcluida}
          />
        </div>

        <div className="pt-2">
          <h2 className="mb-4 text-lg font-black text-neutral-900">Faturamento do contrato</h2>
          <FaturasView faturas={faturas} apolice={apolice} />
        </div>

      </div>
    </DashboardLayout>
  );
}

function ProcessoTimeline({
  consulta,
  apolice,
  assinaturaConcluida,
}: {
  consulta: any;
  apolice: any;
  assinaturaConcluida: boolean;
}) {
  const paidStatuses = new Set([
    "paid", "pago", "received", "confirmed", "approved", "paid_via_consolidated",
  ]);
  const steps = [
    {
      key: "consultou",
      label: "Consultou",
      icon: Search,
      done: Boolean(consulta?.created_at),
      at: consulta?.created_at as string | null | undefined,
    },
    {
      key: "escolheu",
      label: "Escolheu o plano",
      icon: ClipboardCheck,
      done: Boolean(consulta?.plano_id || consulta?.insurance_coverages),
      at: consulta?.dados_complementares_em as string | null | undefined,
    },
    {
      key: "contratou",
      label: "Contratou o plano",
      icon: FileCheck,
      done: Boolean(
        consulta?.contract_accepted_at ||
          consulta?.terms_accepted_at ||
          consulta?.proposta_enviada_em,
      ),
      at: (consulta?.contract_accepted_at ||
        consulta?.terms_accepted_at ||
        consulta?.proposta_enviada_em) as string | null | undefined,
    },
    {
      key: "assinou",
      label: "Assinou",
      icon: PenLine,
      done: Boolean(assinaturaConcluida),
      at: null,
    },
    {
      key: "pagou",
      label: "Pagou",
      icon: CreditCard,
      done:
        paidStatuses.has(String(consulta?.payment_status || "").toLowerCase()) ||
        Boolean(consulta?.payment_confirmed_at) ||
        ["ativa", "emitida"].includes(String(apolice?.status || "")),
      at: consulta?.payment_confirmed_at as string | null | undefined,
    },
  ];

  return (
    <Card className="border-neutral-200 bg-white p-6">
      <ol className="flex flex-col gap-0 md:flex-row md:items-start md:justify-between">
        {steps.map((step, index) => {
          const Icon = step.done ? Check : step.icon;
          const isLast = index === steps.length - 1;
          return (
            <li
              key={step.key}
              className="flex md:flex-col md:items-center md:flex-1 gap-3 md:gap-2 relative pb-4 md:pb-0"
            >
              <div className="flex flex-col items-center md:flex-row md:w-full">
                <span
                  className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 ${
                    step.done
                      ? "bg-green-500 border-green-500 text-white"
                      : "bg-white border-neutral-200 text-neutral-300"
                  }`}
                >
                  {step.done ? <Check size={18} strokeWidth={3} /> : <Icon size={16} />}
                </span>
                {!isLast && (
                  <span
                    className={`hidden md:block flex-1 h-0.5 ${
                      step.done ? "bg-green-400" : "bg-neutral-200"
                    }`}
                  />
                )}
                {!isLast && (
                  <span
                    className={`md:hidden absolute left-5 top-10 bottom-0 w-0.5 ${
                      step.done ? "bg-green-400" : "bg-neutral-200"
                    }`}
                  />
                )}
              </div>
              <div className="min-w-0 md:text-center md:mt-2 pb-2 md:pb-0">
                <p
                  className={`text-sm font-black ${
                    step.done ? "text-neutral-900" : "text-neutral-400"
                  }`}
                >
                  {step.label}
                </p>
                {step.done && step.at && (
                  <p className="mt-1 text-[10px] uppercase tracking-widest font-bold text-neutral-400">
                    {new Date(step.at).toLocaleDateString("pt-BR")}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
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

function DetalheCard({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof FileText;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="rounded-2xl border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-yellow-50 text-yellow-700">
          <Icon size={17} />
        </span>
        <h3 className="font-black text-neutral-900">{title}</h3>
      </div>
      <div className="divide-y divide-neutral-100">{children}</div>
    </Card>
  );
}

function DetalheLinha({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="shrink-0 text-neutral-500">{label}</span>
      <span className={`text-right text-neutral-900 ${strong ? "font-black" : "font-semibold"}`}>
        {value || "—"}
      </span>
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
                        <Button size="sm" variant="outline" className="rounded-lg h-8 gap-1" onClick={() => window.open(f.boleto_url, "_blank", "noopener,noreferrer")}>
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
                          onClick={() => window.open(f.comprovante_url, "_blank", "noopener,noreferrer")}
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
    emitida: "bg-green-400/10 text-green-300 border-green-400/30",
    pendente: "bg-amber-400/10 text-amber-300 border-amber-400/30",
    emitida_pendente: "bg-amber-400/10 text-amber-300 border-amber-400/30",
    cancelada: "bg-red-400/10 text-red-300 border-red-400/30",
    encerrada: "bg-neutral-400/10 text-neutral-300 border-neutral-400/30",
  };
  return (
    <Badge className={`${map[status] || map.pendente} border text-[10px] uppercase font-black px-2.5 py-0.5`}>
      {humanize(status)}
    </Badge>
  );
}

function DocStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    disponivel:  { label: "Disponível",   cls: "bg-green-50 text-green-700 border-green-200" },
    pendente:    { label: "Pendente",     cls: "bg-amber-50 text-amber-700 border-amber-200" },
    pendente_assinatura: { label: "Não assinado", cls: "bg-red-50 text-red-700 border-red-200" },
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
