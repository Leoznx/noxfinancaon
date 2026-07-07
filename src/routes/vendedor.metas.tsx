import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  META_PADRAO_VENDEDOR,
  calcularComissaoContratos,
  calcularBonus,
  calcularGanhoTotal,
  SALARIO_FIXO_VENDEDOR,
} from "@/lib/comissao-vendedor";
import { Target, ShieldCheck, Trophy } from "lucide-react";

export const Route = createFileRoute("/vendedor/metas")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin"]}>
      <Metas />
    </ProtectedRoute>
  ),
});

const FAIXAS = [
  { range: "0 a 9 contratos",   pct: "0–49%",    valor: "R$ 0",        desc: "Sem comissão",                       min: 0,  max: 9 },
  { range: "10 a 13 contratos", pct: "50–69%",   valor: "R$ 25/contrato", desc: "Faixa de aceleração",            min: 10, max: 13 },
  { range: "14 a 19 contratos", pct: "70–99%",   valor: "R$ 35/contrato", desc: "Próximo da meta",                min: 14, max: 19 },
  { range: "20 contratos",      pct: "100%",     valor: "R$ 50/contrato", desc: "Meta + bônus R$ 300",            min: 20, max: 20 },
  { range: "21+ contratos",     pct: "Acima de 100%", valor: "R$ 1.000 + R$ 80 por extra", desc: "Superou a meta", min: 21, max: 29 },
  { range: "30 contratos",      pct: "150%",     valor: "Bônus extra R$ 600", desc: "Top performer",              min: 30, max: 39 },
  { range: "40 contratos",      pct: "200%",     valor: "Bônus extra R$ 1.000", desc: "Lendário",                 min: 40, max: 9999 },
];

const EXEMPLOS = [5, 14, 20, 25, 30, 40];

function Metas() {
  const [contratos, setContratos] = useState(0);
  const [historico, setHistorico] = useState<any[]>([]);
  const [mesAnterior, setMesAnterior] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: iu } = await supabase.from("internal_users" as any)
        .select("id").eq("auth_user_id", user.id).maybeSingle();
      const sid = (iu as any)?.id;
      if (!sid) return;

      const now = new Date();
      const m = now.getMonth() + 1, y = now.getFullYear();
      const { data: perf } = await supabase.from("seller_performance" as any)
        .select("contracts_activated").eq("seller_id", sid).eq("month", m).eq("year", y).maybeSingle();
      setContratos((perf as any)?.contracts_activated ?? 0);

      const pm = m === 1 ? 12 : m - 1;
      const py = m === 1 ? y - 1 : y;
      const { data: prev } = await supabase.from("seller_performance" as any)
        .select("contracts_activated").eq("seller_id", sid).eq("month", pm).eq("year", py).maybeSingle();
      setMesAnterior((prev as any)?.contracts_activated ?? null);

      const { data: hist } = await supabase.from("seller_performance" as any)
        .select("*").eq("seller_id", sid)
        .order("year", { ascending: false }).order("month", { ascending: false }).limit(12);
      setHistorico((hist as any[]) ?? []);
    })();
  }, []);

  const ganho = calcularGanhoTotal(contratos);
  const pct = Math.min(100, Math.round((contratos / META_PADRAO_VENDEDOR) * 100));
  const faltam = Math.max(0, META_PADRAO_VENDEDOR - contratos);
  const proxima = FAIXAS.find((f) => contratos < f.min);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Target className="w-7 h-7 text-yellow-600" />
          <div>
            <h1 className="text-2xl font-bold">Minhas Metas</h1>
            <p className="text-sm text-muted-foreground">Modelo oficial NOX Fiança · comissão escalonada retroativa.</p>
          </div>
        </div>

        <Card className="border-yellow-300 bg-gradient-to-br from-yellow-50 to-white">
          <CardContent className="p-6 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Mês atual</p>
                <p className="text-4xl font-bold">{contratos} / {META_PADRAO_VENDEDOR}</p>
                <p className="text-sm text-yellow-800">{pct}% da meta · {faltam > 0 ? `Faltam ${faltam}` : "Bateu a meta 🎯"}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Ganho total estimado</p>
                <p className="text-3xl font-bold text-yellow-700">R$ {ganho.total.toLocaleString("pt-BR")}</p>
                <p className="text-xs text-muted-foreground">Fixo R$ {SALARIO_FIXO_VENDEDOR.toLocaleString("pt-BR")} + Com. R$ {ganho.comissao.toLocaleString("pt-BR")} + Bônus R$ {ganho.bonus.toLocaleString("pt-BR")}</p>
              </div>
            </div>
            <Progress value={pct} className="h-3" />
            {proxima && (
              <p className="text-sm text-muted-foreground">
                Próxima faixa: <b>{proxima.range}</b> · {proxima.valor}
              </p>
            )}
            {mesAnterior !== null && (
              <p className="text-xs text-muted-foreground">Mês anterior: {mesAnterior} contratos · variação {contratos - mesAnterior >= 0 ? "+" : ""}{contratos - mesAnterior}</p>
            )}
          </CardContent>
        </Card>

        <div>
          <h2 className="text-lg font-bold mb-3 flex items-center gap-2"><Trophy className="w-5 h-5 text-yellow-600" /> Faixas de comissão</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {FAIXAS.map((f) => {
              const atual = contratos >= f.min && contratos <= f.max;
              return (
                <Card key={f.range} className={atual ? "border-yellow-500 ring-2 ring-yellow-300 bg-yellow-50" : ""}>
                  <CardContent className="p-4 space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold">{f.range}</p>
                      {atual && <Badge className="bg-yellow-500 text-black">Faixa atual</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{f.pct}</p>
                    <p className="text-sm font-bold text-yellow-700">{f.valor}</p>
                    <p className="text-xs text-muted-foreground">{f.desc}</p>
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
                {EXEMPLOS.map((c) => {
                  const com = calcularComissaoContratos(c);
                  const bon = calcularBonus(c);
                  return (
                    <TableRow key={c}>
                      <TableCell className="font-medium">{c}</TableCell>
                      <TableCell>R$ {SALARIO_FIXO_VENDEDOR.toLocaleString("pt-BR")}</TableCell>
                      <TableCell>R$ {com.toLocaleString("pt-BR")}</TableCell>
                      <TableCell>R$ {bon.toLocaleString("pt-BR")}</TableCell>
                      <TableCell className="text-right font-bold">R$ {(SALARIO_FIXO_VENDEDOR + com + bon).toLocaleString("pt-BR")}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-600" /> Regras de proteção e qualidade</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1 text-muted-foreground">
            <p>1. Comissão só é paga após a primeira parcela ser quitada.</p>
            <p>2. Contratos cancelados em até 90 dias geram clawback.</p>
            <p>3. Reset mensal todo dia 1º.</p>
            <p>4. Vendedor novo tem meta reduzida nos primeiros 60 dias.</p>
            <p>5. Se mais de 20% dos contratos cancelarem em 90 dias, perde o bônus do mês seguinte.</p>
            <p>6. Reserva técnica de 15% da comissão fica retida por 60 dias.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Histórico mensal</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {historico.length === 0 && <p className="text-sm text-muted-foreground">Sem histórico ainda.</p>}
            {historico.map((h) => {
              const p = Math.min(100, Math.round((h.contracts_activated / META_PADRAO_VENDEDOR) * 100));
              return (
                <div key={h.id}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{String(h.month).padStart(2, "0")}/{h.year} — {h.contracts_activated} contratos</span>
                    <span>{p}%</span>
                  </div>
                  <Progress value={p} />
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
