import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import {
  Wallet,
  Search,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { MESES_PT, isPagamentoConcluido, statusPagamentoLabel } from "@/lib/asaas-payment";

export const Route = createFileRoute("/carteira-cobrancas")({
  component: () => (
    <ProtectedRoute roles={["corretor", "imobiliaria"]}>
      <CarteiraCobrancas />
    </ProtectedRoute>
  ),
});

const brl = (n: number) => `R$ ${Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

const STATUS_CLASS: Record<string, string> = {
  paid: "bg-emerald-100 text-emerald-700 border-emerald-200",
  confirmed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  paid_via_consolidated: "bg-emerald-100 text-emerald-700 border-emerald-200",
  overdue: "bg-red-100 text-red-700 border-red-200",
  cancelled: "bg-neutral-100 text-neutral-700 border-neutral-200",
  refunded: "bg-neutral-100 text-neutral-700 border-neutral-200",
  partially_refunded: "bg-neutral-100 text-neutral-700 border-neutral-200",
};
const STATUS_ABERTO = ["pending", "overdue", "risk_analysis", "approved"];

function statusInfo(s: string) {
  return { label: statusPagamentoLabel(s), cls: STATUS_CLASS[s] || "bg-amber-100 text-amber-700 border-amber-200" };
}

type Contrato = {
  consultaId: string;
  tenantNome: string;
  tenantDocumento: string;
  endereco: string;
  parcelas: any[];
};

function CarteiraCobrancas() {
  const { user } = useAuth();
  const [faturas, setFaturas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState("todos");
  const now = new Date();
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [ano, setAno] = useState(now.getFullYear());
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [confirmandoAberto, setConfirmandoAberto] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [atualizandoId, setAtualizandoId] = useState<string | null>(null);

  async function carregar() {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("faturas_inquilino")
        .select(
          `*, consulta:consultas_credito(
            id, tenant_name,
            inquilino:inquilinos(nome, cpf, cnpj, razao_social),
            imovel:imoveis(endereco, cidade, estado)
          ), asaas_payment:asaas_payments(asaas_payment_id)`,
        )
        .order("numero_parcela", { ascending: true });
      setFaturas(data ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user?.id) return;
    carregar();
    // Sem filtro literal aqui de proposito: a carteira de um corretor/
    // imobiliaria depende de um JOIN em consultas_credito (dono ou
    // imobiliaria vinculada), nao de uma unica coluna igual em
    // faturas_inquilino - o Realtime do Supabase ja aplica a RLS da tabela
    // pra cada assinante, entao so chegam aqui as linhas que este usuario
    // realmente pode ver via SELECT (mesma fronteira de seguranca do fetch
    // acima), so refazendo a busca quando algo mudar.
    const channel = supabase
      .channel(`carteira-cobrancas-realtime-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "faturas_inquilino" },
        () => {
          carregar();
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
      await carregar();
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
      if (!consultaId) continue;
      if (!grupos.has(consultaId)) {
        const imovel = f.consulta?.imovel;
        const inquilino = f.consulta?.inquilino;
        grupos.set(consultaId, {
          consultaId,
          tenantNome: f.consulta?.tenant_name || inquilino?.razao_social || inquilino?.nome || "Inquilino",
          tenantDocumento: inquilino?.cpf || inquilino?.cnpj || "",
          endereco: imovel ? `${imovel.endereco}, ${imovel.cidade}/${imovel.estado}` : "Imóvel",
          parcelas: [],
        });
      }
      grupos.get(consultaId)!.parcelas.push(f);
    }
    return Array.from(grupos.values());
  }, [faturas]);

  const resumoCarteira = useMemo(() => {
    const abertas = faturas.filter((f) => f.status === "pending" || f.status === "overdue");
    const pagas = faturas.filter((f) => isPagamentoConcluido(f.status));
    const vencidas = faturas.filter((f) => f.status === "overdue");
    return {
      qtdAberto: abertas.length,
      qtdPago: pagas.length,
      valorAberto: abertas.reduce((s, f) => s + Number(f.valor || 0), 0),
      valorPago: pagas.reduce((s, f) => s + Number(f.valor || 0), 0),
      qtdVencidas: vencidas.length,
    };
  }, [faturas]);

  const contratosFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return contratos
      .map((c) => {
        const parcelas = c.parcelas.filter((p) => {
          if (statusFiltro !== "todos" && p.status !== statusFiltro) return false;
          return true;
        });
        return { ...c, parcelas };
      })
      .filter((c) => {
        if (!termo) return true;
        return c.tenantNome.toLowerCase().includes(termo) || c.tenantDocumento.includes(termo);
      });
  }, [contratos, busca, statusFiltro]);

  const elegiveisMes = useMemo(() => {
    return faturas.filter((f) => {
      if (f.payment_responsible !== "agency") return false;
      if (f.recipient_user_id !== user?.id) return false;
      if (f.consolidated_item_id) return false;
      if (!STATUS_ABERTO.includes(f.status)) return false;
      const [fAno, fMes] = String(f.vencimento).split("-").map(Number);
      return fMes === mes && fAno === ano;
    });
  }, [faturas, mes, ano, user?.id]);

  useEffect(() => {
    setSelecionadas(new Set());
  }, [mes, ano]);

  function alternarSelecao(id: string) {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selecionarTodasElegiveis() {
    setSelecionadas(new Set(elegiveisMes.map((f) => f.id)));
  }

  function copiar(linha: string) {
    navigator.clipboard.writeText(linha);
    toast.success("Linha digitável copiada");
  }

  const totalSelecionado = faturas
    .filter((f) => selecionadas.has(f.id))
    .reduce((s, f) => s + Number(f.valor || 0), 0);

  async function gerarConsolidado() {
    if (!selecionadas.size) return;
    setGerando(true);
    try {
      const { data, error } = await supabase.functions.invoke("asaas-create-consolidated-invoice", {
        body: { invoiceIds: Array.from(selecionadas), referenceMonth: mes, referenceYear: ano },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      if (!(data as any)?.success) throw new Error("Nao foi possivel gerar o boleto consolidado.");
      toast.success(`Boleto consolidado gerado: ${brl((data as any).totalValue)} (${(data as any).invoiceCount} faturas).`);
      setConfirmandoAberto(false);
      setSelecionadas(new Set());
      await carregar();
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível gerar o boleto consolidado agora.");
    } finally {
      setGerando(false);
    }
  }

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-neutral-900">Carteira de Cobranças</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Acompanhe as mensalidades da sua carteira de inquilinos e gere um boleto consolidado do mês.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-2xl border border-neutral-200 bg-white p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Em aberto</p>
            <p className="text-xl font-black tracking-tight text-neutral-900">{resumoCarteira.qtdAberto}</p>
            <p className="text-xs text-neutral-500">{brl(resumoCarteira.valorAberto)}</p>
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-white p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Pagas</p>
            <p className="text-xl font-black tracking-tight text-neutral-900">{resumoCarteira.qtdPago}</p>
            <p className="text-xs text-neutral-500">{brl(resumoCarteira.valorPago)}</p>
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-white p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Vencidas</p>
            <p className="text-xl font-black tracking-tight text-red-600">{resumoCarteira.qtdVencidas}</p>
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-white p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Contratos na carteira</p>
            <p className="text-xl font-black tracking-tight text-neutral-900">{contratos.length}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={16} />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou CPF/CNPJ"
              className="pl-9"
            />
          </div>
          <Select value={statusFiltro} onValueChange={setStatusFiltro}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os status</SelectItem>
              <SelectItem value="pending">Aguardando pagamento</SelectItem>
              <SelectItem value="overdue">Vencido</SelectItem>
              <SelectItem value="paid">Pago</SelectItem>
              <SelectItem value="confirmed">Confirmado</SelectItem>
              <SelectItem value="cancelled">Cancelado</SelectItem>
            </SelectContent>
          </Select>
          <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Mês" /></SelectTrigger>
            <SelectContent>
              {MESES_PT.map((nome, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>{nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
            <SelectTrigger className="w-[110px]"><SelectValue placeholder="Ano" /></SelectTrigger>
            <SelectContent>
              {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((a) => (
                <SelectItem key={a} value={String(a)}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {elegiveisMes.length > 0 && (
          <div className="bg-white border border-neutral-200 rounded-2xl p-4 flex flex-wrap items-center gap-3">
            <Wallet className="text-neutral-700" size={20} />
            <p className="text-sm text-neutral-700 flex-1">
              {elegiveisMes.length} fatura(s) elegível(is) para consolidar em {MESES_PT[mes - 1]}/{ano} — marque as
              linhas abaixo ou selecione todas.
            </p>
            <Button size="sm" variant="outline" onClick={selecionarTodasElegiveis}>
              Selecionar todas elegíveis
            </Button>
            <Button
              size="sm"
              className="bg-neutral-900 hover:bg-neutral-800 text-white"
              disabled={!selecionadas.size}
              onClick={() => setConfirmandoAberto(true)}
            >
              Gerar boleto consolidado do mês {selecionadas.size > 0 && `(${selecionadas.size})`}
            </Button>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-neutral-400">Carregando...</p>
        ) : !contratosFiltrados.length ? (
          <div className="bg-white border border-neutral-200 rounded-2xl p-10 text-center">
            <Wallet size={32} className="mx-auto text-neutral-300 mb-3" />
            <p className="text-sm text-neutral-500">Nenhuma fatura encontrada.</p>
          </div>
        ) : (
          contratosFiltrados.map((contrato) => {
            const aberto = expandidos.has(contrato.consultaId);
            return (
              <div key={contrato.consultaId} className="bg-white border border-neutral-200 rounded-2xl overflow-hidden shadow-sm">
                <button
                  type="button"
                  onClick={() =>
                    setExpandidos((prev) => {
                      const next = new Set(prev);
                      if (next.has(contrato.consultaId)) next.delete(contrato.consultaId);
                      else next.add(contrato.consultaId);
                      return next;
                    })
                  }
                  className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-neutral-50"
                >
                  <div>
                    <p className="text-sm font-black text-neutral-900">{contrato.tenantNome}</p>
                    <p className="text-xs text-neutral-500">
                      {contrato.tenantDocumento} · {contrato.endereco}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-neutral-500">
                    <span className="text-xs">{contrato.parcelas.length} parcela(s)</span>
                    {aberto ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </button>

                {aberto && (
                  <table className="w-full text-sm border-t border-neutral-100">
                    <thead className="bg-neutral-50 text-[10px] uppercase tracking-widest text-neutral-500">
                      <tr>
                        <th className="text-left px-4 py-3 w-8"></th>
                        <th className="text-left px-4 py-3">Mensalidade</th>
                        <th className="text-left px-4 py-3">Vencimento</th>
                        <th className="text-left px-4 py-3">Valor</th>
                        <th className="text-left px-4 py-3">Responsável</th>
                        <th className="text-left px-4 py-3">Status</th>
                        <th className="text-right px-4 py-3">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {contrato.parcelas.map((f) => {
                        const s = statusInfo(f.status);
                        const [fAno, fMes] = String(f.vencimento).split("-").map(Number);
                        const elegivel =
                          f.payment_responsible === "agency" &&
                          f.recipient_user_id === user?.id &&
                          !f.consolidated_item_id &&
                          STATUS_ABERTO.includes(f.status) &&
                          fMes === mes &&
                          fAno === ano;
                        return (
                          <tr key={f.id} className="hover:bg-neutral-50/60">
                            <td className="px-4 py-3">
                              {elegivel && (
                                <input
                                  type="checkbox"
                                  checked={selecionadas.has(f.id)}
                                  onChange={() => alternarSelecao(f.id)}
                                />
                              )}
                            </td>
                            <td className="px-4 py-3 font-bold">
                              Mês {f.numero_parcela} de {f.installment_total}
                              <span className="block text-xs font-normal text-neutral-500">
                                {MESES_PT[fMes - 1]} de {fAno}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-neutral-700">{new Date(f.vencimento).toLocaleDateString("pt-BR")}</td>
                            <td className="px-4 py-3 font-black text-neutral-900">{brl(f.valor)}</td>
                            <td className="px-4 py-3 text-neutral-600">
                              {f.payment_responsible === "agency" ? "Imobiliária" : "Inquilino"}
                            </td>
                            <td className="px-4 py-3">
                              <Badge className={`${s.cls} border`}>{s.label}</Badge>
                              {f.consolidated_item_id && (
                                <span className="block text-[10px] text-neutral-400 mt-0.5">Em lote consolidado</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right space-x-1 whitespace-nowrap">
                              {f.boleto_url && (
                                <a href={f.boleto_url} target="_blank" rel="noreferrer">
                                  <Button size="sm" variant="outline"><FileText size={14} /></Button>
                                </a>
                              )}
                              {f.linha_digitavel && (
                                <Button size="sm" variant="ghost" onClick={() => copiar(f.linha_digitavel)}>
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
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })
        )}
      </div>

      <Dialog open={confirmandoAberto} onOpenChange={setConfirmandoAberto}>
        <DialogContent className="max-w-md">
          <DialogTitle>Confirmar boleto consolidado</DialogTitle>
          <DialogDescription>
            {selecionadas.size} fatura(s) de {MESES_PT[mes - 1]}/{ano} serão reunidas em um único boleto.
            As cobranças individuais correspondentes serão canceladas automaticamente assim que este boleto for pago.
          </DialogDescription>
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm">
            <p className="flex justify-between"><span>Total do boleto</span><span className="font-black">{brl(totalSelecionado)}</span></p>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirmandoAberto(false)} disabled={gerando}>
              Cancelar
            </Button>
            <Button type="button" onClick={gerarConsolidado} disabled={gerando} className="bg-neutral-900 hover:bg-neutral-800 text-white">
              {gerando ? <Loader2 className="animate-spin mr-2" size={14} /> : null}
              Confirmar geração
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
