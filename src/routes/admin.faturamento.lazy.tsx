import { createLazyFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Search, AlertTriangle, Clock, CheckCircle2, Wallet, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

export const Route = createLazyFileRoute("/admin/faturamento")({
  component: () => (
    <ProtectedRoute roles={["admin", "analista", "financeiro"]}>
      <FaturamentoAdminPage />
    </ProtectedRoute>
  ),
});

const brl = (n: number) => `R$ ${Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
const hoje = () => new Date().toISOString().slice(0, 10);
const meses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const mesLabel = (y: number, m: number) => `${meses[m]}/${y}`;
const ymKey = (d: string) => d.slice(0, 7); // YYYY-MM

function FaturamentoAdminPage() {
  const [parcelas, setParcelas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const now = new Date();
  // selectedYM: 'YYYY-MM' OR 'all'
  const [selectedYM, setSelectedYM] = useState<string>(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [tab, setTab] = useState("todos");

  // Modal de pagamento
  const [payOpen, setPayOpen] = useState(false);
  const [payParcela, setPayParcela] = useState<any>(null);
  const [payDate, setPayDate] = useState(hoje());
  const [paySaving, setPaySaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("mensalidades")
        .select("id, valor, data_vencimento, data_pagamento, status, numero_parcela, boleto_url, linha_digitavel, apolice_id, apolice:apolices(numero, consulta:consultas_credito(tenant_name, tenant_document, property_address, payment_type, billing_responsible_role))")
        .order("data_vencimento", { ascending: false })
        .limit(5000);
      if (error) toast.error("Erro ao carregar faturas");
      else setParcelas(data ?? []);
      setLoading(false);
    })();
  }, []);

  const enriched = useMemo(() => parcelas.map(p => {
    const status: "pago" | "vencido" | "a_vencer" = p.status === "pago"
      ? "pago"
      : (p.data_vencimento < hoje() ? "vencido" : "a_vencer");
    return { ...p, _status: status, _ym: ymKey(p.data_vencimento) };
  }), [parcelas]);

  // Meses disponíveis ordenados desc
  const mesesDisponiveis = useMemo(() => {
    const set = new Set<string>();
    enriched.forEach(p => set.add(p._ym));
    // garantir mês vigente + próximo + anterior
    const y = now.getFullYear(); const m = now.getMonth();
    const add = (yy: number, mm: number) => set.add(`${yy}-${String(mm + 1).padStart(2, "0")}`);
    add(y, m); add(y, m + 1 > 11 ? 0 : m + 1); add(y, m - 1 < 0 ? 11 : m - 1);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [enriched]);

  const inSelected = (p: any) => selectedYM === "all" || p._ym === selectedYM;

  const filtrar = (lista: any[]) => {
    const q = busca.trim().toLowerCase();
    if (!q) return lista;
    return lista.filter(p =>
      (p.apolice?.consulta?.tenant_name ?? "").toLowerCase().includes(q) ||
      (p.apolice?.consulta?.tenant_document ?? "").toLowerCase().includes(q) ||
      (p.apolice?.consulta?.property_address ?? "").toLowerCase().includes(q) ||
      (p.apolice?.numero ?? "").toLowerCase().includes(q) ||
      p._status.includes(q)
    );
  };

  const doMes = useMemo(() => filtrar(enriched.filter(inSelected)), [enriched, selectedYM, busca]);

  const vencidas = doMes.filter(p => p._status === "vencido");
  const aReceber = doMes.filter(p => p._status === "a_vencer");
  const pagas = doMes.filter(p => p._status === "pago");

  const totVencido = vencidas.reduce((s, p) => s + Number(p.valor), 0);
  const totReceber = aReceber.reduce((s, p) => s + Number(p.valor), 0);
  const totPago = pagas.reduce((s, p) => s + Number(p.valor), 0);
  const totGeral = totVencido + totReceber + totPago;

  // resumo por mês (outros meses) — exclui o selecionado
  const resumoMeses = useMemo(() => {
    const map = new Map<string, { ym: string; venc: number; rec: number; pago: number; total: number }>();
    enriched.forEach(p => {
      const cur = map.get(p._ym) ?? { ym: p._ym, venc: 0, rec: 0, pago: 0, total: 0 };
      const v = Number(p.valor);
      if (p._status === "vencido") cur.venc += v;
      else if (p._status === "a_vencer") cur.rec += v;
      else cur.pago += v;
      cur.total += v;
      map.set(p._ym, cur);
    });
    return Array.from(map.values())
      .filter(r => selectedYM === "all" || r.ym !== selectedYM)
      .sort((a, b) => b.ym.localeCompare(a.ym))
      .slice(0, 12);
  }, [enriched, selectedYM]);

  const abrirPagamento = (p: any) => {
    setPayParcela(p);
    setPayDate(hoje());
    setPayOpen(true);
  };

  const confirmarPagamento = async () => {
    if (!payParcela) return;
    setPaySaving(true);
    const dataIso = new Date(payDate + "T12:00:00").toISOString();
    const { error } = await supabase
      .from("mensalidades")
      .update({ status: "pago", data_pagamento: dataIso })
      .eq("id", payParcela.id);
    if (error) { toast.error("Erro ao marcar como pago"); setPaySaving(false); return; }
    // audit (best-effort)
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from("audit_logs").insert({
        action: "pagamento_marcado",
        module: "faturamento",
        target_id: payParcela.id,
        performed_by: user?.id,
        details: { valor: payParcela.valor, data_pagamento: dataIso, parcela: payParcela.numero_parcela },
      } as any);
    } catch {}
    toast.success("Pagamento registrado");
    setParcelas(prev => prev.map(p => p.id === payParcela.id ? { ...p, status: "pago", data_pagamento: dataIso } : p));
    setPayOpen(false);
    setPaySaving(false);
  };

  const navegarMes = (delta: number) => {
    if (selectedYM === "all") return;
    const [y, m] = selectedYM.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setSelectedYM(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const tituloPeriodo = selectedYM === "all"
    ? "Faturamento — Todos os meses"
    : (() => { const [y, m] = selectedYM.split("-").map(Number); return `Faturamento de ${mesLabel(y, m - 1)}`; })();

  const ymVigente = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const dProx = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const ymProx = `${dProx.getFullYear()}-${String(dProx.getMonth() + 1).padStart(2, "0")}`;
  const dAnt = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const ymAnt = `${dAnt.getFullYear()}-${String(dAnt.getMonth() + 1).padStart(2, "0")}`;

  const tabLista = tab === "vencidos" ? vencidas : tab === "receber" ? aReceber : tab === "pagos" ? pagas : doMes;

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Faturamento</h1>
          <p className="text-neutral-500 mt-2">Visão financeira por mês, vencidos, a receber e pagos.</p>
        </div>

        {/* Filtros de período */}
        <div className="flex flex-wrap items-center gap-2">
          <PeriodoBtn active={selectedYM === ymVigente} onClick={() => setSelectedYM(ymVigente)}>Mês vigente</PeriodoBtn>
          <PeriodoBtn active={selectedYM === ymProx} onClick={() => setSelectedYM(ymProx)}>Próximo mês</PeriodoBtn>
          <PeriodoBtn active={selectedYM === ymAnt} onClick={() => setSelectedYM(ymAnt)}>Mês anterior</PeriodoBtn>
          <PeriodoBtn active={selectedYM === "all"} onClick={() => setSelectedYM("all")}>Todos os meses</PeriodoBtn>

          <div className="flex items-center gap-1 ml-auto">
            <Button variant="outline" size="icon" onClick={() => navegarMes(-1)} disabled={selectedYM === "all"}><ChevronLeft size={16} /></Button>
            <Select value={selectedYM} onValueChange={setSelectedYM}>
              <SelectTrigger className="w-[200px] h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os meses</SelectItem>
                {mesesDisponiveis.map(ym => {
                  const [y, m] = ym.split("-").map(Number);
                  return <SelectItem key={ym} value={ym}>{mesLabel(y, m - 1)}</SelectItem>;
                })}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => navegarMes(1)} disabled={selectedYM === "all"}><ChevronRight size={16} /></Button>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-bold">{tituloPeriodo}</h2>
          <p className="text-sm text-neutral-500">Acompanhe as parcelas vencidas, a vencer e pagas deste período.</p>
        </div>

        {/* Cards de resumo */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card titulo="Vencidos" valor={totVencido} cor="bg-red-50 border-red-200 text-red-700" icone={<AlertTriangle size={20} />} qtd={vencidas.length} />
          <Card titulo="A receber" valor={totReceber} cor="bg-amber-50 border-amber-200 text-amber-700" icone={<Clock size={20} />} qtd={aReceber.length} />
          <Card titulo="Pagos" valor={totPago} cor="bg-emerald-50 border-emerald-200 text-emerald-700" icone={<CheckCircle2 size={20} />} qtd={pagas.length} />
          <Card titulo="Total do mês" valor={totGeral} cor="bg-neutral-50 border-neutral-200 text-neutral-700" icone={<Wallet size={20} />} qtd={doMes.length} />
        </div>

        {/* Busca */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
          <Input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar inquilino, CPF, endereço ou nº contrato..." className="pl-10 h-11" />
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="todos">Todos ({doMes.length})</TabsTrigger>
            <TabsTrigger value="vencidos">Vencidos ({vencidas.length})</TabsTrigger>
            <TabsTrigger value="receber">A receber ({aReceber.length})</TabsTrigger>
            <TabsTrigger value="pagos">Pagos ({pagas.length})</TabsTrigger>
          </TabsList>
          <TabsContent value={tab} className="mt-6">
            <TabelaFaturas loading={loading} parcelas={tabLista} onPagar={abrirPagamento} />
          </TabsContent>
        </Tabs>

        {/* Outros meses */}
        <div className="space-y-4">
          <h3 className="text-lg font-bold">Outros meses</h3>
          <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-sm">
            <Table>
              <TableHeader className="bg-neutral-50">
                <TableRow>
                  <TableHead className="px-6">Mês</TableHead>
                  <TableHead className="text-right">Vencidos</TableHead>
                  <TableHead className="text-right">A receber</TableHead>
                  <TableHead className="text-right">Pagos</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="pr-6 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resumoMeses.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-12 text-neutral-400">Sem outros meses para exibir.</TableCell></TableRow>
                ) : resumoMeses.map(r => {
                  const [y, m] = r.ym.split("-").map(Number);
                  return (
                    <TableRow key={r.ym}>
                      <TableCell className="px-6 font-semibold">{mesLabel(y, m - 1)}</TableCell>
                      <TableCell className="text-right text-red-700">{brl(r.venc)}</TableCell>
                      <TableCell className="text-right text-amber-700">{brl(r.rec)}</TableCell>
                      <TableCell className="text-right text-emerald-700">{brl(r.pago)}</TableCell>
                      <TableCell className="text-right font-semibold">{brl(r.total)}</TableCell>
                      <TableCell className="pr-6 text-right">
                        <Button size="sm" variant="outline" onClick={() => { setSelectedYM(r.ym); setTab("todos"); }}>Ver mês</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* Modal Marcar Pago */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar parcela como paga</DialogTitle>
            <DialogDescription>Confirme os dados e a data do pagamento.</DialogDescription>
          </DialogHeader>
          {payParcela && (
            <div className="space-y-4 py-2">
              <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4 text-sm space-y-1">
                <p><span className="text-neutral-500">Inquilino:</span> <span className="font-semibold">{payParcela.apolice?.consulta?.tenant_name ?? "—"}</span></p>
                <p><span className="text-neutral-500">Contrato:</span> <span className="font-mono">{payParcela.apolice?.numero ?? "—"}</span></p>
                <p><span className="text-neutral-500">Parcela:</span> #{payParcela.numero_parcela ?? "—"}</p>
                <p><span className="text-neutral-500">Vencimento:</span> {new Date(payParcela.data_vencimento).toLocaleDateString("pt-BR")}</p>
                <p><span className="text-neutral-500">Valor:</span> <span className="font-bold">{brl(payParcela.valor)}</span></p>
              </div>
              <div className="space-y-2">
                <Label>Data do pagamento</Label>
                <Input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>Cancelar</Button>
            <Button onClick={confirmarPagamento} disabled={paySaving} className="bg-emerald-600 hover:bg-emerald-700 text-white">{paySaving ? "Salvando..." : "Confirmar pagamento"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

function PeriodoBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`h-10 px-4 rounded-lg text-sm font-semibold transition-all ${active ? "bg-neutral-900 text-white" : "bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50"}`}
    >{children}</button>
  );
}

function Card({ titulo, valor, cor, icone, qtd }: { titulo: string; valor: number; cor: string; icone: React.ReactNode; qtd: number }) {
  return (
    <div className={`border rounded-xl p-5 ${cor}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider">{titulo}</span>
        {icone}
      </div>
      <p className="text-2xl font-bold mt-2">{brl(valor)}</p>
      <p className="text-xs mt-1 opacity-75">{qtd} {qtd === 1 ? "parcela" : "parcelas"}</p>
    </div>
  );
}

function TabelaFaturas({ loading, parcelas, onPagar }: { loading: boolean; parcelas: any[]; onPagar: (p: any) => void }) {
  const copiar = async (txt?: string | null) => {
    if (!txt) return toast.error("Sem linha digitável");
    await navigator.clipboard.writeText(txt);
    toast.success("Linha digitável copiada");
  };
  return (
    <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-sm">
      <Table>
        <TableHeader className="bg-neutral-50">
          <TableRow>
            <TableHead className="px-6">Inquilino</TableHead>
            <TableHead>Contrato</TableHead>
            <TableHead>Parcela</TableHead>
            <TableHead>Valor</TableHead>
            <TableHead>Vencimento</TableHead>
            <TableHead>Responsável pelo pagamento</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="pr-6 text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow><TableCell colSpan={8} className="text-center py-16 text-neutral-400">Carregando...</TableCell></TableRow>
          ) : !parcelas.length ? (
            <TableRow><TableCell colSpan={8} className="text-center py-16 text-neutral-500">Nenhuma parcela no período.</TableCell></TableRow>
          ) : parcelas.map(p => {
            const pt = p.apolice?.consulta?.payment_type;
            const respLabel = pt === "imobiliaria" ? "Imobiliária" : pt === "inquilino" ? "Inquilino" : "—";
            const respCls = pt === "imobiliaria"
              ? "bg-blue-50 text-blue-700 border-blue-200"
              : pt === "inquilino"
                ? "bg-purple-50 text-purple-700 border-purple-200"
                : "bg-neutral-50 text-neutral-500 border-neutral-200";
            return (
            <TableRow key={p.id}>
              <TableCell className="px-6">
                <p className="font-semibold">{p.apolice?.consulta?.tenant_name ?? "—"}</p>
                <p className="text-xs text-neutral-500">{p.apolice?.consulta?.tenant_document ?? ""}</p>
              </TableCell>
              <TableCell className="text-xs font-mono">{p.apolice?.numero ?? "—"}</TableCell>
              <TableCell>{p.numero_parcela ? `#${p.numero_parcela}` : "—"}</TableCell>
              <TableCell className="font-semibold">{brl(p.valor)}</TableCell>
              <TableCell className="text-xs">{new Date(p.data_vencimento).toLocaleDateString("pt-BR")}</TableCell>
              <TableCell><Badge className={respCls}>{respLabel}</Badge></TableCell>
              <TableCell><StatusFat status={p._status} /></TableCell>
              <TableCell className="pr-6 text-right space-x-1">
                {p.boleto_url && (
                  <a href={p.boleto_url} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="ghost">Boleto</Button>
                  </a>
                )}
                {p.linha_digitavel && (
                  <Button size="sm" variant="ghost" onClick={() => copiar(p.linha_digitavel)}>Copiar linha</Button>
                )}
                {p._status === "pago"
                  ? <Button size="sm" variant="outline" disabled>Ver pagamento</Button>
                  : <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => onPagar(p)}>Marcar pago</Button>}
              </TableCell>
            </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function StatusFat({ status }: { status: string }) {
  const map: Record<string, string> = {
    pago: "bg-emerald-100 text-emerald-700 border-emerald-200",
    vencido: "bg-red-100 text-red-700 border-red-200",
    a_vencer: "bg-amber-100 text-amber-700 border-amber-200",
  };
  const labels: Record<string, string> = { pago: "Pago", vencido: "Vencido", a_vencer: "A vencer" };
  return <Badge className={map[status]}>{labels[status]}</Badge>;
}
