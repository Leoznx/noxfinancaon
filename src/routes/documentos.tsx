import { createFileRoute } from "@tanstack/react-router";
import { Download, FileCheck2, FileClock, FileText, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type DocumentRow = {
  id: string;
  apolice_id: string;
  tipo: string;
  file_name: string | null;
  file_url: string | null;
  storagePath: string | null;
  bucket: string | null;
  status: string;
  uploaded_at: string | null;
  policyNumber: string;
  propertyName: string;
};

export const Route = createFileRoute("/documentos")({
  component: () => (
    <ProtectedRoute>
      <OwnerDocumentsPage />
    </ProtectedRoute>
  ),
});

function OwnerDocumentsPage() {
  const [rows, setRows] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data: policies, error: policiesError } = await supabase
        .from("apolices")
        .select(
          "id, numero, consulta:consultas_credito(imovel:imoveis(endereco, logradouro, numero))",
        )
        .order("created_at", { ascending: false });
      if (policiesError) throw policiesError;
      const policyIds = (policies ?? []).map((policy) => policy.id);
      if (!policyIds.length) {
        setRows([]);
        return;
      }

      const [legacyResult, signedResult] = await Promise.all([
        supabase
          .from("documentos_contrato")
          .select("id, apolice_id, tipo, file_name, file_url, storage_path, status, uploaded_at")
          .in("apolice_id", policyIds)
          .order("created_at", { ascending: false }),
        supabase
          .from("documentos_proposta")
          .select(
            "id, apolice_id, document_type, document_subtype, file_name, file_url, created_at",
          )
          .in("apolice_id", policyIds)
          .order("created_at", { ascending: false }),
      ]);
      if (legacyResult.error) throw legacyResult.error;
      if (signedResult.error) throw signedResult.error;

      const byId = new Map((policies ?? []).map((policy: any) => [policy.id, policy]));
      setRows(
        [
          ...(legacyResult.data ?? []).map((document) => ({
            id: document.id,
            apolice_id: document.apolice_id,
            tipo: document.tipo,
            file_name: document.file_name,
            file_url: document.file_url,
            storagePath: document.storage_path,
            bucket: null,
            status: document.status,
            uploaded_at: document.uploaded_at,
          })),
          ...(signedResult.data ?? []).map((document) => ({
            id: document.id,
            apolice_id: document.apolice_id!,
              tipo: document.document_type || "contrato",
            file_name: document.file_name,
            file_url: document.file_url,
            storagePath: document.file_url,
            bucket: document.document_subtype,
            status: "disponivel",
            uploaded_at: document.created_at,
          })),
        ].map((document) => {
          const policy: any = byId.get(document.apolice_id);
          const property = policy?.consulta?.imovel;
          return {
            ...document,
            policyNumber: policy?.numero || "—",
            propertyName:
              property?.endereco ||
              [property?.logradouro, property?.numero].filter(Boolean).join(", ") ||
              "Imóvel sem endereço",
          };
        }),
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Não foi possível carregar os documentos.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-[1100px]">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-500">
          Contratos
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-neutral-950">Documentos</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Contratos, apólices e vistorias dos seus imóveis.
        </p>

        {loading ? (
          <div className="mt-6 space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                key={index}
                className="h-24 animate-pulse rounded-2xl border border-neutral-200 bg-white"
              />
            ))}
          </div>
        ) : error ? (
          <div className="mt-6 rounded-2xl border border-red-100 bg-white p-10 text-center">
            <p className="font-bold text-neutral-900">Não foi possível carregar os documentos.</p>
            <p className="mt-2 text-sm text-neutral-500">{error}</p>
            <Button onClick={() => void load()} variant="outline" className="mt-5 gap-2 rounded-xl">
              <RefreshCw size={15} /> Tentar novamente
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-6 flex min-h-[340px] flex-col items-center justify-center rounded-2xl border border-neutral-200 bg-white p-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-neutral-50 text-neutral-300">
              <FileText size={28} />
            </div>
            <h2 className="mt-5 text-lg font-bold text-neutral-900">
              Nenhum documento disponível.
            </h2>
            <p className="mt-2 max-w-md text-sm text-neutral-500">
              Os documentos dos contratos vinculados aos seus imóveis aparecerão aqui.
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {rows.map((document) => (
              <DocumentCard key={document.id} document={document} />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function DocumentCard({ document }: { document: DocumentRow }) {
  const available = document.status === "disponivel" && Boolean(document.file_url);
  const Icon = available ? FileCheck2 : FileClock;
  const [opening, setOpening] = useState(false);

  async function openDocument() {
    setOpening(true);
    try {
      const url = await resolveDocumentUrl(document);
      if (!url) return;
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setOpening(false);
    }
  }
  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center">
      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${available ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-500"}`}
      >
        <Icon size={21} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold capitalize text-neutral-900">
            {document.file_name || document.tipo}
          </h2>
          <span
            className={`rounded-full px-2.5 py-1 text-[9px] font-bold ${available ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-500"}`}
          >
            {available ? "Disponível" : "Em preparação"}
          </span>
        </div>
        <p className="mt-1 truncate text-xs text-neutral-500">
          {document.propertyName} · Contrato {document.policyNumber}
        </p>
      </div>
      {available ? (
        <Button
          onClick={() => void openDocument()}
          disabled={opening}
          variant="outline"
          className="gap-2 rounded-xl text-xs font-bold"
        >
          <Download size={15} /> {opening ? "Abrindo..." : "Visualizar"}
        </Button>
      ) : (
        <span className="text-xs font-semibold text-neutral-400">Aguardando envio</span>
      )}
    </article>
  );
}

async function resolveDocumentUrl(document: DocumentRow) {
  const path = document.storagePath || document.file_url;
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const knownBuckets = ["contratos-assinados", "anexos", "approval-documents"];
  const buckets = document.bucket
    ? [document.bucket, ...knownBuckets.filter((bucket) => bucket !== document.bucket)]
    : knownBuckets;
  for (const bucket of buckets) {
    const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
    if (data?.signedUrl) return data.signedUrl;
  }
  return null;
}
