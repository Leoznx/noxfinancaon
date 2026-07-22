import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { FileText, Download, Eye, ShieldCheck, ClipboardCheck, FileSignature, FileBadge } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/inquilino/documentos")({
  component: () => (
    <ProtectedRoute roles={["inquilino"]}>
      <DocumentosInquilino />
    </ProtectedRoute>
  ),
});

const TIPO_META: Record<string, { label: string; icon: any; tint: string }> = {
  contrato: { label: "Contrato", icon: FileSignature, tint: "bg-blue-50 text-blue-700" },
  vistoria: { label: "Vistoria", icon: ClipboardCheck, tint: "bg-purple-50 text-purple-700" },
  apolice:  { label: "Apólice",  icon: ShieldCheck,    tint: "bg-emerald-50 text-emerald-700" },
  garantia: { label: "Garantia", icon: FileBadge,      tint: "bg-amber-50 text-amber-700" },
};

const STORAGE_BUCKETS = ["contratos-assinados", "approval-documents", "anexos", "documentos-proposta"];

function DocumentosInquilino() {
  const { user } = useAuth();
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [contrato, setContrato] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: consultas } = await supabase
          .from("consultas_credito")
          .select("id")
          .eq("tenant_email", user?.email ?? "");
        const ids = (consultas ?? []).map((c: any) => c.id);
        if (!ids.length) { setDocs([]); return; }
        const [{ data: documentos }, { data: apo }] = await Promise.all([
          supabase.from("documentos_proposta").select("*").in("consulta_id", ids).order("created_at", { ascending: true }),
          supabase.from("apolices").select("numero").in("consulta_id", ids).limit(1).maybeSingle(),
        ]);
        setDocs(documentos ?? []);
        setContrato((apo as any)?.numero ?? null);
      } finally { setLoading(false); }
    })();
  }, [user?.email]);

  function bucketCandidates(bucketHint?: string | null) {
    const hint = bucketHint && STORAGE_BUCKETS.includes(bucketHint) ? bucketHint : null;
    return hint ? [hint, ...STORAGE_BUCKETS.filter((bucket) => bucket !== hint)] : STORAGE_BUCKETS;
  }

  async function signedUrl(d: any) {
    if (!d?.file_url) return null;
    if (/^https?:\/\//.test(d.file_url)) return d.file_url;
    for (const bucket of bucketCandidates(d.document_subtype)) {
      const { data } = await supabase.storage.from(bucket).createSignedUrl(d.file_url, 300);
      if (data?.signedUrl) return data.signedUrl;
    }
    return null;
  }

  async function abrir(d: any) {
    const url = await signedUrl(d);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  async function baixar(d: any) {
    if (!d?.file_url) return;
    const url = await signedUrl(d);
    if (url) {
      const a = document.createElement("a");
      a.href = url;
      a.download = d.file_name || "documento.pdf";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.click();
    }
  }

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-neutral-900">Meus Documentos</h1>
          <p className="text-sm text-neutral-500 mt-1">Documentos vinculados ao seu contrato{contrato ? ` · ${contrato}` : ""}.</p>
        </div>

        {loading ? (
          <p className="text-sm text-neutral-400">Carregando...</p>
        ) : !docs.length ? (
          <div className="bg-white border border-neutral-200 rounded-2xl p-10 text-center shadow-sm">
            <FileText size={32} className="mx-auto text-neutral-300 mb-3" />
            <p className="text-sm text-neutral-500">Documento ainda não disponível.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {docs.map((d) => {
              const meta = TIPO_META[d.document_type] ?? { label: d.document_type ?? "Documento", icon: FileText, tint: "bg-neutral-100 text-neutral-700" };
              const Icon = meta.icon;
              return (
                <div key={d.id} className="bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-3">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${meta.tint}`}>
                      <Icon size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm text-neutral-900 truncate">{d.file_name}</p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500 bg-neutral-100 px-2 py-0.5 rounded">
                          {meta.label}
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                          Disponível
                        </span>
                      </div>
                      <p className="text-xs text-neutral-400 mt-2">
                        Enviado em {new Date(d.created_at).toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-4">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => abrir(d)}>
                      <Eye size={14} className="mr-1.5" /> Visualizar
                    </Button>
                    <Button size="sm" className="flex-1 bg-neutral-900 hover:bg-neutral-800 text-white" onClick={() => baixar(d)}>
                      <Download size={14} className="mr-1.5" /> Baixar
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
