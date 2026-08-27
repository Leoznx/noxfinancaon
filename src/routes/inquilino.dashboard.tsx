import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/AuthProvider";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import {
  TenantDashboardHero,
  TenantScoreCard,
  TenantDashboardSummary,
  TenantInvoicesPanel,
} from "@/components/tenant-dashboard/TenantDashboardSections";
import { supabase } from "@/integrations/supabase/client";
import { reissuePayment } from "@/lib/automated-billing";
import {
  fetchTenantDashboard,
  isTenantInvoiceOpen,
  resolveTenantDashboardDocumentUrl,
  type TenantDashboardData,
  type TenantDashboardDocument,
} from "@/lib/tenant-dashboard";

export const Route = createFileRoute("/inquilino/dashboard")({
  component: () => (
    <ProtectedRoute roles={["inquilino"]}>
      <TenantDashboardPage />
    </ProtectedRoute>
  ),
});

const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function TenantDashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<TenantDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setError(null);
    try {
      setData(await fetchTenantDashboard(user.id, user.email));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Não foi possível carregar seu dashboard agora.",
      );
    } finally {
      setLoading(false);
    }
  }, [user?.email, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    void load();
    const channel = supabase
      .channel(`tenant-dashboard-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "contract_signatures" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "faturas_inquilino",
          filter: `tenant_user_id=eq.${user.id}`,
        },
        () => void load(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "documentos_proposta",
          filter: `tenant_user_id=eq.${user.id}`,
        },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, user?.id]);

  const nextOpenInvoice = useMemo(
    () =>
      [...(data?.invoices ?? [])]
        .filter((item) => isTenantInvoiceOpen(item.status))
        .sort(
          (a, b) =>
            new Date(a.dueDate || "9999-12-31").getTime() -
            new Date(b.dueDate || "9999-12-31").getTime(),
        )[0],
    [data?.invoices],
  );

  async function openDocument(document: TenantDashboardDocument) {
    const url = await resolveTenantDashboardDocumentUrl(document);
    if (!url) {
      toast.error("Este documento ainda não está disponível para download.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function handleInvoiceAction() {
    if (!nextOpenInvoice) {
      await navigate({ to: "/inquilino/faturas" });
      return;
    }
    if (nextOpenInvoice.boletoUrl) {
      window.open(nextOpenInvoice.boletoUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (nextOpenInvoice.invoiceId) {
      try {
        const payment = await reissuePayment({
          invoiceId: nextOpenInvoice.invoiceId,
          method: "boleto",
        });
        if (payment.boleto?.pdfUrl) {
          window.open(payment.boleto.pdfUrl, "_blank", "noopener,noreferrer");
        }
        toast.success("2ª via do boleto gerada.");
        await load();
        return;
      } catch (invoiceError) {
        toast.error(
          invoiceError instanceof Error ? invoiceError.message : "Não foi possível gerar a 2ª via.",
        );
      }
    }
    await navigate({ to: "/inquilino/faturas" });
  }

  async function handleContractAction() {
    if (!data) return;
    const contract =
      data.documents.find((document) => document.document_type === "contrato") ||
      data.documents.find((document) => /contrat|assinad/i.test(document.file_name)) ||
      (data.signature ? data.documents[0] : undefined);
    if (contract) {
      await openDocument(contract);
      return;
    }
    await navigate({ to: "/inquilino/documentos" });
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !user?.id || !data?.consultation) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error("Use um arquivo PDF, JPG, PNG ou WEBP.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error("O arquivo deve ter no máximo 10 MB.");
      return;
    }

    setUploading(true);
    const safeName = file.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .replace(/-+/g, "-");
    const path = `${user.id}/${data.consultation.id}/tenant-${Date.now()}-${safeName}`;
    try {
      const { error: uploadError } = await supabase.storage
        .from("approval-documents")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { error: insertError } = await supabase.from("documentos_proposta").insert({
        consulta_id: data.consultation.id,
        tenant_user_id: user.id,
        uploaded_by: user.id,
        file_name: file.name,
        file_url: path,
        file_type: file.type,
        document_type: "outro",
        document_subtype: "approval-documents",
      });
      if (insertError) throw insertError;
      toast.success("Documento enviado com sucesso.");
      await load();
    } catch (uploadError) {
      toast.error(
        uploadError instanceof Error ? uploadError.message : "Não foi possível enviar o documento.",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <DashboardLayout>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        onChange={handleUpload}
        className="hidden"
      />
      <div className="mx-auto w-full max-w-[1540px] space-y-4 pb-1">
        {loading ? (
          <DashboardLoading />
        ) : error || !data ? (
          <div className="flex min-h-[420px] flex-col items-center justify-center rounded-3xl border border-red-200 bg-red-50 p-8 text-center">
            <AlertCircle size={34} className="text-red-500" />
            <h1 className="mt-3 text-lg font-black text-neutral-950">
              Não foi possível carregar o dashboard
            </h1>
            <p className="mt-1 max-w-md text-sm text-red-700">{error}</p>
            <button
              onClick={() => void load()}
              className="mt-5 rounded-xl bg-neutral-950 px-5 py-2.5 text-xs font-bold text-white"
            >
              Tentar novamente
            </button>
          </div>
        ) : (
          <>
            <TenantDashboardHero data={data} />
            <TenantDashboardSummary data={data} />
            <div className="grid gap-4 xl:grid-cols-[1.04fr_1.5fr]">
              <TenantInvoicesPanel
                invoices={data.invoices}
                actions={{
                  onInvoice: () => void handleInvoiceAction(),
                  onContract: () => void handleContractAction(),
                  onUpload: () => {
                    if (!data.consultation) {
                      toast.info("Faça uma consulta antes de enviar documentos.");
                      return;
                    }
                    inputRef.current?.click();
                  },
                  uploading,
                }}
              />
              <TenantScoreCard
                name={data.tenantName}
                invoices={data.invoices}
              />
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function DashboardLoading() {
  return (
    <div className="flex min-h-[620px] items-center justify-center rounded-3xl border border-neutral-200 bg-white">
      <div className="flex items-center gap-3 text-sm font-semibold text-neutral-500">
        <Loader2 className="animate-spin text-[#e6aa00]" size={20} />
        Carregando seu dashboard...
      </div>
    </div>
  );
}
