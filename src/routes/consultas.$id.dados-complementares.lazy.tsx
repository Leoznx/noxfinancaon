import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useEssentialLoading } from "@/components/GlobalLoading";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { supabase } from "@/integrations/supabase/client";
import { ensureTenantUser } from "@/lib/proposta.functions";
import { DEMO_COMPLEMENTARY_DATA } from "@/lib/demo-accounts";
import { isDemoSession } from "@/lib/demo-session";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, X, FileText, ClipboardCheck, IdCard, Receipt, CheckCircle2, AlertTriangle, ArrowLeft, ArrowRight } from "lucide-react";

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
  useEssentialLoading(loading || !consulta);
  const [demoMode, setDemoMode] = useState(false);
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

  // Documentos da contratação. Contrato e vistoria podem ficar pendentes para envio posterior.
  const [docVistoria, setDocVistoria] = useState<File | null>(null);
  const [docContrato, setDocContrato] = useState<File | null>(null);
  const [vistoriaPronta, setVistoriaPronta] = useState<"sim" | "nao" | "">("");
  const [contratoPronto, setContratoPronto] = useState<"sim" | "nao" | "">("");
  const [docInquilino, setDocInquilino] = useState<File | null>(null);
  const [docInquilinoSubtype, setDocInquilinoSubtype] = useState<"cnh" | "rg" | "">("");
  const [docResidencia, setDocResidencia] = useState<File | null>(null);

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
        const isDemo = isDemoSession() && (
          (data as any).origem === "demo" || (data as any).raw_response?.demo === true
        );
        setDemoMode(isDemo);

        if (isDemo) {
          const demo = DEMO_COMPLEMENTARY_DATA;
          setNome(demo.inquilino.nome);
          setCpf(maskCPF(i.cpf ?? (data as any).tenant_document ?? ""));
          setEmail(demo.inquilino.email);
          setTelefone(demo.inquilino.telefone);
          setNascimento(demo.inquilino.nascimentoISO);
          setCep(demo.imovel.cep);
          setEndereco(demo.imovel.endereco);
          setBairro(demo.imovel.bairro);
          setCidade(demo.imovel.cidade);
          setEstado(demo.imovel.estado);
          setNumero(demo.imovel.numero);
          setComplemento(demo.imovel.complemento);
          setSubtipo(demo.imovel.subtipo);
          setVistoriaPronta("sim");
          setContratoPronto(demo.contratoAssinado);
          setDocInquilinoSubtype(demo.documentoFoto);
        } else {
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
        }

        const { data: docs } = await supabase
          .from("documentos_proposta")
          .select("id, file_name, document_type, document_subtype")
          .eq("consulta_id", id);
        setExistingDocs(docs ?? []);
        const docContratoExistente = (docs ?? []).find((doc: any) => doc.document_type === "contrato_locacao");
        const docVistoriaExistente = (docs ?? []).find((doc: any) => doc.document_type === "vistoria_imovel");
        const docInq = (docs ?? []).find((doc: any) => doc.document_type === "documento_foto" || doc.document_type === "documento_inquilino");
        if (!isDemo) {
          const dadosComplementares = ((data as any).documentos?.dados_complementares ?? {}) as Record<string, unknown>;
          if (docInq?.document_subtype) setDocInquilinoSubtype(docInq.document_subtype as "cnh" | "rg");
          if (docVistoriaExistente) setVistoriaPronta("sim");
          else if (dadosComplementares.vistoria_imovel_pendencia) setVistoriaPronta("nao");
          if (docContratoExistente) {
            setContratoPronto(docContratoExistente.document_subtype === "pendente_assinatura" ? "nao" : "sim");
          } else if (dadosComplementares.contrato_locacao_pendencia) {
            setContratoPronto("nao");
          }
        }
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
    if (!demoMode) {
      if (!vistoriaPronta) e.vistoriaPronta = true;
      if (vistoriaPronta === "sim" && !docVistoria && !hasExistingDoc("vistoria_imovel")) e.docVistoria = true;
      if (!contratoPronto) e.contratoPronto = true;
      if (contratoPronto === "sim" && !docContrato && !hasExistingDoc("contrato_locacao")) e.docContrato = true;
      if (!docInquilinoSubtype) e.docInquilinoSubtype = true;
      if (!docInquilino && !hasExistingDoc("documento_foto", "documento_inquilino")) e.docInquilino = true;
      if (!docResidencia && !hasExistingDoc("comprovante_residencia", "comprovante_residencia_imovel")) e.docResidencia = true;
    }

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
        docVistoria: "Vistoria do imóvel",
        docContrato: "Contrato de locação",
        vistoriaPronta: "Situação da vistoria do imóvel",
        contratoPronto: "Situação do contrato de locação",
        docInquilinoSubtype: "Tipo do documento com foto",
        docInquilino: "Documento com foto",
        docResidencia: "Comprovante de residência",
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
      const previousDocumentos = ((consulta as any)?.documentos && typeof (consulta as any).documentos === "object")
        ? (consulta as any).documentos
        : {};
      const contratoPendente = contratoPronto === "nao";
      const vistoriaPendente = vistoriaPronta === "nao";
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
          dados_complementares_em: new Date().toISOString(),
          documentos: {
            ...previousDocumentos,
            dados_complementares: {
              ...(previousDocumentos as any).dados_complementares,
              contrato_locacao_pronto: contratoPronto === "sim",
              contrato_locacao_assinado: contratoPronto === "sim",
              contrato_locacao_pendencia: contratoPendente
                ? "Anexar o contrato de locação quando estiver pronto."
                : null,
              vistoria_imovel_pronta: vistoriaPronta === "sim",
              vistoria_imovel_pendencia: vistoriaPendente
                ? "Anexar a vistoria do imóvel quando estiver pronta."
                : null,
              demonstracao: demoMode,
              documentos_liberados_automaticamente: demoMode,
              documentos_obrigatorios: demoMode
                ? []
                : [
                    ...(vistoriaPendente ? [] : ["vistoria_imovel"]),
                    ...(contratoPendente ? [] : ["contrato_locacao"]),
                    "comprovante_residencia",
                    "documento_foto",
                  ],
            },
          },
        } as any)
        .eq("id", id);
      if (updErr) throw updErr;

      // 3. Upload dos documentos já disponíveis; pendências ficam para a área de Documentos.
      const { data: { user } } = await supabase.auth.getUser();
      const uploaderId = user?.id;
      if (!uploaderId) throw new Error("Usuário não autenticado");

      const docs: Array<{ file: File; type: string; subtype: string | null }> = [
        docVistoria ? { file: docVistoria, type: "vistoria_imovel", subtype: null } : null,
        docContrato && contratoPronto === "sim" ? { file: docContrato, type: "contrato_locacao", subtype: "assinado_todas_partes" } : null,
        docResidencia ? { file: docResidencia, type: "comprovante_residencia", subtype: "pode_ser_imovel_antigo" } : null,
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
      <div className="flex-1 flex flex-col px-4 sm:px-6 py-6 pb-28">
        <div className="w-full max-w-4xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-neutral-900">Dados complementares</h1>
            <p className="text-sm text-neutral-500 mt-1">
              {demoMode
                ? "Os dados de teste já estão preenchidos para você avançar com a demonstração."
                : "Complete as informações para avançar com a proposta."}
            </p>
          </div>

          {demoMode && (
            <div className="flex gap-3 rounded-2xl border border-yellow-300 bg-yellow-50 p-4 text-sm text-neutral-700">
              <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-yellow-700" />
              <div>
                <p className="font-black text-neutral-900">Dados e documentos de demonstração liberados</p>
                <p className="mt-1 text-xs leading-relaxed">Você pode revisar os dados abaixo e clicar em Próximo sem anexar arquivos.</p>
              </div>
            </div>
          )}

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
            <h2 className="text-sm font-black uppercase tracking-widest text-neutral-700">Contato do inquilino</h2>
            <p className="text-xs text-neutral-500">Não é mais necessário fornecer o endereço do inquilino — usaremos o endereço do imóvel alugado.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><Label>Nome</Label><Input data-error={errors.nome || undefined} className={err("nome")} value={nome} onChange={(e) => { setNome(e.target.value); setErrors(p => ({ ...p, nome: false })); }} /></div>
              <div><Label>CPF</Label><Input data-error={errors.cpf || undefined} className={err("cpf")} value={cpf} onChange={(e) => { setCpf(maskCPF(e.target.value)); setErrors(p => ({ ...p, cpf: false })); }} placeholder="000.000.000-00" /></div>
              <div><Label>Data de nascimento</Label><Input type="date" value={nascimento} onChange={(e) => setNascimento(e.target.value)} /></div>
              <div><Label>E-mail *</Label><Input data-error={errors.email || undefined} className={err("email")} type="email" value={email} onChange={(e) => { setEmail(e.target.value); setErrors(p => ({ ...p, email: false })); }} /></div>
              <div className="sm:col-span-2"><Label>Telefone *</Label><Input data-error={errors.telefone || undefined} className={err("telefone")} value={telefone} onChange={(e) => { setTelefone(maskTel(e.target.value)); setErrors(p => ({ ...p, telefone: false })); }} placeholder="(00) 00000-0000" /></div>
            </div>
          </section>

          {/* Documentos */}
          {demoMode ? (
            <section className="rounded-2xl border border-yellow-200 bg-white p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <CheckCircle2 size={22} className="mt-0.5 shrink-0 text-yellow-600" />
                <div>
                  <h2 className="text-sm font-black uppercase tracking-widest text-neutral-700">Documentos de teste</h2>
                  <p className="mt-1 text-sm text-neutral-500">Vistoria, contrato, documento com foto e residência estão validados automaticamente nesta demonstração.</p>
                </div>
              </div>
            </section>
          ) : (
          <section className="bg-white rounded-2xl border border-neutral-100 p-5 sm:p-6 space-y-5">
            <div>
              <h2 className="text-sm font-black uppercase tracking-widest text-neutral-700">Documentos</h2>
              <p className="text-sm text-neutral-500 mt-1">Envie os documentos disponíveis. Contrato e vistoria podem ser anexados depois.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <UploadCard
                icon={<ClipboardCheck size={18} />}
                title="Vistoria do Imóvel"
                description="Se a vistoria já estiver pronta, envie em PDF, JPG, PNG ou WEBP."
                file={docVistoria}
                existingFileName={findExistingDoc("vistoria_imovel")?.file_name}
                error={errors.docVistoria || errors.vistoriaPronta}
                onPick={(files) => { pickFile(files, setDocVistoria); setErrors(p => ({ ...p, docVistoria: false })); }}
                onClear={() => setDocVistoria(null)}
                uploadDisabled={vistoriaPronta === "nao"}
                extraHeader={
                  <div data-error={errors.vistoriaPronta || undefined} className={`space-y-2 rounded-lg ${errors.vistoriaPronta ? "ring-1 ring-red-500 p-2" : ""}`}>
                    <Label className="text-xs">A vistoria do imóvel está pronta? *</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {(["sim", "nao"] as const).map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => {
                            setVistoriaPronta(value);
                            if (value === "nao") setDocVistoria(null);
                            setErrors(p => ({ ...p, vistoriaPronta: false, docVistoria: false }));
                          }}
                          className={`h-9 rounded-lg border text-xs font-bold transition-colors ${
                            vistoriaPronta === value
                              ? "border-yellow-400 bg-yellow-50 text-neutral-900"
                              : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"
                          }`}
                        >
                          {value === "sim" ? "Sim, está pronta" : "Não está pronta"}
                        </button>
                      ))}
                    </div>
                    {vistoriaPronta === "nao" && (
                      <div className="flex gap-2 rounded-lg border border-yellow-300 bg-yellow-50 p-2 text-[11px] leading-relaxed text-neutral-700">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-yellow-700" />
                        <span>Você pode concluir o seguro agora e anexar a vistoria depois em Documentos.</span>
                      </div>
                    )}
                  </div>
                }
              />

              <UploadCard
                icon={<FileText size={18} />}
                title="Contrato de Locação"
                description="Se o contrato já estiver pronto, envie em PDF, JPG, PNG ou WEBP."
                file={docContrato}
                existingFileName={findExistingDoc("contrato_locacao")?.file_name}
                error={errors.docContrato || errors.contratoPronto}
                onPick={(files) => { pickFile(files, setDocContrato); setErrors(p => ({ ...p, docContrato: false })); }}
                onClear={() => setDocContrato(null)}
                uploadDisabled={contratoPronto === "nao"}
                extraHeader={
                  <div data-error={errors.contratoPronto || undefined} className={`space-y-2 rounded-lg ${errors.contratoPronto ? "ring-1 ring-red-500 p-2" : ""}`}>
                    <Label className="text-xs">O contrato de locação está pronto? *</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {(["sim", "nao"] as const).map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => {
                            setContratoPronto(value);
                            if (value === "nao") setDocContrato(null);
                            setErrors(p => ({ ...p, contratoPronto: false, docContrato: false }));
                          }}
                          className={`h-9 rounded-lg border text-xs font-bold transition-colors ${
                            contratoPronto === value
                              ? "border-yellow-400 bg-yellow-50 text-neutral-900"
                              : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"
                          }`}
                        >
                          {value === "sim" ? "Sim, está pronto" : "Não está pronto"}
                        </button>
                      ))}
                    </div>
                    {contratoPronto === "nao" && (
                      <div className="flex gap-2 rounded-lg border border-yellow-300 bg-yellow-50 p-2 text-[11px] leading-relaxed text-neutral-700">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-yellow-700" />
                        <span>Você pode concluir o seguro agora e anexar o contrato depois em Documentos.</span>
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
            </div>
          </section>
          )}

          {formError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700" data-error="true">
              {formError}
            </div>
          )}

        </div>
      </div>
      <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: "/consultas/$id/resultado", params: { id } })}
            className="h-11 rounded-md border-slate-300 bg-white px-5 font-bold text-neutral-900 hover:bg-slate-50"
          >
            <ArrowLeft size={16} className="mr-2" /> Voltar
          </Button>
          <Button
            onClick={handleSalvar}
            disabled={saving}
            className="ml-auto h-11 rounded-md bg-neutral-900 px-8 font-bold text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Próximo"} <ArrowRight size={16} className="ml-2" />
          </Button>
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
  uploadDisabled = false,
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
  uploadDisabled?: boolean;
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
        onDragOver={(e) => { e.preventDefault(); if (!uploadDisabled) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!uploadDisabled) onPick(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center gap-1 border-2 border-dashed rounded-lg p-4 transition-colors ${uploadDisabled ? "cursor-not-allowed border-neutral-200 bg-neutral-100 opacity-60" : "cursor-pointer"} ${
          !uploadDisabled && dragOver ? "border-yellow-400 bg-yellow-50" : file || existingFileName ? "border-emerald-200 bg-emerald-50/40" : !uploadDisabled ? "border-neutral-200 hover:border-yellow-400" : ""
        }`}
      >
        <input
          id={inputId}
          type="file"
          disabled={uploadDisabled}
          accept=".pdf,.jpg,.jpeg,.png,.webp"
          className="hidden"
          onChange={(e) => onPick(e.target.files)}
        />
        <Upload size={20} className="text-neutral-400" />
        <p className="text-xs font-medium text-neutral-700">
          {uploadDisabled ? "Envio liberado depois em Documentos" : file || existingFileName ? "Substituir arquivo" : "Clique ou arraste o arquivo"}
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
