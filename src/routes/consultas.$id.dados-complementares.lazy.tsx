import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { supabase } from "@/integrations/supabase/client";
import { ensureTenantUser } from "@/lib/proposta.functions";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, X, Building2, User, FileText, ClipboardCheck, IdCard, Receipt, CheckCircle2, AlertTriangle } from "lucide-react";

export const Route = createLazyFileRoute("/consultas/$id/dados-complementares")({
  component: () => (
    <ProtectedRoute>
      <DadosComplementaresPage />
    </ProtectedRoute>
  ),
});

const SUBTIPOS = [
  "Apartamento",
  "Casa",
  "Chácara",
  "Sobrado",
  "Kitnet",
  "Sala comercial",
  "Galpão",
  "Terreno",
  "Outro",
];

const DOCUMENTOS_BUCKETS = ["approval-documents", "anexos", "documentos-proposta"];

function safeFileName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function maskCPF(v: string) {
  return v.replace(/\D/g, "").slice(0, 11)
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}
function maskTel(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d{4})(\d{0,4})/, "($1) $2-$3").trim();
  return d.replace(/(\d{2})(\d{5})(\d{0,4})/, "($1) $2-$3").trim();
}
function maskCEP(v: string) {
  return v.replace(/\D/g, "").slice(0, 8).replace(/(\d{5})(\d)/, "$1-$2");
}

function DadosComplementaresPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const ensureTenantFn = useServerFn(ensureTenantUser);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [consulta, setConsulta] = useState<any>(null);
  const [existingDocs, setExistingDocs] = useState<any[]>([]);
  const [formError, setFormError] = useState("");

  // Endereço imóvel
  const [cep, setCep] = useState("");
  const [endereco, setEndereco] = useState("");
  const [bairro, setBairro] = useState("");
  const [cidade, setCidade] = useState("");
  const [estado, setEstado] = useState("");
  const [numero, setNumero] = useState("");
  const [complemento, setComplemento] = useState("");
  const [subtipo, setSubtipo] = useState("");

  // Inquilino
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [nascimento, setNascimento] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");

  // Pagamento
  const [paymentType, setPaymentType] = useState<"imobiliaria" | "inquilino" | "">("");

  // Documentos (4 obrigatórios)
  const [docVistoria, setDocVistoria] = useState<File | null>(null);
  const [docContrato, setDocContrato] = useState<File | null>(null);
  const [contratoAssinado, setContratoAssinado] = useState<"sim" | "nao" | "">("");
  const [docInquilino, setDocInquilino] = useState<File | null>(null);
  const [docInquilinoSubtype, setDocInquilinoSubtype] = useState<"cnh" | "rg" | "">("");
  const [docResidencia, setDocResidencia] = useState<File | null>(null);
  const [docRenda, setDocRenda] = useState<File | null>(null);

  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const err = (k: string) => errors[k] ? "border-red-500 ring-1 ring-red-500" : "";
  const hasExistingDoc = (...types: string[]) => existingDocs.some((doc) => types.includes(doc.document_type));
  const findExistingDoc = (...types: string[]) => existingDocs.find((doc) => types.includes(doc.document_type));

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from("consultas_credito")
          .select(`*, inquilinos(*), imoveis(*)`)
          .eq("id", id)
          .single();
        if (error) throw error;
        setConsulta(data);
        const i = (data as any).inquilinos ?? {};
        const im = (data as any).imoveis ?? {};
        setNome(i.nome ?? (data as any).tenant_name ?? "");
        setCpf(maskCPF(i.cpf ?? (data as any).tenant_document ?? ""));
        setEmail(i.email ?? (data as any).tenant_email ?? "");
        setTelefone(maskTel(i.telefone ?? (data as any).tenant_telefone ?? ""));
        setNascimento((data as any).tenant_data_nascimento ?? "");
        setCep(maskCEP((data as any).imovel_cep ?? im.cep ?? ""));
        setEndereco((data as any).imovel_endereco ?? im.endereco ?? "");
        setBairro((data as any).imovel_bairro ?? im.bairro ?? "");
        setCidade((data as any).imovel_cidade ?? im.cidade ?? "");
        setEstado((data as any).imovel_estado ?? im.estado ?? "");
        setNumero((data as any).imovel_numero ?? im.numero ?? "");
        setComplemento((data as any).imovel_complemento ?? im.complemento ?? "");
        setSubtipo((data as any).imovel_subtipo ?? "");
        if ((data as any).payment_type) setPaymentType((data as any).payment_type);

        const { data: docs } = await supabase
          .from("documentos_proposta")
          .select("id, file_name, document_type, document_subtype")
          .eq("consulta_id", id);
        setExistingDocs(docs ?? []);
        const docContratoExistente = (docs ?? []).find((doc: any) => doc.document_type === "contrato_locacao");
        const docInq = (docs ?? []).find((doc: any) => doc.document_type === "documento_foto" || doc.document_type === "documento_inquilino");
        if (docInq?.document_subtype) setDocInquilinoSubtype(docInq.document_subtype as "cnh" | "rg");
        if (docContratoExistente?.document_subtype === "assinado_todas_partes") setContratoAssinado("sim");
        if (docContratoExistente?.document_subtype === "pendente_assinatura") setContratoAssinado("nao");
      } catch (e: any) {
        toast.error("Erro ao carregar consulta: " + e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  async function buscarCEP(value: string) {
    const limpo = value.replace(/\D/g, "");
    if (limpo.length !== 8) return;
    try {
      const r = await fetch(`https://viacep.com.br/ws/${limpo}/json/`);
      const j = await r.json();
      if (j.erro) return;
      setEndereco(j.logradouro ?? "");
      setBairro(j.bairro ?? "");
      setCidade(j.localidade ?? "");
      setEstado(j.uf ?? "");
    } catch { /* ignore */ }
  }

  const ACCEPTED_MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
  const MAX_SIZE = 10 * 1024 * 1024;

  function validateFile(f: File): string | null {
    if (!ACCEPTED_MIME.includes(f.type)) return "Formato inválido. Use PDF, JPG, PNG ou WEBP.";
    if (f.size > MAX_SIZE) return "Arquivo acima de 10MB.";
    return null;
  }

  function pickFile(files: FileList | null, setter: (f: File | null) => void) {
    const f = files?.[0];
    if (!f) return;
    const err = validateFile(f);
    if (err) return toast.error(err);
    setter(f);
  }

  async function handleSalvar() {
    setFormError("");
    const e: Record<string, boolean> = {};
    if (!cep.trim()) e.cep = true;
    if (!subtipo) e.subtipo = true;
    if (!endereco.trim()) e.endereco = true;
    if (!bairro.trim()) e.bairro = true;
    if (!cidade.trim()) e.cidade = true;
    if (!estado.trim()) e.estado = true;
    if (!numero.trim()) e.numero = true;
    if (!nome.trim()) e.nome = true;
    if (cpf.replace(/\D/g, "").length < 11) e.cpf = true;
    if (!email.trim()) e.email = true;
    if (!telefone.trim()) e.telefone = true;
    if (!paymentType) e.paymentType = true;
    if (!docVistoria && !hasExistingDoc("vistoria_imovel")) e.docVistoria = true;
    if (!docContrato && !hasExistingDoc("contrato_locacao")) e.docContrato = true;
    if (!contratoAssinado) e.contratoAssinado = true;
    if (!docInquilinoSubtype) e.docInquilinoSubtype = true;
    if (!docInquilino && !hasExistingDoc("documento_foto", "documento_inquilino")) e.docInquilino = true;
    if (!docResidencia && !hasExistingDoc("comprovante_residencia", "comprovante_residencia_imovel")) e.docResidencia = true;
    if (!docRenda && !hasExistingDoc("comprovante_renda")) e.docRenda = true;

    setErrors(e);
    if (Object.keys(e).length > 0) {
      const labels: Record<string, string> = {
        cep: "CEP",
        subtipo: "Subtipo do imóvel",
        endereco: "Endereço",
        bairro: "Bairro",
        cidade: "Cidade",
        estado: "Estado",
        numero: "Número",
        nome: "Nome",
        cpf: "CPF",
        email: "E-mail",
        telefone: "Telefone",
        paymentType: "Tipo de pagamento",
        docVistoria: "Vistoria do imóvel",
        docContrato: "Contrato de locação",
        contratoAssinado: "Contrato assinado por todas as partes",
        docInquilinoSubtype: "Tipo do documento com foto",
        docInquilino: "Documento com foto",
        docResidencia: "Comprovante de residência",
        docRenda: "Comprovante de renda",
      };
      const missing = Object.keys(e).map((key) => labels[key] ?? key);
      const msg = `Preencha os campos destacados em vermelho: ${missing.join(", ")}.`;
      setFormError(msg);
      toast.error(msg);
      // scroll to first error
      setTimeout(() => {
        const el = document.querySelector("[data-error='true']");
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
      return;
    }

    setSaving(true);
    try {
      // 0. Garante sessão Supabase ativa (sem ela, o backend retorna 401)
      const { data: sessData } = await supabase.auth.getSession();
      if (!sessData.session?.access_token) {
        toast.error("Sua sessão expirou. Faça login novamente para continuar.");
        setSaving(false);
        const returnTo = encodeURIComponent(window.location.pathname);
        setTimeout(() => window.location.replace(`/login?returnTo=${returnTo}`), 800);
        return;
      }

      // 1. Cria/recupera user inquilino
      await supabase.auth.refreshSession();

      let tenantUserId = (consulta as any)?.tenant_user_id ?? null;
      try {
        const tenantResult = await ensureTenantFn({
          data: {
            consultaId: id,
            email,
            nome,
            cpf: cpf.replace(/\D/g, ""),
            telefone,
          },
        });
        tenantUserId = tenantResult.tenantUserId ?? tenantUserId;
      } catch (tenantErr) {
        console.warn("Nao foi possivel vincular o inquilino neste momento.", tenantErr);
        toast.warning("Dados salvos sem vincular o acesso do inquilino agora.");
      }


      // 2. Atualiza consulta
      const billingRole = paymentType === "imobiliaria" ? "imobiliaria" : "inquilino";
      const billingUserId = paymentType === "inquilino" ? tenantUserId : null;
      const previousDocumentos = ((consulta as any)?.documentos && typeof (consulta as any).documentos === "object")
        ? (consulta as any).documentos
        : {};
      const contratoPendente = contratoAssinado === "nao";
      const { error: updErr } = await supabase
        .from("consultas_credito")
        .update({
          imovel_cep: cep,
          imovel_endereco: endereco,
          imovel_bairro: bairro,
          imovel_cidade: cidade,
          imovel_estado: estado,
          imovel_numero: numero,
          imovel_complemento: complemento || null,
          imovel_subtipo: subtipo,
          tenant_user_id: tenantUserId,
          tenant_email: email,
          tenant_telefone: telefone,
          tenant_data_nascimento: nascimento || null,
          payment_type: paymentType,
          billing_responsible_role: billingRole,
          billing_responsible_user_id: billingUserId,
          dados_complementares_em: new Date().toISOString(),
          documentos: {
            ...previousDocumentos,
            dados_complementares: {
              ...(previousDocumentos as any).dados_complementares,
              contrato_locacao_assinado: contratoAssinado === "sim",
              contrato_locacao_pendencia: contratoPendente
                ? "Enviar contrato de locação assinado e atualizado após finalizar."
                : null,
              documentos_obrigatorios: [
                "vistoria_imovel",
                "contrato_locacao",
                "comprovante_residencia",
                "comprovante_renda",
                "documento_foto",
              ],
            },
          },
        } as any)
        .eq("id", id);
      if (updErr) throw updErr;

      // 3. Upload de documentos (4 obrigatórios)
      const { data: { user } } = await supabase.auth.getUser();
      const uploaderId = user?.id;
      if (!uploaderId) throw new Error("Usuário não autenticado");

      const docs: Array<{ file: File; type: string; subtype: string | null }> = [
        docVistoria ? { file: docVistoria, type: "vistoria_imovel", subtype: null } : null,
        docContrato ? { file: docContrato, type: "contrato_locacao", subtype: contratoAssinado === "sim" ? "assinado_todas_partes" : "pendente_assinatura" } : null,
        docResidencia ? { file: docResidencia, type: "comprovante_residencia", subtype: "pode_ser_imovel_antigo" } : null,
        docRenda ? { file: docRenda, type: "comprovante_renda", subtype: null } : null,
        docInquilino ? { file: docInquilino, type: "documento_foto", subtype: docInquilinoSubtype } : null,
      ].filter(Boolean) as Array<{ file: File; type: string; subtype: string | null }>;

      for (const d of docs) {
        const path = `${uploaderId}/${id}/${d.type}-${Date.now()}-${safeFileName(d.file.name)}`;
        let uploadError: any = null;
        for (const bucket of DOCUMENTOS_BUCKETS) {
          const { error } = await supabase.storage
            .from(bucket)
            .upload(path, d.file, { cacheControl: "3600", upsert: true, contentType: d.file.type });
          if (!error) {
            uploadError = null;
            break;
          }
          uploadError = error;
          const msg = String(error.message ?? "").toLowerCase();
          if (!msg.includes("bucket not found")) break;
        }
        if (uploadError) throw new Error(`Falha ao enviar ${d.file.name}: ${uploadError.message}`);
        const { error: insErr } = await supabase.from("documentos_proposta").insert({
          consulta_id: id,
          tenant_user_id: tenantUserId,
          file_name: d.file.name,
          file_url: path,
          file_type: d.file.type,
          document_type: d.type,
          document_subtype: d.subtype,
          uploaded_by: uploaderId,
        } as any);
        if (insErr) throw insErr;
      }

      toast.success("Dados salvos!", { duration: 5000 });
      navigate({ to: "/consultas/$id/finalizar", params: { id } });
    } catch (e: any) {
      const msg = "Erro ao salvar: " + e.message;
      setFormError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  if (loading || !consulta) {
    return <DashboardLayout><div className="p-10 text-sm text-neutral-500">Carregando...</div></DashboardLayout>;
  }

  return (
    <DashboardLayout>
      <div className="flex-1 flex flex-col px-4 sm:px-6 py-6">
        <div className="w-full max-w-4xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-neutral-900">Dados complementares</h1>
            <p className="text-sm text-neutral-500 mt-1">Complete as informações para avançar com a proposta.</p>
          </div>

          {/* Endereço */}
          <section className="bg-white rounded-2xl border border-neutral-100 p-5 sm:p-6 space-y-4">
            <h2 className="text-sm font-black uppercase tracking-widest text-neutral-700">Endereço do imóvel a ser alugado</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>CEP</Label>
                <Input data-error={errors.cep || undefined} className={err("cep")} value={cep} onChange={(e) => { setCep(maskCEP(e.target.value)); buscarCEP(e.target.value); setErrors(p => ({ ...p, cep: false })); }} placeholder="00000-000" />
              </div>
              <div>
                <Label>Subtipo do imóvel</Label>
                <Select value={subtipo} onValueChange={(v) => { setSubtipo(v); setErrors(p => ({ ...p, subtipo: false })); }}>
                  <SelectTrigger data-error={errors.subtipo || undefined} className={err("subtipo")}><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{SUBTIPOS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2"><Label>Endereço</Label><Input data-error={errors.endereco || undefined} className={err("endereco")} value={endereco} onChange={(e) => { setEndereco(e.target.value); setErrors(p => ({ ...p, endereco: false })); }} /></div>
              <div><Label>Bairro</Label><Input data-error={errors.bairro || undefined} className={err("bairro")} value={bairro} onChange={(e) => { setBairro(e.target.value); setErrors(p => ({ ...p, bairro: false })); }} /></div>
              <div><Label>Cidade</Label><Input data-error={errors.cidade || undefined} className={err("cidade")} value={cidade} onChange={(e) => { setCidade(e.target.value); setErrors(p => ({ ...p, cidade: false })); }} /></div>
              <div><Label>Estado</Label><Input data-error={errors.estado || undefined} className={err("estado")} value={estado} onChange={(e) => { setEstado(e.target.value); setErrors(p => ({ ...p, estado: false })); }} maxLength={2} /></div>
              <div><Label>Número</Label><Input data-error={errors.numero || undefined} className={err("numero")} value={numero} onChange={(e) => { setNumero(e.target.value); setErrors(p => ({ ...p, numero: false })); }} /></div>
              <div className="sm:col-span-2"><Label>Complemento</Label><Input value={complemento} onChange={(e) => setComplemento(e.target.value)} /></div>
            </div>
          </section>

          {/* Contato do inquilino */}
          <section className="bg-white rounded-2xl border border-neutral-100 p-5 sm:p-6 space-y-4">
            <h2 className="text-sm font-black uppercase tracking-widest text-neutral-700">Contato do inquilino (Pagador)</h2>
            <p className="text-xs text-neutral-500">Não é mais necessário fornecer o endereço do inquilino — usaremos o endereço do imóvel alugado.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><Label>Nome</Label><Input data-error={errors.nome || undefined} className={err("nome")} value={nome} onChange={(e) => { setNome(e.target.value); setErrors(p => ({ ...p, nome: false })); }} /></div>
              <div><Label>CPF</Label><Input data-error={errors.cpf || undefined} className={err("cpf")} value={cpf} onChange={(e) => { setCpf(maskCPF(e.target.value)); setErrors(p => ({ ...p, cpf: false })); }} placeholder="000.000.000-00" /></div>
              <div><Label>Data de nascimento</Label><Input type="date" value={nascimento} onChange={(e) => setNascimento(e.target.value)} /></div>
              <div><Label>E-mail *</Label><Input data-error={errors.email || undefined} className={err("email")} type="email" value={email} onChange={(e) => { setEmail(e.target.value); setErrors(p => ({ ...p, email: false })); }} /></div>
              <div className="sm:col-span-2"><Label>Telefone *</Label><Input data-error={errors.telefone || undefined} className={err("telefone")} value={telefone} onChange={(e) => { setTelefone(maskTel(e.target.value)); setErrors(p => ({ ...p, telefone: false })); }} placeholder="(00) 00000-0000" /></div>
            </div>
          </section>

          {/* Tipo de pagamento */}
          <section className="bg-white rounded-2xl border border-neutral-100 p-5 sm:p-6 space-y-4">
            <h2 className="text-sm font-black uppercase tracking-widest text-neutral-700">Tipo de pagamento</h2>
            <div data-error={errors.paymentType || undefined} className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${errors.paymentType ? "rounded-xl ring-2 ring-red-500 p-1" : ""}`}>
              <button
                type="button"
                onClick={() => { setPaymentType("imobiliaria"); setErrors(p => ({ ...p, paymentType: false })); }}
                className={`text-left p-5 rounded-xl border-2 transition-all ${paymentType === "imobiliaria" ? "border-yellow-400 bg-yellow-50" : "border-neutral-200 bg-white hover:border-neutral-300"}`}
              >
                <div className="flex items-center gap-2 mb-2"><Building2 size={18} /><span className="font-black text-sm">Pagamento via Imobiliária</span></div>
                <p className="text-xs text-neutral-600 leading-relaxed">O inquilino paga a 1ª parcela e a taxa de ativação. As demais parcelas são cobradas da imobiliária em um único boleto mensal, reunindo todos os contratos ativos.</p>
              </button>
              <button
                type="button"
                onClick={() => { setPaymentType("inquilino"); setErrors(p => ({ ...p, paymentType: false })); }}
                className={`text-left p-5 rounded-xl border-2 transition-all ${paymentType === "inquilino" ? "border-yellow-400 bg-yellow-50" : "border-neutral-200 bg-white hover:border-neutral-300"}`}
              >
                <div className="flex items-center gap-2 mb-2"><User size={18} /><span className="font-black text-sm">Pagamento via Inquilino</span></div>
                <p className="text-xs text-neutral-600 leading-relaxed">O inquilino paga a fiança diretamente para a NOX. As faturas e documentos ficam disponíveis no painel do inquilino.</p>
              </button>
            </div>
          </section>

          {/* Documentos */}
          <section className="bg-white rounded-2xl border border-neutral-100 p-5 sm:p-6 space-y-5">
            <div>
              <h2 className="text-sm font-black uppercase tracking-widest text-neutral-700">Documentos</h2>
              <p className="text-sm text-neutral-500 mt-1">Envie os documentos obrigatórios para concluir a proposta.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <UploadCard
                icon={<ClipboardCheck size={18} />}
                title="Vistoria do Imóvel"
                description="Envie a vistoria do imóvel em PDF, JPG, PNG ou WEBP."
                file={docVistoria}
                existingFileName={findExistingDoc("vistoria_imovel")?.file_name}
                error={errors.docVistoria}
                onPick={(files) => { pickFile(files, setDocVistoria); setErrors(p => ({ ...p, docVistoria: false })); }}
                onClear={() => setDocVistoria(null)}
              />

              <UploadCard
                icon={<FileText size={18} />}
                title="Contrato de Locação"
                description="Envie o contrato de locação assinado ou em andamento, em PDF, JPG, PNG ou WEBP."
                file={docContrato}
                existingFileName={findExistingDoc("contrato_locacao")?.file_name}
                error={errors.docContrato || errors.contratoAssinado}
                onPick={(files) => { pickFile(files, setDocContrato); setErrors(p => ({ ...p, docContrato: false })); }}
                onClear={() => setDocContrato(null)}
                extraHeader={
                  <div data-error={errors.contratoAssinado || undefined} className={`space-y-2 rounded-lg ${errors.contratoAssinado ? "ring-1 ring-red-500 p-2" : ""}`}>
                    <Label className="text-xs">Já foi assinado por todas as partes? *</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {(["sim", "nao"] as const).map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => { setContratoAssinado(value); setErrors(p => ({ ...p, contratoAssinado: false })); }}
                          className={`h-9 rounded-lg border text-xs font-bold transition-colors ${
                            contratoAssinado === value
                              ? "border-yellow-400 bg-yellow-50 text-neutral-900"
                              : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"
                          }`}
                        >
                          {value === "sim" ? "Sim" : "Não"}
                        </button>
                      ))}
                    </div>
                    {contratoAssinado === "nao" && (
                      <div className="flex gap-2 rounded-lg border border-yellow-300 bg-yellow-50 p-2 text-[11px] leading-relaxed text-neutral-700">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-yellow-700" />
                        <span>Será criada uma pendência para enviar o contrato assinado e atualizado após finalizar.</span>
                      </div>
                    )}
                  </div>
                }
              />

              <UploadCard
                icon={<IdCard size={18} />}
                title="Documento com Foto"
                description="Envie CNH ou RG do inquilino em PDF, JPG, PNG ou WEBP."
                file={docInquilino}
                existingFileName={findExistingDoc("documento_foto", "documento_inquilino")?.file_name}
                error={errors.docInquilino}
                onPick={(files) => { pickFile(files, setDocInquilino); setErrors(p => ({ ...p, docInquilino: false })); }}
                onClear={() => setDocInquilino(null)}
                extraHeader={
                  <div className="space-y-1.5">
                    <Label className="text-xs">Tipo de documento *</Label>
                    <Select value={docInquilinoSubtype} onValueChange={(v) => { setDocInquilinoSubtype(v as "cnh" | "rg"); setErrors(p => ({ ...p, docInquilinoSubtype: false })); }}>
                      <SelectTrigger data-error={errors.docInquilinoSubtype || undefined} className={`h-9 ${err("docInquilinoSubtype")}`}><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cnh">CNH</SelectItem>
                        <SelectItem value="rg">RG / Identidade</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                }
              />

              <UploadCard
                icon={<Receipt size={18} />}
                title="Comprovante de Residência"
                description="Envie um comprovante de residência. Pode ser de um imóvel antigo."
                file={docResidencia}
                existingFileName={findExistingDoc("comprovante_residencia", "comprovante_residencia_imovel")?.file_name}
                error={errors.docResidencia}
                onPick={(files) => { pickFile(files, setDocResidencia); setErrors(p => ({ ...p, docResidencia: false })); }}
                onClear={() => setDocResidencia(null)}
              />

              <UploadCard
                icon={<Receipt size={18} />}
                title="Comprovante de Renda"
                description="Envie o comprovante de renda do inquilino em PDF, JPG, PNG ou WEBP."
                file={docRenda}
                existingFileName={findExistingDoc("comprovante_renda")?.file_name}
                error={errors.docRenda}
                onPick={(files) => { pickFile(files, setDocRenda); setErrors(p => ({ ...p, docRenda: false })); }}
                onClear={() => setDocRenda(null)}
              />
            </div>
          </section>

          {formError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700" data-error="true">
              {formError}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 justify-between sticky bottom-0 bg-gradient-to-t from-white via-white to-transparent pt-4 pb-2">
            <Button variant="outline" onClick={() => navigate({ to: "/consultas/$id/resultado", params: { id } })}>Voltar</Button>
            <Button onClick={handleSalvar} disabled={saving} className="bg-neutral-900 hover:bg-neutral-800 text-white px-8">
              {saving ? "Salvando..." : "Próximo"}
            </Button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function UploadCard({
  icon,
  title,
  description,
  file,
  existingFileName,
  onPick,
  onClear,
  extraHeader,
  footer,
  error,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  file: File | null;
  existingFileName?: string | null;
  onPick: (files: FileList | null) => void;
  onClear: () => void;
  extraHeader?: React.ReactNode;
  footer?: React.ReactNode;
  error?: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputId = `upload-${title.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <div data-error={error || undefined} className={`bg-white rounded-xl border p-4 min-h-[280px] flex flex-col gap-3 ${error ? "border-red-500 ring-1 ring-red-500" : "border-neutral-200"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-neutral-100 flex items-center justify-center text-neutral-700">{icon}</span>
          <h3 className="font-black text-sm text-neutral-900">{title}</h3>
        </div>
        {file || existingFileName ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
            <CheckCircle2 size={14} /> Enviado
          </span>
        ) : (
          <span className="text-[11px] font-medium text-neutral-400">Pendente</span>
        )}
      </div>

      <p className="text-xs text-neutral-500 leading-relaxed">{description}</p>

      {extraHeader}

      <label
        htmlFor={inputId}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          onPick(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center gap-1 border-2 border-dashed rounded-lg p-4 cursor-pointer transition-colors ${
          dragOver ? "border-yellow-400 bg-yellow-50" : file || existingFileName ? "border-emerald-200 bg-emerald-50/40" : "border-neutral-200 hover:border-yellow-400"
        }`}
      >
        <input
          id={inputId}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp"
          className="hidden"
          onChange={(e) => onPick(e.target.files)}
        />
        <Upload size={20} className="text-neutral-400" />
        <p className="text-xs font-medium text-neutral-700">
          {file || existingFileName ? "Substituir arquivo" : "Clique ou arraste o arquivo"}
        </p>
        <p className="text-[10px] text-neutral-400">PDF, JPG, PNG ou WEBP · até 10MB</p>
      </label>

      {(file || existingFileName) && (
        <div className="flex items-center justify-between text-xs p-2 rounded-lg bg-neutral-50 border border-neutral-100">
          <span className="truncate text-neutral-700 mr-2">{file?.name ?? existingFileName}</span>
          {file && (
            <button type="button" onClick={onClear} className="text-neutral-400 hover:text-red-500 shrink-0">
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {footer}
    </div>
  );
}
