import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock3, FileSignature, FileText, Receipt, ShieldCheck } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/inquilino/painel")({
  component: () => (
    <ProtectedRoute roles={["inquilino"]}>
      <PainelInquilino />
    </ProtectedRoute>
  ),
});

const STATUS: Record<string, { label: string; className: string }> = {
  processing: { label: "Preparando contrato", className: "bg-blue-50 text-blue-700" },
  awaiting_signature: {
    label: "Aguardando sua assinatura",
    className: "bg-amber-50 text-amber-700",
  },
  signed: { label: "Assinatura recebida", className: "bg-blue-50 text-blue-700" },
  active: { label: "Seguro ativo", className: "bg-emerald-50 text-emerald-700" },
  error: { label: "Em processamento", className: "bg-neutral-100 text-neutral-700" },
};

function PainelInquilino() {
  const { user } = useAuth();
  const [assinatura, setAssinatura] = useState<any>(null);
  const [apolice, setApolice] = useState<any>(null);
  const [documentos, setDocumentos] = useState(0);
  const [faturas, setFaturas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async () => {
    if (!user?.id) return;
    const { data: assinaturas } = await (supabase as any)
      .from("contract_signatures")
      .select("*")
      .eq("tenant_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1);
    const atual = assinaturas?.[0] ?? null;
    setAssinatura(atual);

    const [apoliceResult, documentosResult, faturasResult] = await Promise.all([
      atual?.policy_id
        ? supabase
            .from("apolices")
            .select("numero, status, vigencia_inicio, vigencia_fim")
            .eq("id", atual.policy_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      atual?.consultation_id
        ? supabase
            .from("documentos_proposta")
            .select("id", { count: "exact", head: true })
            .eq("consulta_id", atual.consultation_id)
        : Promise.resolve({ count: 0 }),
      supabase
        .from("faturas_inquilino")
        .select("id, status, valor, vencimento, numero_parcela")
        .eq("tenant_user_id", user.id)
        .order("numero_parcela", { ascending: true }),
    ]);
    setApolice((apoliceResult as any).data ?? null);
    setDocumentos(Number((documentosResult as any).count || 0));
    setFaturas((faturasResult as any).data ?? []);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    void carregar();
    const canal = supabase
      .channel(`tenant-contract-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "contract_signatures",
          filter: `tenant_user_id=eq.${user.id}`,
        },
        () => void carregar(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [carregar, user?.id]);

  const status = STATUS[assinatura?.status] || STATUS.processing;
  const abertas = faturas.filter((f) => ["pending", "overdue"].includes(f.status)).length;

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-400">
            Área do inquilino
          </p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-neutral-950">
            Meu seguro-fiança
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Contrato, documentos e cobranças em um só lugar.
          </p>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-neutral-200 bg-white p-10 text-sm text-neutral-500">
            Carregando seu contrato...
          </div>
        ) : (
          <>
            <section className="rounded-3xl bg-neutral-950 p-6 text-white shadow-lg sm:p-8">
              <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
                <div>
                  <span
                    className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${status.className}`}
                  >
                    {status.label}
                  </span>
                  <h2 className="mt-4 text-2xl font-black">
                    {assinatura?.plan_name || "Contrato NOX Fiança"}
                  </h2>
                  <p className="mt-1 text-sm text-neutral-400">
                    {apolice?.numero
                      ? `Apólice ${apolice.numero}`
                      : "Acompanhe aqui cada etapa da ativação."}
                  </p>
                </div>
                {assinatura?.status === "active" ? (
                  <CheckCircle2 className="h-14 w-14 text-emerald-400" />
                ) : (
                  <Clock3 className="h-14 w-14 text-yellow-400" />
                )}
              </div>
            </section>

            <div className="grid gap-4 sm:grid-cols-3">
              <ResumoCard
                icon={ShieldCheck}
                label="Situação"
                value={assinatura?.status === "active" ? "Ativo" : "Em andamento"}
              />
              <ResumoCard icon={FileText} label="Documentos" value={String(documentos)} />
              <ResumoCard icon={Receipt} label="Faturas em aberto" value={String(abertas)} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <AcessoCard
                icon={FileSignature}
                title="Contrato e documentos"
                description="Consulte e baixe o contrato assinado e os demais documentos."
                to="/inquilino/documentos"
                action="Ver documentos"
              />
              <AcessoCard
                icon={Receipt}
                title="Minhas faturas"
                description="Veja vencimentos, valores e a situação de todas as parcelas."
                to="/inquilino/faturas"
                action="Ver faturas"
              />
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function ResumoCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <Icon className="h-5 w-5 text-yellow-600" />
      <p className="mt-4 text-xs font-bold uppercase tracking-widest text-neutral-400">{label}</p>
      <p className="mt-1 text-xl font-black text-neutral-950">{value}</p>
    </div>
  );
}

function AcessoCard({
  icon: Icon,
  title,
  description,
  to,
  action,
}: {
  icon: typeof FileSignature;
  title: string;
  description: string;
  to: "/inquilino/documentos" | "/inquilino/faturas";
  action: string;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <Icon className="h-7 w-7 text-neutral-900" />
      <h3 className="mt-4 font-black text-neutral-950">{title}</h3>
      <p className="mt-1 text-sm text-neutral-500">{description}</p>
      <Button asChild className="mt-5 bg-neutral-950 text-white hover:bg-neutral-800">
        <Link to={to}>{action}</Link>
      </Button>
    </div>
  );
}
