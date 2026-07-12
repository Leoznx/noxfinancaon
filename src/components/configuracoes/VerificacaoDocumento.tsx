import { useEffect, useRef, useState } from "react";
import {
  IdCard,
  Loader2,
  Upload,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Trash2,
  Camera,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type DocType = "cnh" | "rg";
type SlotKey = "frente" | "verso" | "selfie";

interface UsuarioDocumento {
  userId: string | null;
  profileId: string | null;
  email: string;
  role: string;
  isRealSession: boolean;
}

interface Verificacao {
  id: string;
  user_id: string;
  document_type: DocType;
  document_front_url: string | null;
  document_back_url: string | null;
  selfie_url: string | null;
  verification_status: "pendente" | "enviado" | "em_analise" | "aprovado" | "recusado";
  rejection_reason: string | null;
  submitted_at: string | null;
}

const STATUS_META: Record<
  Verificacao["verification_status"] | "nao_verificado",
  { label: string; sub: string; tone: string; icon: any }
> = {
  nao_verificado: {
    label: "Não verificado",
    sub: "Envie seus documentos para validar sua conta.",
    tone: "bg-neutral-100 text-neutral-700 border-neutral-200",
    icon: AlertCircle,
  },
  pendente: {
    label: "Pendente",
    sub: "Finalize o envio dos arquivos.",
    tone: "bg-neutral-100 text-neutral-700 border-neutral-200",
    icon: AlertCircle,
  },
  enviado: {
    label: "Enviado",
    sub: "Recebemos seus documentos.",
    tone: "bg-blue-50 text-blue-800 border-blue-200",
    icon: Clock,
  },
  em_analise: {
    label: "Em análise",
    sub: "Recebemos seus documentos. Aguarde a análise.",
    tone: "bg-amber-50 text-amber-800 border-amber-200",
    icon: Clock,
  },
  aprovado: {
    label: "Verificado",
    sub: "Sua conta foi verificada com sucesso.",
    tone: "bg-emerald-50 text-emerald-800 border-emerald-200",
    icon: CheckCircle2,
  },
  recusado: {
    label: "Recusado",
    sub: "Verifique o motivo e reenvie seus documentos.",
    tone: "bg-red-50 text-red-800 border-red-200",
    icon: XCircle,
  },
};

const ACCEPTED = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

export function VerificacaoDocumento({ usuario }: { usuario?: UsuarioDocumento }) {
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [modoLocal, setModoLocal] = useState(false);
  const [verif, setVerif] = useState<Verificacao | null>(null);
  const [docType, setDocType] = useState<DocType>("cnh");
  const [enviando, setEnviando] = useState<SlotKey | null>(null);
  const [finalizando, setFinalizando] = useState(false);

  // local preview URLs (signed URLs) for already-uploaded files
  const [signedUrls, setSignedUrls] = useState<Record<SlotKey, string | null>>({
    frente: null,
    verso: null,
    selfie: null,
  });

  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        const effectiveUserId = authUser?.id ?? usuario?.userId ?? null;
        const canUseSecureStorage = !!authUser && !!effectiveUserId;

        if (!canUseSecureStorage) {
          if (ativo) {
            setUserId(null);
            setModoLocal(!!usuario);
            setLoading(false);
          }
          return;
        }
        setModoLocal(false);
        if (ativo) setUserId(effectiveUserId);

        const { data, error } = await supabase
          .from("verificacoes_documento" as any)
          .select("*")
          .eq("user_id", effectiveUserId)
          .maybeSingle();
        if (error) throw error;
        if (!ativo) return;

        if (data) {
          const v = data as unknown as Verificacao;
          setVerif(v);
          setDocType(v.document_type);
          await refreshSigned(v);
        }
      } catch (e: any) {
        if (ativo) setErro(e?.message || "Erro ao carregar verificação.");
      } finally {
        if (ativo) setLoading(false);
      }
    })();
    return () => { ativo = false; };
  }, [usuario?.userId, usuario?.profileId, usuario?.isRealSession]);

  async function refreshSigned(v: Verificacao) {
    const paths: Array<[SlotKey, string | null]> = [
      ["frente", v.document_front_url],
      ["verso", v.document_back_url],
      ["selfie", v.selfie_url],
    ];
    const result: Record<SlotKey, string | null> = { frente: null, verso: null, selfie: null };
    for (const [key, path] of paths) {
      if (!path) continue;
      const { data } = await supabase.storage
        .from("documentos-verificacao")
        .createSignedUrl(path, 60 * 60);
      result[key] = data?.signedUrl ?? null;
    }
    setSignedUrls(result);
  }

  async function ensureVerifRow(): Promise<Verificacao> {
    if (verif) return verif;
    if (!userId) throw new Error("Usuário não autenticado.");
    const { data, error } = await supabase
      .from("verificacoes_documento" as any)
      .insert({
        user_id: userId,
        document_type: docType,
        verification_status: "pendente",
      } as any)
      .select("*")
      .single();
    if (error) throw error;
    const v = data as unknown as Verificacao;
    setVerif(v);
    return v;
  }

  function slotColumn(slot: SlotKey): keyof Verificacao {
    if (slot === "frente") return "document_front_url";
    if (slot === "verso") return "document_back_url";
    return "selfie_url";
  }

  async function handleUpload(slot: SlotKey, file: File) {
    if (!ACCEPTED.includes(file.type)) {
      toast.error("Arquivo inválido. Envie uma imagem em JPG, PNG ou WEBP.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Arquivo muito grande. Tamanho máximo: 10MB.");
      return;
    }
    setEnviando(slot);
    try {
      if (modoLocal) {
        setSignedUrls((s) => ({ ...s, [slot]: URL.createObjectURL(file) }));
        setVerif((atual) => ({
          id: atual?.id ?? "preview",
          user_id: usuario?.profileId ?? "preview",
          document_type: docType,
          document_front_url: slot === "frente" ? file.name : atual?.document_front_url ?? null,
          document_back_url: slot === "verso" ? file.name : atual?.document_back_url ?? null,
          selfie_url: slot === "selfie" ? file.name : atual?.selfie_url ?? null,
          verification_status: "pendente",
          rejection_reason: null,
          submitted_at: null,
        }));
        toast.success("Arquivo selecionado.");
        return;
      }
      const row = await ensureVerifRow();
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${row.user_id}/${slot}-${Date.now()}.${ext}`;

      // delete previous file for this slot if any
      const previous = (row as any)[slotColumn(slot)] as string | null;
      if (previous) {
        await supabase.storage.from("documentos-verificacao").remove([previous]);
      }

      const { error: upErr } = await supabase.storage
        .from("documentos-verificacao")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;

      const update: any = { [slotColumn(slot)]: path };
      // if type changed before any file, persist it
      if (row.document_type !== docType) update.document_type = docType;
      if (row.verification_status === "recusado") {
        update.verification_status = "pendente";
        update.rejection_reason = null;
      }
      const { data: upd, error: updErr } = await supabase
        .from("verificacoes_documento" as any)
        .update(update)
        .eq("id", row.id)
        .select("*")
        .single();
      if (updErr) throw updErr;

      const v = upd as unknown as Verificacao;
      setVerif(v);
      await refreshSigned(v);
      toast.success("Arquivo enviado.");
    } catch (e: any) {
      toast.error("Erro ao enviar: " + (e?.message || "tente novamente"));
    } finally {
      setEnviando(null);
    }
  }

  async function handleRemove(slot: SlotKey) {
    if (!verif) return;
    if (modoLocal) {
      setSignedUrls((s) => ({ ...s, [slot]: null }));
      setVerif((atual) => atual ? ({ ...atual, [slotColumn(slot)]: null }) : null);
      return;
    }
    const col = slotColumn(slot);
    const path = (verif as any)[col] as string | null;
    if (!path) return;
    setEnviando(slot);
    try {
      await supabase.storage.from("documentos-verificacao").remove([path]);
      const { data: upd, error } = await supabase
        .from("verificacoes_documento" as any)
        .update({ [col]: null } as any)
        .eq("id", verif.id)
        .select("*")
        .single();
      if (error) throw error;
      const v = upd as unknown as Verificacao;
      setVerif(v);
      setSignedUrls((s) => ({ ...s, [slot]: null }));
    } catch (e: any) {
      toast.error("Erro ao remover: " + e.message);
    } finally {
      setEnviando(null);
    }
  }

  async function handleChangeDocType(novo: DocType) {
    setDocType(novo);
    if (modoLocal) {
      setVerif((atual) => atual ? ({ ...atual, document_type: novo }) : atual);
      return;
    }
    if (verif && verif.document_type !== novo) {
      await supabase
        .from("verificacoes_documento" as any)
        .update({ document_type: novo } as any)
        .eq("id", verif.id);
    }
  }

  async function handleFinalizar() {
    if (!verif) {
      toast.error("Envie ao menos um arquivo antes de concluir.");
      return;
    }
    if (!verif.document_front_url) return toast.error("Envie a frente do documento.");
    if (!verif.document_back_url) return toast.error("Envie o verso do documento.");
    if (!verif.selfie_url) return toast.error("Envie uma foto sua segurando o documento.");

    setFinalizando(true);
    try {
      if (modoLocal) {
        setVerif((atual) => atual ? ({ ...atual, verification_status: "enviado", submitted_at: new Date().toISOString() }) : atual);
        toast.success("Documentos preparados. Entre com sessão real para envio seguro definitivo.");
        return;
      }
      const { data: upd, error } = await supabase
        .from("verificacoes_documento" as any)
        .update({
          verification_status: "em_analise",
          submitted_at: new Date().toISOString(),
          rejection_reason: null,
        } as any)
        .eq("id", verif.id)
        .select("*")
        .single();
      if (error) throw error;
      setVerif(upd as unknown as Verificacao);
      toast.success("Documentos enviados com sucesso. Sua verificação está em análise.");
    } catch (e: any) {
      toast.error("Erro ao concluir: " + e.message);
    } finally {
      setFinalizando(false);
    }
  }

  if (loading) {
    return (
      <Card className="border-neutral-100 rounded-2xl p-10 text-center">
        <Loader2 className="animate-spin mx-auto text-neutral-300" />
      </Card>
    );
  }

  if (erro) {
    return (
      <Card className="border-red-100 rounded-2xl p-6 bg-red-50">
        <p className="text-sm text-red-700 font-medium">{erro}</p>
      </Card>
    );
  }

  const statusKey: keyof typeof STATUS_META = verif?.verification_status ?? "nao_verificado";
  const meta = STATUS_META[statusKey];
  const StatusIcon = meta.icon;
  const bloqueado = verif?.verification_status === "em_analise" || verif?.verification_status === "aprovado";

  return (
    <Card className="border-neutral-100 shadow-sm rounded-2xl overflow-hidden bg-white">
      <div className="px-8 py-6 border-b border-neutral-50 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-black text-neutral-900 tracking-tight">Verificação de documento</h3>
          <p className="text-sm text-neutral-500 font-medium">
            Envie a frente, o verso e uma foto sua segurando o documento para concluir a validação da conta.
          </p>
        </div>
        <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold ${meta.tone}`}>
          <StatusIcon size={14} /> {meta.label}
        </span>
      </div>

      <div className="p-8 space-y-8">
        {verif?.verification_status === "recusado" && verif.rejection_reason && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-bold mb-1">Motivo da recusa</p>
            <p>{verif.rejection_reason}</p>
            <p className="text-xs mt-2 opacity-80">Você pode reenviar os arquivos abaixo.</p>
          </div>
        )}

        {!bloqueado && (
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-neutral-500 mb-3">
              Tipo de documento
            </p>
            <div className="grid grid-cols-2 gap-3 max-w-md">
              {(
                [
                  { v: "cnh", label: "CNH" },
                  { v: "rg", label: "Identidade / RG" },
                ] as const
              ).map((opt) => {
                const active = docType === opt.v;
                return (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => handleChangeDocType(opt.v)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all ${
                      active
                        ? "border-neutral-900 bg-neutral-900 text-white shadow-lg"
                        : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400"
                    }`}
                  >
                    <IdCard size={18} />
                    <span className="text-sm font-bold">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <UploadCard
            titulo="Frente do documento"
            descricao="Envie uma foto nítida da frente."
            icon={IdCard}
            previewUrl={signedUrls.frente}
            enviando={enviando === "frente"}
            disabled={bloqueado}
            onPick={(f) => handleUpload("frente", f)}
            onRemove={() => handleRemove("frente")}
          />
          <UploadCard
            titulo="Verso do documento"
            descricao="Envie uma foto nítida do verso."
            icon={IdCard}
            previewUrl={signedUrls.verso}
            enviando={enviando === "verso"}
            disabled={bloqueado}
            onPick={(f) => handleUpload("verso", f)}
            onRemove={() => handleRemove("verso")}
          />
          <UploadCard
            titulo="Segurando o documento"
            descricao="Foto do seu rosto segurando o documento ao lado, ambos visíveis e legíveis."
            icon={Camera}
            previewUrl={signedUrls.selfie}
            enviando={enviando === "selfie"}
            disabled={bloqueado}
            onPick={(f) => handleUpload("selfie", f)}
            onRemove={() => handleRemove("selfie")}
            allowCamera
          />
        </div>

        {!bloqueado && (
          <div className="flex justify-end">
            <Button
              onClick={handleFinalizar}
              disabled={finalizando}
              className="bg-neutral-900 text-white hover:bg-neutral-800 px-8 h-12 rounded-xl font-bold"
            >
              {finalizando ? "Enviando..." : "Concluir verificação"}
            </Button>
          </div>
        )}

        <p className="text-xs text-neutral-400">
          Seus arquivos ficam em armazenamento privado, visíveis apenas para você e a equipe de análise da NOX Fiança.
        </p>
      </div>
    </Card>
  );
}

interface UploadCardProps {
  titulo: string;
  descricao: string;
  icon: any;
  previewUrl: string | null;
  enviando: boolean;
  disabled?: boolean;
  allowCamera?: boolean;
  onPick: (file: File) => void;
  onRemove: () => void;
}

function UploadCard({
  titulo,
  descricao,
  icon: Icon,
  previewUrl,
  enviando,
  disabled,
  allowCamera,
  onPick,
  onRemove,
}: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasFile = !!previewUrl;

  return (
    <div
      className={`relative rounded-2xl border-2 border-dashed transition-all overflow-hidden ${
        hasFile ? "border-emerald-300 bg-emerald-50/30" : "border-neutral-200 bg-neutral-50/40"
      }`}
    >
      <div className="p-4 flex flex-col h-full min-h-[260px]">
        <div className="flex items-start gap-3 mb-3">
          <div className={`p-2 rounded-lg ${hasFile ? "bg-emerald-100 text-emerald-700" : "bg-white text-neutral-600 border border-neutral-200"}`}>
            <Icon size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black text-neutral-900">{titulo}</p>
            <p className="text-[11px] text-neutral-500 leading-snug mt-0.5">{descricao}</p>
          </div>
          {hasFile && <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />}
        </div>

        <div className="flex-1 rounded-xl bg-white border border-neutral-200 overflow-hidden flex items-center justify-center min-h-[120px]">
          {previewUrl ? (
            <img src={previewUrl} alt={titulo} className="w-full h-full object-cover max-h-40" />
          ) : (
            <div className="flex flex-col items-center text-neutral-300">
              <Upload size={28} />
              <p className="text-[10px] font-bold uppercase tracking-widest mt-2">Nenhum arquivo</p>
            </div>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture={allowCamera ? "user" : undefined}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPick(f);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant={hasFile ? "outline" : "default"}
            disabled={disabled || enviando}
            onClick={() => inputRef.current?.click()}
            className={`flex-1 rounded-xl h-10 text-xs font-bold ${
              hasFile ? "" : "bg-neutral-900 text-white hover:bg-neutral-800"
            }`}
          >
            {enviando ? (
              <Loader2 size={14} className="animate-spin" />
            ) : hasFile ? (
              "Substituir"
            ) : (
              "Enviar arquivo"
            )}
          </Button>
          {hasFile && !disabled && (
            <Button
              type="button"
              variant="outline"
              disabled={enviando}
              onClick={onRemove}
              className="rounded-xl h-10 px-3"
              aria-label="Remover"
            >
              <Trash2 size={14} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
