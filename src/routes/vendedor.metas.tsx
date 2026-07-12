import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { META_PADRAO_VENDEDOR, calcularBonus, calcularComissaoContratos, calcularGanhoTotal, SALARIO_FIXO_VENDEDOR } from "@/lib/comissao-vendedor";
import { AlertCircle, RefreshCw, ShieldCheck, Target, Trophy } from "lucide-react";
import { formatMoney, getSellerContext } from "@/lib/vendedor-portal";

export const Route = createFileRoute("/vendedor/metas")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin"]} moduleKey="metas">
      <Metas />
    </ProtectedRoute>
  ),
});

const FAIXAS = [
  { range: "0 a 9 contratos", pct: "0-49%", valor: "R$ 0", desc: "Sem comissão", min: 0, max: 9 },
  { range: "10 a 13 contratos", pct: "50-69%", valor: "R$ 25/contrato", desc: "Faixa de aceleração", min: 10, max: 13 },
  { range: "14 a 19 contratos", pct: "70-99%", valor: "R$ 35/contrato", desc: "Próximo da meta", min: 14, max: 19 },
  { range: "20 contratos", pct: "100%", valor: "R$ 50/contrato", desc: "Meta + bônus R$ 300", min: 20, max: 20 },
  { range: "21+ contratos", pct: "Acima de 100%", valor: "R$ 1.000 + R$ 80 por extra", desc: "Superou a meta", min: 21, max: 29 },
  { range: "30 contratos", pct: "150%", valor: "Bônus extra R$ 600", desc: "Top performer", min: 30, max: 39 },
  { range: "40 contratos", pct: "200%", valor: "Bônus extra R$ 1.000", desc: "Faixa máxima", min: 40, max: 9999 },
];

const EXEMPLOS = [5, 14, 20, 25, 30, 40];

function Metas() {
  const [contratos, setContratos] = useState(0);
  const [meta, setMeta] = useState<number | null>(null);
  const [historico, setHistorico] = useState<any[]>([]);
  const [mesAnterior, setMesAnterior] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");

  async function carregar() {
    setLoading(true);
    setErro("");

    try {
      const context = await getSellerContext();
      if (!context.sellerId) throw new Error("Não encontramos um vendedor ativo para este usuário.");

      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();
      const previousMonth = month === 1 ? 12 : month - 1;
      const previousYear = month === 1 ? year - 1 : year;

      const [goalRes, perfRes, prevRes, histRes] = await Promise.all([
        supabase.from("seller_goals" as any).select("target_contracts").eq("seller_id", context.sellerId).eq("month", month).eq("year", year).maybeSingle(),
        supabase.from("seller_performance" as any).select("contracts_activated").eq("seller_id", context.sellerId).eq("month", month).eq("year", year).maybeSingle(),
        supabase.from("seller_performance" as any).select("contracts_activated").eq("seller_id", context.sellerId).eq("month", previousMonth).eq("year", previousYear).maybeSingle(),
        supabase.from("seller_performance" as any).select("*").eq("seller_id", context.sellerId).order("year", { ascending: false }).order("month", { ascending: false }).limit(12),
      ]);

      if (goalRes.error) throw goalRes.error;
      if (perfRes.error) throw perfRes.error;
      if (prevRes.error) throw prevRes.error;
      if (histRes.error) throw histRes.error;

      setMeta((goalRes.data as any)?.target_contracts ?? null);
      setContratos((perfRes.data as any)?.contracts_activated ?? 0);
      setMesAnterior((prevRes.data as any)?.contracts_activated ?? null);
      setHistorico((histRes.data as any[]) ?? []);
    } catch (e: any) {
      setErro(e.message || "Não foi possível carregar suas metas.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { carregar(); }, []);

  const metaOperacional = meta ?? META_PADRAO_VENDEDOR;
  const ganho = calcularGanhoTotal(contratos);
  const pct = meta ? Math.min(100, Math.round((contratos / meta) * 100)) : 0;
  const faltam = meta ? Math.max(0, meta - contratos) : 0;
  const proxima = FAIXAS.find((faixa) => contratos < faixa.min);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-yellow-100 p-2 text-yellow-700">
              <Target className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight text-neutral-950">Minhas Metas</h1>
              <p className="text-sm font-medium text-neutral-500">Meta cadastrada, produção real e regras comerciais do mês.</p>
            </div>
          </div>
          <Button variant="outline" className="gap-2" onClick={carregar} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>

        {erro && <Aviso titulo="Não foi possível carregar suas metas" descricao={erro} erro />}
        {loading ? (
          <Aviso titulo="Carregando metas..." descricao="Buscando registros reais de meta e performance." />
        ) : !erro && (
          <>
            {!meta && (
              <Aviso titulo="Nenhuma meta cadastrada" descricao={`Não há meta individual registrada para este mês. A referência operacional padrão é ${META_PADRAO_VENDEDOR} contratos.`} />
            )}

            <Card className="border-yellow-300 bg-gradient-to-br from-yellow-50 to-white">
              <CardContent className="space-y-4 p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-neutral-500">Mês atual</p>
                    <p className="text-4xl font-black">{contratos} / {meta ?? "-"}</p>
                    <p className="mt-1 text-sm text-yellow-800">
                      {meta ? `${pct}% da meta · ${faltam > 0 ? `Faltam ${faltam}` : "Meta atingida"}` : "Sem meta individual cadastrada"}
                    </p>
                  </div>
                  <div className="text-left lg:text-right">
                    <p className="text-xs font-bold uppercase tracking-wider text-neutral-500">Ganho calculado pela regra</p>
                    <p className="text-3xl font-black text-yellow-700">{formatMoney(ganho.total)}</p>
                    <p className="text-xs text-neutral-500">Fixo {formatMoney(SALARIO_FIXO_VENDEDOR)} + Com. {formatMoney(ganho.comissao)} + Bônus {formatMoney(ganho.bonus)}</p>
                  </div>
                </div>
                <Progress value={pct} className="h-3" />
                {proxima && <p className="text-sm text-neutral-500">Próxima faixa: <b>{proxima.range}</b> · {proxima.valor}</p>}
                {mesAnterior !== null && (
                  <p className="text-xs text-neutral-500">Mês anterior: {mesAnterior} contratos · variação {contratos - mesAnterior >= 0 ? "+" : ""}{contratos - mesAnterior}</p>
                )}
              </CardContent>
            </Card>

            <div>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><Trophy className="h-5 w-5 text-yellow-600" /> Faixas de comissão</h2>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {FAIXAS.map((faixa) => {
                  const atual = contratos >= faixa.min && contratos <= faixa.max;
                  return (
                    <Card key={faixa.range} className={atual ? "border-yellow-500 bg-yellow-50 ring-2 ring-yellow-300" : ""}>
                      <CardContent className="space-y-1 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold">{faixa.range}</p>
                          {atual && <Badge className="bg-yellow-500 text-black">Faixa atual</Badge>}
                        </div>
                        <p className="text-xs text-neutral-500">{faixa.pct}</p>
                        <p className="text-sm font-bold text-yellow-700">{faixa.valor}</p>
                        <p className="text-xs text-neutral-500">{faixa.desc}</p>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>

            <Card>
              <CardHeader><CardTitle>Exemplos de ganho mensal</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contratos</TableHead>
                      <TableHead>Fixo</TableHead>
                      <TableHead>Comissão</TableHead>
                      <TableHead>Bônus</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {EXEMPLOS.map((contrato) => {
                      const comissao = calcularComissaoContratos(contrato);
                      const bonus = calcularBonus(contrato);
                      return (
                        <TableRow key={contrato}>
                          <TableCell className="font-medium">{contrato}</TableCell>
                          <TableCell>{formatMoney(SALARIO_FIXO_VENDEDOR)}</TableCell>
                          <TableCell>{formatMoney(comissao)}</TableCell>
                          <TableCell>{formatMoney(bonus)}</TableCell>
                          <TableCell className="text-right font-bold">{formatMoney(SALARIO_FIXO_VENDEDOR + comissao + bonus)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-600" /> Regras de proteção e qualidade</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm text-neutral-500">
                <p>1. Comissão só é paga após a primeira parcela ser quitada.</p>
                <p>2. Contratos cancelados em até 90 dias geram clawback.</p>
                <p>3. Reset mensal todo dia 1º.</p>
                <p>4. Vendedor novo pode ter meta reduzida nos primeiros 60 dias, quando cadastrada pelo admin.</p>
                <p>5. Se mais de 20% dos contratos cancelarem em 90 dias, o bônus do mês seguinte pode ser bloqueado.</p>
                <p>6. Reserva técnica de 15% da comissão fica retida por 60 dias.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Histórico mensal</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {historico.length === 0 && <Aviso titulo="Nenhum histórico encontrado" descricao="Quando houver performance registrada, ela aparecerá aqui." />}
                {historico.map((item) => {
                  const progresso = Math.min(100, Math.round((Number(item.contracts_activated ?? 0) / metaOperacional) * 100));
                  return (
                    <div key={item.id}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span>{String(item.month).padStart(2, "0")}/{item.year} - {item.contracts_activated} contratos</span>
                        <span>{progresso}%</span>
                      </div>
                      <Progress value={progresso} />
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function Aviso({ titulo, descricao, erro = false }: { titulo: string; descricao: string; erro?: boolean }) {
  return (
    <div className={`rounded-2xl border p-6 text-center ${erro ? "border-red-200 bg-red-50 text-red-800" : "border-dashed border-neutral-200 bg-white text-neutral-500"}`}>
      <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-white">
        <AlertCircle className={`h-4 w-4 ${erro ? "text-red-600" : "text-neutral-400"}`} />
      </div>
      <p className="font-bold">{titulo}</p>
      <p className="mt-1 text-sm">{descricao}</p>
    </div>
  );
}
