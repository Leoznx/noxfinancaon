import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { Receipt, Info, AlertTriangle, Copy, FileText, CheckCircle2, Wallet, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/inquilino/faturas")({
  component: () => (
    <ProtectedRoute roles={["inquilino"]}>
      <FaturasInquilino />
    </ProtectedRoute>
  ),
});

const brl = (n: number) => `R$ ${Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

function statusInfo(s: string) {
  if (s === "pago") return { label: "Pago", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" };
  if (s === "vencido") return { label: "Vencido", cls: "bg-red-100 text-red-700 border-red-200" };
  if (s === "cancelado") return { label: "Cancelado", cls: "bg-neutral-100 text-neutral-700 border-neutral-200" };
  return { label: "A vencer", cls: "bg-amber-100 text-amber-700 border-amber-200" };
}

function FaturasInquilino() {
  const { user } = useAuth();
  const [faturas, setFaturas] = useState<any[]>([]);
  const [consultas, setConsultas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data: cons } = await supabase
          .from("consultas_credito")
          .select("id, payment_type")
          .eq("tenant_email", user?.email ?? "");
        const lista = cons ?? [];
        setConsultas(lista);
        const ids = lista.map((c: any) => c.id);
        if (!ids.length) { setFaturas([]); return; }
        const { data: fats } = await supabase
          .from("faturas_inquilino")
          .select("*")
          .in("consulta_id", ids)
          .order("numero_parcela", { ascending: true });
        setFaturas(fats ?? []);
      } finally { setLoading(false); }
    })();
  }, [user?.email]);

  const allViaImob = consultas.length > 0 && consultas.every((c: any) => c.payment_type === "imobiliaria");

  const resumo = useMemo(() => {
    const total = faturas.reduce((s, f) => s + Number(f.valor || 0), 0);
    const pago = faturas.filter((f) => f.status === "pago").reduce((s, f) => s + Number(f.valor || 0), 0);
    const aberto = faturas.filter((f) => f.status !== "pago" && f.status !== "cancelado").reduce((s, f) => s + Number(f.valor || 0), 0);
    const vencidas = faturas.filter((f) => f.status === "vencido");
    const prox = faturas
      .filter((f) => f.status !== "pago" && f.status !== "cancelado")
      .sort((a, b) => new Date(a.vencimento).getTime() - new Date(b.vencimento).getTime())[0];
    return { total, pago, aberto, prox, vencidas };
  }, [faturas]);

  function copiar(linha: string) {
    navigator.clipboard.writeText(linha);
    toast.success("Linha digitável copiada");
  }

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-neutral-900">Minhas Faturas</h1>
          <p className="text-sm text-neutral-500 mt-1">Acompanhe seus boletos, vencimentos e pagamentos.</p>
        </div>

        {allViaImob && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex gap-3">
            <Info className="text-yellow-700 shrink-0 mt-0.5" size={18} />
            <p className="text-sm text-neutral-700">
              Este contrato possui cobrança centralizada pela imobiliária. Apenas a 1ª parcela e a taxa de ativação, se houver, são de responsabilidade do inquilino.
            </p>
          </div>
        )}

        {resumo.vencidas.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-5 flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
              <AlertTriangle className="text-red-600" size={20} />
            </div>
            <div className="flex-1">
              <p className="font-black text-red-700 text-sm">Atenção: existe {resumo.vencidas.length} parcela vencida.</p>
              <p className="text-xs text-red-600/80 mt-0.5">Regularize o pagamento para manter sua fiança ativa.</p>
            </div>
            {resumo.vencidas[0]?.boleto_url && (
              <a href={resumo.vencidas[0].boleto_url} target="_blank" rel="noreferrer">
                <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white">Ver parcela vencida</Button>
              </a>
            )}
          </div>
        )}

        {/* Próximo vencimento */}
        <div className="w-full lg:max-w-xs">
          <ResumoCard
            icon={CalendarClock}
            label="Próximo vencimento"
            value={resumo.prox ? new Date(resumo.prox.vencimento).toLocaleDateString("pt-BR") : "—"}
            tint="bg-white border border-neutral-200 text-neutral-900"
          />
        </div>

        {loading ? (
          <p className="text-sm text-neutral-400">Carregando...</p>
        ) : !faturas.length ? (
          <div className="bg-white border border-neutral-200 rounded-2xl p-10 text-center">
            <Receipt size={32} className="mx-auto text-neutral-300 mb-3" />
            <p className="text-sm text-neutral-500">Nenhuma fatura disponível ainda.</p>
          </div>
        ) : (
          <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-[10px] uppercase tracking-widest text-neutral-500">
                <tr>
                  <th className="text-left px-6 py-4">Parcela</th>
                  <th className="text-left px-6 py-4">Vencimento</th>
                  <th className="text-left px-6 py-4">Valor</th>
                  <th className="text-left px-6 py-4">Status</th>
                  <th className="text-left px-6 py-4">Pagamento</th>
                  <th className="text-right px-6 py-4">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {faturas.map((f) => {
                  const s = statusInfo(f.status);
                  const pago = f.status === "pago";
                  return (
                    <tr key={f.id} className="hover:bg-neutral-50/60">
                      <td className="px-6 py-4 font-bold">#{String(f.numero_parcela).padStart(2, "0")}</td>
                      <td className="px-6 py-4 text-neutral-700">{new Date(f.vencimento).toLocaleDateString("pt-BR")}</td>
                      <td className="px-6 py-4 font-black text-neutral-900">{brl(f.valor)}</td>
                      <td className="px-6 py-4"><Badge className={`${s.cls} border`}>{s.label}</Badge></td>
                      <td className="px-6 py-4 text-neutral-600">{f.pago_em ? new Date(f.pago_em).toLocaleDateString("pt-BR") : "—"}</td>
                      <td className="px-6 py-4 text-right space-x-1 whitespace-nowrap">
                        {pago ? (
                          f.boleto_url && (
                            <a href={f.boleto_url} target="_blank" rel="noreferrer">
                              <Button size="sm" variant="outline"><FileText size={14} className="mr-1" /> Ver pagamento</Button>
                            </a>
                          )
                        ) : (
                          <>
                            {f.boleto_url && (
                              <a href={f.boleto_url} target="_blank" rel="noreferrer">
                                <Button size="sm" className="bg-neutral-900 hover:bg-neutral-800 text-white">Ver boleto</Button>
                              </a>
                            )}
                            {f.linha_digitavel && (
                              <Button size="sm" variant="ghost" onClick={() => copiar(f.linha_digitavel)} title="Copiar linha digitável">
                                <Copy size={14} />
                              </Button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function ResumoCard({ icon: Icon, label, value, tint }: { icon: any; label: string; value: string; tint: string }) {
  return (
    <div className={`rounded-2xl p-4 ${tint}`}>
      <div className="flex items-center gap-2 mb-2 opacity-80">
        <Icon size={14} />
        <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
      </div>
      <p className="text-xl font-black tracking-tight">{value}</p>
    </div>
  );
}
