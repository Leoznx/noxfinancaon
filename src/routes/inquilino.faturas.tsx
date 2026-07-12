import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { Receipt, Info, AlertTriangle, Copy, FileText, Wallet, CalendarClock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { MESES_PT, isPagamentoConcluido, statusPagamentoLabel } from "@/lib/asaas-payment";

export const Route = createFileRoute("/inquilino/faturas")({
  component: () => (
    <ProtectedRoute roles={["inquilino"]}>
      <FaturasInquilino />
    </ProtectedRoute>
  ),
});

const brl = (n: number) => `R$ ${Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

// "Em aberto" so soma o que ainda pode virar cobranca ativa (agendada,
// aguardando pagamento ou vencida) - nunca cancelada/estornada/chargeback.
const STATUS_ABERTO = ["pending", "overdue"];

const STATUS_CLASS: Record<string, string> = {
  paid: "bg-emerald-100 text-emerald-700 border-emerald-200",
  confirmed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  paid_via_consolidated: "bg-emerald-100 text-emerald-700 border-emerald-200",
  overdue: "bg-red-100 text-red-700 border-red-200",
  cancelled: "bg-neutral-100 text-neutral-700 border-neutral-200",
  refunded: "bg-neutral-100 text-neutral-700 border-neutral-200",
  partially_refunded: "bg-neutral-100 text-neutral-700 border-neutral-200",
  chargeback: "bg-red-100 text-red-700 border-red-200",
  chargeback_dispute: "bg-red-100 text-red-700 border-red-200",
  refused: "bg-red-100 text-red-700 border-red-200",
};

// A mensalidade "pending" mais proxima (ou ja vencida) mostra "Aguardando
// pagamento"; as demais pending futuras da mesma parcela mostram "Agendada" -
// e so um rotulo de exibicao (nao existe status "scheduled" no Asaas nem no
// banco, a coluna real continua "pending" o tempo todo).
function statusInfo(f: any, ehProximaAcionavel: boolean) {
  if (f.status === "pending" && !ehProximaAcionavel) {
    return { label: "Agendada", cls: "bg-slate-100 text-slate-600 border-slate-200" };
  }
  return {
    label: statusPagamentoLabel(f.status),
    cls: STATUS_CLASS[f.status] || "bg-amber-100 text-amber-700 border-amber-200",
  };
}

type Contrato = {
  consultaId: string;
  endereco: string;
  planoNome: string;
  viaImobiliaria: boolean;
  parcelas: any[];
};

function FaturasInquilino() {
  const { user } = useAuth();
  const [faturas, setFaturas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [atualizandoId, setAtualizandoId] = useState<string | null>(null);

  async function carregarFaturas() {
    if (!user?.id) return;
    const { data } = await supabase
      .from("faturas_inquilino")
      .select(
        `*, consulta:consultas_credito(id, payment_type, imovel:imoveis(endereco, cidade, estado), plano:planos(nome)), asaas_payment:asaas_payments(asaas_payment_id)`,
      )
      .eq("tenant_user_id", user.id)
      .order("numero_parcela", { ascending: true });
    setFaturas(data ?? []);
  }

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      try {
        await carregarFaturas();
      } finally {
        setLoading(false);
      }
    })();
    // Assim que o webhook do Asaas confirmar/receber um pagamento, o UPDATE
    // em faturas_inquilino chega aqui via Realtime e a tela atualiza sozinha
    // (sem precisar recarregar a pagina) - mesmo padrao ja usado no sino de
    // notificacoes (SinoNotificacoes.tsx).
    const channel = supabase
      .channel(`faturas-inquilino-realtime-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "faturas_inquilino", filter: `tenant_user_id=eq.${user.id}` },
        () => {
          carregarFaturas();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  async function atualizarStatus(fatura: any) {
    const paymentId = fatura.asaas_payment?.asaas_payment_id;
    if (!paymentId) return;
    setAtualizandoId(fatura.id);
    try {
      const { data, error } = await supabase.functions.invoke("asaas-get-payment", {
        body: { paymentId },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      await carregarFaturas();
      toast.success("Status atualizado.");
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível consultar o pagamento agora.");
    } finally {
      setAtualizandoId(null);
    }
  }

  const contratos = useMemo<Contrato[]>(() => {
    const grupos = new Map<string, Contrato>();
    for (const f of faturas) {
      const consultaId = f.consulta_id;
      if (!grupos.has(consultaId)) {
        const imovel = f.consulta?.imovel;
        grupos.set(consultaId, {
          consultaId,
          endereco: imovel ? `${imovel.endereco}, ${imovel.cidade}/${imovel.estado}` : "Imóvel",
          planoNome: f.consulta?.plano?.nome ?? "",
          viaImobiliaria: f.consulta?.payment_type === "imobiliaria",
          parcelas: [],
        });
      }
      grupos.get(consultaId)!.parcelas.push(f);
    }
    return Array.from(grupos.values());
  }, [faturas]);

  // Dentro de cada contrato, so a parcela "pending" com vencimento mais
  // proximo (ou ja vencida) e a que realmente precisa de acao agora - as
  // demais pending futuras aparecem como "Agendada".
  const proximaAcionavelPorContrato = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const contrato of contratos) {
      const acionaveis = contrato.parcelas
        .filter((f) => STATUS_ABERTO.includes(f.status))
        .sort((a, b) => new Date(a.vencimento).getTime() - new Date(b.vencimento).getTime());
      if (acionaveis[0]) mapa.set(contrato.consultaId, acionaveis[0].id);
    }
    return mapa;
  }, [contratos]);

  const resumo = useMemo(() => {
    const abertas = faturas.filter((f) => STATUS_ABERTO.includes(f.status));
    const pago = faturas.filter((f) => isPagamentoConcluido(f.status)).reduce((s, f) => s + Number(f.valor || 0), 0);
    const aberto = abertas.reduce((s, f) => s + Number(f.valor || 0), 0);
    const vencidas = faturas.filter((f) => f.status === "overdue");
    const prox = [...abertas].sort((a, b) => new Date(a.vencimento).getTime() - new Date(b.vencimento).getTime())[0];
    return { pago, aberto, prox, vencidas };
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
          <p className="text-sm text-neutral-500 mt-1">Acompanhe suas 12 mensalidades, vencimentos e pagamentos.</p>
        </div>

        {resumo.vencidas.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-5 flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
              <AlertTriangle className="text-red-600" size={20} />
            </div>
            <div className="flex-1">
              <p className="font-black text-red-700 text-sm">
                Atenção: existe{resumo.vencidas.length > 1 ? "m" : ""} {resumo.vencidas.length} mensalidade
                {resumo.vencidas.length > 1 ? "s" : ""} vencida{resumo.vencidas.length > 1 ? "s" : ""}.
              </p>
              <p className="text-xs text-red-600/80 mt-0.5">Regularize o pagamento para manter sua fiança ativa.</p>
            </div>
            {resumo.vencidas[0]?.boleto_url && (
              <a href={resumo.vencidas[0].boleto_url} target="_blank" rel="noreferrer">
                <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white">Ver parcela vencida</Button>
              </a>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <ResumoCard
            icon={CalendarClock}
            label="Próximo vencimento"
            value={resumo.prox ? new Date(resumo.prox.vencimento).toLocaleDateString("pt-BR") : "—"}
            tint="bg-white border border-neutral-200 text-neutral-900"
          />
          <ResumoCard
            icon={Wallet}
            label="Em aberto"
            value={brl(resumo.aberto)}
            tint="bg-white border border-neutral-200 text-neutral-900"
          />
          <ResumoCard
            icon={Receipt}
            label="Já pago"
            value={brl(resumo.pago)}
            tint="bg-white border border-neutral-200 text-neutral-900"
          />
        </div>

        {loading ? (
          <p className="text-sm text-neutral-400">Carregando...</p>
        ) : !contratos.length ? (
          <div className="bg-white border border-neutral-200 rounded-2xl p-10 text-center">
            <Receipt size={32} className="mx-auto text-neutral-300 mb-3" />
            <p className="text-sm text-neutral-500">Nenhuma fatura disponível ainda.</p>
          </div>
        ) : (
          contratos.map((contrato) => (
            <div key={contrato.consultaId} className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-black text-neutral-900">{contrato.endereco}</p>
                  {contrato.planoNome && <p className="text-xs text-neutral-500">{contrato.planoNome}</p>}
                </div>
              </div>

              {contrato.viaImobiliaria && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex gap-3">
                  <Info className="text-yellow-700 shrink-0 mt-0.5" size={18} />
                  <p className="text-sm text-neutral-700">
                    Este contrato possui cobrança centralizada pela imobiliária.
                  </p>
                </div>
              )}

              <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden shadow-sm">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50 text-[10px] uppercase tracking-widest text-neutral-500">
                    <tr>
                      <th className="text-left px-6 py-4">Mensalidade</th>
                      <th className="text-left px-6 py-4">Vencimento</th>
                      <th className="text-left px-6 py-4">Valor</th>
                      <th className="text-left px-6 py-4">Status</th>
                      <th className="text-left px-6 py-4">Pagamento</th>
                      <th className="text-right px-6 py-4">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {contrato.parcelas.map((f) => {
                      const ehProximaAcionavel = proximaAcionavelPorContrato.get(contrato.consultaId) === f.id;
                      const s = statusInfo(f, ehProximaAcionavel);
                      const pago = isPagamentoConcluido(f.status);
                      const [ano, mes] = String(f.vencimento).split("-").map(Number);
                      return (
                        <tr key={f.id} className="hover:bg-neutral-50/60">
                          <td className="px-6 py-4 font-bold">
                            Mês {f.numero_parcela} de {f.installment_total}
                            <span className="block text-xs font-normal text-neutral-500">
                              {MESES_PT[mes - 1]} de {ano}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-neutral-700">
                            {new Date(f.vencimento).toLocaleDateString("pt-BR")}
                          </td>
                          <td className="px-6 py-4 font-black text-neutral-900">{brl(f.valor)}</td>
                          <td className="px-6 py-4"><Badge className={`${s.cls} border`}>{s.label}</Badge></td>
                          <td className="px-6 py-4 text-neutral-600">
                            {f.pago_em ? new Date(f.pago_em).toLocaleDateString("pt-BR") : "—"}
                          </td>
                          <td className="px-6 py-4 text-right space-x-1 whitespace-nowrap">
                            {pago ? (
                              f.boleto_url && (
                                <a href={f.boleto_url} target="_blank" rel="noreferrer">
                                  <Button size="sm" variant="outline">
                                    <FileText size={14} className="mr-1" /> Ver pagamento
                                  </Button>
                                </a>
                              )
                            ) : (
                              <>
                                {f.boleto_url && (
                                  <a href={f.boleto_url} target="_blank" rel="noreferrer">
                                    <Button size="sm" className="bg-neutral-900 hover:bg-neutral-800 text-white">
                                      Ver boleto
                                    </Button>
                                  </a>
                                )}
                                {f.linha_digitavel && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => copiar(f.linha_digitavel)}
                                    title="Copiar linha digitável"
                                  >
                                    <Copy size={14} />
                                  </Button>
                                )}
                                {f.asaas_payment?.asaas_payment_id && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => atualizarStatus(f)}
                                    disabled={atualizandoId === f.id}
                                    title="Atualizar status"
                                  >
                                    <RefreshCw size={14} className={atualizandoId === f.id ? "animate-spin" : ""} />
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
            </div>
          ))
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
