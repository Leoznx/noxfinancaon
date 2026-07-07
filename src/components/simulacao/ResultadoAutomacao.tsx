import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  X,
  XCircle,
  Clock,
  AlertTriangle,
  Settings,
  UserRound,
  Building2,
  MapPin,
  Plus,
  List,
  RotateCcw,
  Upload,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { STATUS_FINAIS, formatDocumento, isNomeValido, type ConsultaCredito, type StatusConsulta } from "@/lib/consultasCredito";
import { SeletorPlanos, type ExtrasSelecionados, type PlanoSelecionadoCalculo } from "@/components/simulacao/SeletorPlanos";

const STATUS_UI: Record<
  string,
  { label: string; className: string; iconClassName: string; Icon: typeof CheckCircle2 }
> = {
  aprovado: {
    label: "Aprovado",
    className: "bg-green-50 border-green-200 text-green-800",
    iconClassName: "text-green-500",
    Icon: CheckCircle2,
  },
  recusado: {
    label: "Recusado",
    className: "bg-red-50 border-red-200 text-red-800",
    iconClassName: "text-red-500",
    Icon: XCircle,
  },
  em_analise: {
    label: "Em análise",
    className: "bg-yellow-50 border-yellow-200 text-yellow-800",
    iconClassName: "text-yellow-600",
    Icon: Clock,
  },
  erro: {
    label: "Erro na consulta",
    className: "bg-red-50 border-red-200 text-red-800",
    iconClassName: "text-red-500",
    Icon: AlertTriangle,
  },
};

function formatarMoeda(v: number | null): string {
  if (v === null || v === undefined) return "—";
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

interface ResultadoAutomacaoProps {
  consulta: ConsultaCredito;
  onTentarNovamente?: () => void;
  onSelecionarPlano?: (planoId: string, extras?: ExtrasSelecionados, planoCalculado?: PlanoSelecionadoCalculo) => void;
  isSubmittingPlano?: boolean;
  /** Permite editar aluguel/condomínio/taxas antes de escolher o plano (opcional — só passe se a consulta tiver um imóvel vinculado que possa ser atualizado). */
  onAtualizarValores?: (valores: { aluguel: number; condominio: number; taxas: number }) => Promise<void> | void;
  /** Retoma um plano já escolhido anteriormente (ex.: corretor volta em "Detalhes" depois de já ter selecionado um plano). */
  planoIdInicial?: string | null;
  extrasIniciais?: Partial<ExtrasSelecionados> | null;
}

export function ResultadoAutomacao({
  consulta,
  onTentarNovamente,
  onSelecionarPlano,
  isSubmittingPlano,
  onAtualizarValores,
  planoIdInicial,
  extrasIniciais,
}: ResultadoAutomacaoProps) {
  const navigate = useNavigate();
  const status = consulta.status as StatusConsulta;
  const emAndamento = !STATUS_FINAIS.includes(status);
  const ui = STATUS_UI[status];
  const statusNormalizado = String(status ?? "").toLowerCase();
  const isRecusado = statusNormalizado.includes("recusado") || statusNormalizado.includes("reprovado");
  const isEmAnalise =
    statusNormalizado.includes("em_analise") ||
    statusNormalizado.includes("em análise") ||
    statusNormalizado.includes("em analise") ||
    statusNormalizado.includes("análise") ||
    statusNormalizado.includes("analise") ||
    statusNormalizado.includes("pendente_documentacao") ||
    (statusNormalizado === "pendente" && !!consulta.automation_finished_at);

  if (status === "aprovado") {
    return (
      <div className="space-y-6">
        <button
          onClick={() => navigate({ to: "/consultas" })}
          className="inline-flex items-center gap-2 text-[10px] font-bold text-neutral-400 uppercase tracking-widest hover:text-neutral-900 transition-colors"
        >
          <ArrowLeft size={12} /> Voltar para os dados
        </button>

        <div className="rounded-[18px] border border-green-400 bg-green-50 overflow-hidden">
          <div className="flex flex-col sm:flex-row items-stretch justify-between">
            <div className="flex flex-col justify-center px-6 py-4 sm:px-7 sm:py-5 sm:max-w-[46%] text-center sm:text-left items-center sm:items-start">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-full bg-green-600 text-white shadow-lg shadow-green-200 ring-4 ring-green-100 shrink-0">
                  <Check className="h-6 w-6" strokeWidth={3.2} />
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-bold text-green-800 leading-tight tracking-tight">
                    Aprovado
                  </h1>
                  <p className="text-green-700 text-sm sm:text-base leading-tight">
                    {consulta.mensagem || "Crédito aprovado."}
                  </p>
                </div>
              </div>

              {consulta.valor_aluguel != null && (
                <strong className="text-xl sm:text-2xl font-bold text-green-900 mt-3">
                  {formatarMoeda(consulta.valor_aluguel)}
                </strong>
              )}

              <div className="h-px bg-green-300/70 my-3 w-full" />

              <div className="text-green-900 text-sm leading-relaxed">
                {isNomeValido(consulta.tenant_name) && (
                  <p>
                    Cliente: <strong className="font-bold">{consulta.tenant_name}</strong>
                  </p>
                )}
                {consulta.documento && (
                  <p>
                    {consulta.tipo_pessoa === "PJ" ? "CNPJ" : "CPF"}:{" "}
                    <strong className="font-bold">{formatDocumento(consulta.documento)}</strong>
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-1 items-end justify-center sm:justify-end overflow-hidden order-first sm:order-last sm:pr-6">
              <img
                src="/assets/nox-aprovado-personagens.webp"
                alt="Personagens comemorando aprovação da simulação"
                className="block h-[285px] sm:h-[335px] w-auto self-end object-contain object-bottom translate-y-[22px] pointer-events-none select-none"
              />
            </div>
          </div>
        </div>

        {onSelecionarPlano && (
          <div className="pt-2">
            <SeletorPlanos
              dados={{
                aluguel: Number(consulta.valor_aluguel) || 0,
                condominio: Number(consulta.valor_condominio) || 0,
                taxas: Number(consulta.valor_taxas) || 0,
                nomeInquilino: isNomeValido(consulta.tenant_name) ? consulta.tenant_name! : "Cliente",
                documento: consulta.documento ? formatDocumento(consulta.documento) : undefined,
                status: consulta.status,
              }}
              onVoltar={() => navigate({ to: "/consultas" })}
              onSelecionarPlano={onSelecionarPlano}
              onAtualizarValores={onAtualizarValores}
              isSubmitting={isSubmittingPlano}
              planoIdInicial={planoIdInicial}
              extrasIniciais={extrasIniciais}
              ocultarVoltar
              ocultarStatusAnalise
            />
          </div>
        )}
      </div>
    );
  }

  if (isRecusado) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => navigate({ to: "/consultas" })}
          className="inline-flex items-center gap-2 text-[10px] font-bold text-neutral-400 uppercase tracking-widest hover:text-neutral-900 transition-colors"
        >
          <ArrowLeft size={12} /> Voltar para os dados
        </button>

        <div className="rounded-[18px] border border-red-400 bg-red-50 overflow-hidden">
          <div className="flex flex-col sm:flex-row items-stretch justify-between">
            <div className="flex flex-col justify-center px-6 py-4 sm:px-7 sm:py-5 sm:max-w-[46%] text-center sm:text-left items-center sm:items-start">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-full bg-red-600 text-white shadow-lg shadow-red-200 ring-4 ring-red-100 shrink-0">
                  <X className="h-6 w-6" strokeWidth={3.2} />
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-bold text-red-800 leading-tight tracking-tight">
                    Recusado
                  </h1>
                  <p className="text-red-700 text-sm sm:text-base leading-tight">
                    {consulta.mensagem || "Crédito recusado."}
                  </p>
                </div>
              </div>

              {consulta.valor_aluguel != null && (
                <strong className="text-xl sm:text-2xl font-bold text-red-900 mt-3">
                  {formatarMoeda(consulta.valor_aluguel)}
                </strong>
              )}

              <div className="h-px bg-red-300/70 my-3 w-full" />

              <div className="text-red-950 text-sm leading-relaxed">
                {isNomeValido(consulta.tenant_name) && (
                  <p>
                    Cliente: <strong className="font-bold">{consulta.tenant_name}</strong>
                  </p>
                )}
                {consulta.documento && (
                  <p>
                    {consulta.tipo_pessoa === "PJ" ? "CNPJ" : "CPF"}:{" "}
                    <strong className="font-bold">{formatDocumento(consulta.documento)}</strong>
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-1 items-end justify-center sm:justify-end overflow-hidden order-first sm:order-last sm:pr-6">
              <img
                src="/assets/nox-recusado-personagens.webp"
                alt="Personagens tristes com simulação recusada"
                className="block h-[275px] sm:h-[325px] w-auto self-end object-contain object-bottom translate-y-[18px] pointer-events-none select-none"
              />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-red-200 bg-white px-6 py-5 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-neutral-950">
              <AlertTriangle className="h-5 w-5" strokeWidth={2.6} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-red-900">Tente novamente com outro CPF</h3>
              <p className="mt-1 text-sm leading-relaxed text-red-800">
                Você pode revisar os dados informados ou tentar uma nova simulação com outro CPF.
              </p>
            </div>
          </div>
        </div>

        <Button
          asChild
          className="h-16 w-full rounded-2xl bg-yellow-400 px-8 text-lg font-bold text-neutral-950 shadow-sm transition hover:bg-yellow-500"
        >
          <Link to="/consultas/nova">
            <Plus className="mr-2 h-6 w-6" /> Nova Consulta
          </Link>
        </Button>
      </div>
    );
  }

  if (isEmAnalise) {
    const jaEnviadoParaAprovacao = consulta.substatus === "documentacao_complementar_enviada";
    return (
      <div className="space-y-6">
        {!jaEnviadoParaAprovacao && (
          <>
            <button
              onClick={() => navigate({ to: "/consultas" })}
              className="inline-flex items-center gap-2 text-[10px] font-bold text-neutral-400 uppercase tracking-widest hover:text-neutral-900 transition-colors"
            >
              <ArrowLeft size={12} /> Voltar para os dados
            </button>

            <div className="rounded-[18px] border border-amber-400 bg-amber-50 overflow-hidden">
              <div className="flex flex-col sm:flex-row items-stretch justify-between">
                <div className="flex flex-col justify-center px-6 py-4 sm:px-7 sm:py-5 sm:max-w-[46%] text-center sm:text-left items-center sm:items-start">
                  <div className="flex items-center gap-3">
                    <div className="grid h-11 w-11 place-items-center rounded-full bg-amber-500 text-white shadow-lg shadow-amber-200 ring-4 ring-amber-100 shrink-0">
                      <Clock className="h-6 w-6" strokeWidth={3} />
                    </div>
                    <div>
                      <h1 className="text-2xl sm:text-3xl font-bold text-amber-900 leading-tight tracking-tight">
                        Em Análise
                      </h1>
                      <p className="text-amber-800 text-sm sm:text-base leading-tight">
                        Sua simulação está em análise.
                      </p>
                    </div>
                  </div>

                  {consulta.valor_aluguel != null && (
                    <strong className="text-xl sm:text-2xl font-bold text-amber-950 mt-3">
                      {formatarMoeda(consulta.valor_aluguel)}
                    </strong>
                  )}

                  <div className="h-px bg-amber-300/70 my-3 w-full" />

                  <div className="text-amber-950 text-sm leading-relaxed">
                    {isNomeValido(consulta.tenant_name) && (
                      <p>
                        Cliente: <strong className="font-bold">{consulta.tenant_name}</strong>
                      </p>
                    )}
                    {consulta.documento && (
                      <p>
                        {consulta.tipo_pessoa === "PJ" ? "CNPJ" : "CPF"}:{" "}
                        <strong className="font-bold">{formatDocumento(consulta.documento)}</strong>
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-1 items-end justify-center sm:justify-end overflow-hidden order-first sm:order-last sm:pr-6">
                  <img
                    src="/assets/nox-em-analise-personagens.webp"
                    alt="Personagens analisando a simulação"
                    className="block h-[275px] sm:h-[325px] w-auto self-end object-contain object-bottom translate-y-[18px] pointer-events-none select-none"
                  />
                </div>
              </div>
            </div>
          </>
        )}

        <FormularioAnaliseComplementar consulta={consulta} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {emAndamento ? (
        <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-10 flex flex-col items-center text-center gap-4">
          <Settings
            className="w-14 h-14 text-yellow-500 animate-spin"
            strokeWidth={1.5}
            style={{ animationDuration: "2.5s" }}
          />
          <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">Consultando...</h1>
          <p className="text-neutral-600 max-w-lg">
            A simulação ainda está em andamento. Esta página atualiza automaticamente quando o
            resultado chegar.
          </p>
        </div>
      ) : (
        ui && (
          <div className={`rounded-2xl border p-10 flex flex-col items-center text-center gap-4 ${ui.className}`}>
            <ui.Icon className={`w-16 h-16 ${ui.iconClassName}`} strokeWidth={1.5} />
            <h1 className="text-4xl font-bold tracking-tight">{ui.label}</h1>
            {(consulta.mensagem || consulta.error_message) && (
              <p className="text-base max-w-xl leading-relaxed">
                {consulta.mensagem || consulta.error_message}
              </p>
            )}
            {consulta.automation_finished_at && (
              <p className="text-xs font-bold uppercase tracking-widest opacity-70">
                Consultado em {new Date(consulta.automation_finished_at).toLocaleString("pt-BR")}
              </p>
            )}
            {status === "erro" && onTentarNovamente && (
              <Button
                onClick={onTentarNovamente}
                className="bg-neutral-900 hover:bg-neutral-800 text-white font-bold h-12 rounded-xl px-6 mt-2"
              >
                <RotateCcw className="w-4 h-4 mr-2" /> Tentar novamente
              </Button>
            )}
          </div>
        )
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-neutral-200 rounded-2xl">
          <CardContent className="p-6">
            <h2 className="text-xs font-bold text-neutral-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              {consulta.tipo_pessoa === "PJ" ? (
                <Building2 className="w-4 h-4 text-yellow-600" />
              ) : (
                <UserRound className="w-4 h-4 text-yellow-600" />
              )}
              Inquilino
            </h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-neutral-500">Tipo</dt>
                <dd className="font-semibold text-neutral-900">
                  {consulta.tipo_pessoa === "PJ" ? "Pessoa Jurídica" : "Pessoa Física"}
                </dd>
              </div>
              {isNomeValido(consulta.tenant_name) && (
                <div className="flex justify-between gap-4">
                  <dt className="text-neutral-500">Nome</dt>
                  <dd className="font-semibold text-neutral-900">{consulta.tenant_name}</dd>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <dt className="text-neutral-500">{consulta.tipo_pessoa === "PJ" ? "CNPJ" : "CPF"}</dt>
                <dd className="font-semibold text-neutral-900">
                  {consulta.documento ? formatDocumento(consulta.documento) : consulta.documento_masked || "—"}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card className="border-neutral-200 rounded-2xl">
          <CardContent className="p-6">
            <h2 className="text-xs font-bold text-neutral-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-yellow-600" />
              Imóvel
            </h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-neutral-500">Tipo</dt>
                <dd className="font-semibold text-neutral-900">{consulta.tipo_imovel || "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-neutral-500">CEP</dt>
                <dd className="font-semibold text-neutral-900">{consulta.cep || "—"}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card className="border-neutral-200 rounded-2xl">
        <CardContent className="p-6">
          <h2 className="text-xs font-bold text-neutral-500 uppercase tracking-widest mb-4">Valores informados</h2>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xs text-neutral-500 uppercase font-bold tracking-wider mb-1">Aluguel</p>
              <p className="text-lg font-bold text-neutral-900">{formatarMoeda(consulta.valor_aluguel)}</p>
            </div>
            <div>
              <p className="text-xs text-neutral-500 uppercase font-bold tracking-wider mb-1">Condomínio</p>
              <p className="text-lg font-bold text-neutral-900">{formatarMoeda(consulta.valor_condominio)}</p>
            </div>
            <div>
              <p className="text-xs text-neutral-500 uppercase font-bold tracking-wider mb-1">Taxas</p>
              <p className="text-lg font-bold text-neutral-900">{formatarMoeda(consulta.valor_taxas)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="text-xs text-neutral-400 text-center">
        Consulta criada em {new Date(consulta.created_at).toLocaleString("pt-BR")}
        {consulta.origem ? ` · origem: ${consulta.origem}` : ""}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Button
          asChild
          className="flex-1 bg-neutral-900 hover:bg-neutral-800 text-white font-bold h-14 rounded-xl text-base"
        >
          <Link to="/consultas/nova">
            <Plus className="w-5 h-5 mr-2" /> Nova Consulta
          </Link>
        </Button>
        <Button asChild variant="outline" className="flex-1 font-bold h-14 rounded-xl text-base text-neutral-700">
          <Link to="/consultas">
            <List className="w-5 h-5 mr-2" /> Ver minhas consultas
          </Link>
        </Button>
      </div>
    </div>
  );
}

const ESTADOS_CIVIS = ["Solteiro(a)", "Casado(a)", "Divorciado(a)", "Viúvo(a)", "União Estável"];
const ACCEPTED_UPLOAD_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
const APPROVAL_BUCKET = "approval-documents";

function maskTelefone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 10) {
    return digits.replace(/(\d{2})(\d{4})(\d{0,4})/, "($1) $2-$3").replace(/[-\s]+$/, "");
  }
  return digits.replace(/(\d{2})(\d{5})(\d{0,4})/, "($1) $2-$3").replace(/[-\s]+$/, "");
}

function validarArquivo(file: File): string | null {
  if (!ACCEPTED_UPLOAD_TYPES.includes(file.type)) return "Use PDF, JPG, PNG ou WEBP.";
  if (file.size > MAX_UPLOAD_SIZE) return "Arquivo acima de 10MB.";
  return null;
}

function safeFileName(name: string): string {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function FormularioAnaliseComplementar({ consulta }: { consulta: ConsultaCredito }) {
  const [cnhFile, setCnhFile] = useState<File | null>(null);
  const [rendaFile, setRendaFile] = useState<File | null>(null);
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [estadoCivil, setEstadoCivil] = useState("");
  const [saving, setSaving] = useState(false);
  const [existingDocs, setExistingDocs] = useState<any[]>([]);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [submittedForApproval, setSubmittedForApproval] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const [{ data: consultaAtual }, { data: docs }] = await Promise.all([
        supabase
          .from("consultas_credito")
          .select("tenant_email, tenant_telefone, documentos, dados_complementares_em")
          .eq("id", consulta.id)
          .maybeSingle(),
        supabase
          .from("documentos_proposta")
          .select("id, file_name, document_type")
          .eq("consulta_id", consulta.id)
          .in("document_type", ["cnh_analise", "comprovante_renda_analise"]),
      ]);
      if (!active) return;
      setEmail((consultaAtual as any)?.tenant_email ?? "");
      setTelefone(maskTelefone((consultaAtual as any)?.tenant_telefone ?? ""));
      setEstadoCivil((consultaAtual as any)?.documentos?.analise_complementar?.estado_civil ?? "");
      setSubmittedAt((consultaAtual as any)?.dados_complementares_em ?? null);
      setExistingDocs(docs ?? []);
    })();
    return () => {
      active = false;
    };
  }, [consulta.id]);

  const hasCnh = existingDocs.some((doc) => doc.document_type === "cnh_analise");
  const hasRenda = existingDocs.some((doc) => doc.document_type === "comprovante_renda_analise");
  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const telefoneValido = telefone.replace(/\D/g, "").length >= 10;
  const formValido = useMemo(
    () => (cnhFile || hasCnh) && (rendaFile || hasRenda) && emailValido && telefoneValido && !!estadoCivil,
    [cnhFile, hasCnh, rendaFile, hasRenda, emailValido, telefoneValido, estadoCivil],
  );

  function pickFile(file: File | undefined, setter: (file: File | null) => void) {
    if (!file) return;
    const error = validarArquivo(file);
    if (error) {
      toast.error(error);
      return;
    }
    setter(file);
  }

  async function uploadDocumento(file: File, documentType: string, uploaderId: string) {
    const path = `${uploaderId}/${consulta.id}/${documentType}-${Date.now()}-${safeFileName(file.name)}`;

    const { error: uploadError } = await supabase.storage.from(APPROVAL_BUCKET).upload(path, file, {
      cacheControl: "3600",
      upsert: true,
      contentType: file.type,
    });

    if (uploadError) {
      console.error("Erro detalhado no upload:", uploadError);
      throw new Error(`Não foi possível enviar ${file.name}: ${uploadError.message}`);
    }

    const { error: insertError } = await supabase.from("documentos_proposta").insert({
      consulta_id: consulta.id,
      file_name: file.name,
      file_url: path,
      file_type: file.type,
      document_type: documentType,
      document_subtype: APPROVAL_BUCKET,
      uploaded_by: uploaderId,
    } as any);
    if (insertError) throw insertError;
    return { path, bucket: APPROVAL_BUCKET };
  }

  async function handleEnviar() {
    if (!formValido) {
      toast.error("Preencha todos os campos obrigatórios antes de enviar.");
      return;
    }

    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uploaderId = userData.user?.id;
      if (!uploaderId) throw new Error("Usuário não autenticado");

      const uploaded: Record<string, { path: string; bucket: string } | null> = {};
      if (cnhFile) uploaded.cnh = await uploadDocumento(cnhFile, "cnh_analise", uploaderId);
      if (rendaFile) uploaded.comprovante_renda = await uploadDocumento(rendaFile, "comprovante_renda_analise", uploaderId);

      const { data: atual } = await supabase
        .from("consultas_credito")
        .select("documentos")
        .eq("id", consulta.id)
        .maybeSingle();
      const documentosAtuais = ((atual as any)?.documentos && typeof (atual as any).documentos === "object")
        ? (atual as any).documentos
        : {};

      const enviadoEm = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("consultas_credito")
        .update({
          tenant_email: email.trim(),
          tenant_telefone: telefone.replace(/\D/g, ""),
          dados_complementares_em: enviadoEm,
          substatus: "documentacao_complementar_enviada",
          documentos: {
            ...documentosAtuais,
            analise_complementar: {
              ...(documentosAtuais as any).analise_complementar,
              cnh_path: uploaded.cnh?.path ?? (documentosAtuais as any).analise_complementar?.cnh_path ?? null,
              cnh_bucket: uploaded.cnh?.bucket ?? (documentosAtuais as any).analise_complementar?.cnh_bucket ?? APPROVAL_BUCKET,
              comprovante_renda_path:
                uploaded.comprovante_renda?.path ?? (documentosAtuais as any).analise_complementar?.comprovante_renda_path ?? null,
              comprovante_renda_bucket:
                uploaded.comprovante_renda?.bucket ??
                (documentosAtuais as any).analise_complementar?.comprovante_renda_bucket ??
                APPROVAL_BUCKET,
              email: email.trim(),
              telefone: telefone.replace(/\D/g, ""),
              estado_civil: estadoCivil,
              enviado_em: enviadoEm,
              uploaded_by: uploaderId,
              origem: "resultado_em_analise",
            },
          },
        } as any)
        .eq("id", consulta.id);
      if (updateError) throw updateError;

      setSubmittedAt(enviadoEm);
      setSubmittedForApproval(true);
      setCnhFile(null);
      setRendaFile(null);
      const { data: docs } = await supabase
        .from("documentos_proposta")
        .select("id, file_name, document_type")
        .eq("consulta_id", consulta.id)
        .in("document_type", ["cnh_analise", "comprovante_renda_analise"]);
      setExistingDocs(docs ?? []);
      toast.success("Documentação enviada para aprovação.");
    } catch (error: any) {
      toast.error("Erro ao enviar para aprovação: " + (error?.message || "desconhecido"));
    } finally {
      setSaving(false);
    }
  }

  const jaEnviado = submittedForApproval || consulta.substatus === "documentacao_complementar_enviada";

  if (jaEnviado) {
    return (
      <div className="rounded-[22px] border border-yellow-300 bg-yellow-50 overflow-hidden shadow-sm">
        <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div className="max-w-2xl">
            <div className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-green-600 text-white shadow-lg shadow-green-100">
              <Check className="h-6 w-6" strokeWidth={3} />
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-950">
              Obrigado por compartilhar os dados.
            </h2>
            <p className="mt-3 text-base leading-relaxed text-neutral-700">
              Retornaremos em até 2 horas de análise dentro do horário comercial.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600">
              Fique de olho no seu e-mail ou acompanhe o andamento aqui no painel em Minhas Consultas.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Button asChild variant="outline" className="h-12 rounded-xl px-6 font-bold text-neutral-700">
                <Link to="/consultas">
                  <List className="mr-2 h-5 w-5" /> Minhas Consultas
                </Link>
              </Button>
            </div>
          </div>

          <div className="flex justify-center sm:justify-end">
            <img
              src="/assets/nox-obrigado-analise.webp"
              alt="Dados enviados para análise"
              className="block h-[240px] sm:h-[300px] w-auto object-contain object-bottom"
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700">
          <FileText className="h-5 w-5" strokeWidth={2.4} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-neutral-950">Formulário complementar</h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-neutral-600">
            Sua simulação ficou em análise. Para continuar com a avaliação, envie os documentos e dados abaixo para análise do Jurídico/Administrativo.
          </p>
          {submittedAt && (
            <p className="mt-2 text-xs font-bold uppercase tracking-wider text-emerald-700">
              Documentação enviada em {new Date(submittedAt).toLocaleString("pt-BR")}
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <UploadField
          label="CNH"
          file={cnhFile}
          existingFileName={existingDocs.find((doc) => doc.document_type === "cnh_analise")?.file_name}
          onChange={(file) => pickFile(file, setCnhFile)}
        />
        <UploadField
          label="Comprovante de renda"
          file={rendaFile}
          existingFileName={existingDocs.find((doc) => doc.document_type === "comprovante_renda_analise")?.file_name}
          onChange={(file) => pickFile(file, setRendaFile)}
        />
        <div>
          <Label>E-mail *</Label>
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="cliente@email.com"
            className="mt-1 h-12 rounded-xl"
          />
        </div>
        <div>
          <Label>Telefone *</Label>
          <Input
            type="tel"
            value={telefone}
            onChange={(event) => setTelefone(maskTelefone(event.target.value))}
            placeholder="(00) 00000-0000"
            className="mt-1 h-12 rounded-xl"
          />
        </div>
        <div className="sm:col-span-2">
          <Label>Estado civil *</Label>
          <Select value={estadoCivil} onValueChange={setEstadoCivil}>
            <SelectTrigger className="mt-1 h-12 rounded-xl">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {ESTADOS_CIVIS.map((estado) => (
                <SelectItem key={estado} value={estado}>
                  {estado}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button
        type="button"
        disabled={!formValido || saving}
        onClick={handleEnviar}
        className="mt-6 h-16 w-full rounded-2xl bg-yellow-400 px-8 text-lg font-bold text-neutral-950 shadow-sm transition hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Enviando..." : "Enviar para Aprovação"}
      </Button>
    </div>
  );
}

function UploadField({
  label,
  file,
  existingFileName,
  onChange,
}: {
  label: string;
  file: File | null;
  existingFileName?: string;
  onChange: (file: File | undefined) => void;
}) {
  return (
    <div>
      <Label>{label} *</Label>
      <label className="mt-1 flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm transition hover:border-amber-300 hover:bg-amber-50">
        <span className="min-w-0 truncate text-neutral-700">
          {file?.name || existingFileName || "Enviar foto ou PDF"}
        </span>
        <Upload className="h-5 w-5 shrink-0 text-neutral-500" />
        <input
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(event) => onChange(event.target.files?.[0])}
        />
      </label>
      <p className="mt-1 text-xs text-neutral-400">PDF, JPG, PNG ou WEBP até 10MB.</p>
    </div>
  );
}
