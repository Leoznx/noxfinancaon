import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, RefreshCw, Target, Trophy, Users, Video } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { calcularGanhoTotal, getNivelComissaoVendedor } from "@/lib/comissao-vendedor";
import { fetchMySellerMonthlyProgress, type SellerMonthlyProgress } from "@/lib/seller-progress";
import { formatMoney } from "@/lib/vendedor-portal";

export const Route = createFileRoute("/vendedor/metas")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin"]} moduleKey="metas">
      <Metas />
    </ProtectedRoute>
  ),
});

const MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function Metas() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const [progress, setProgress] = useState<SellerMonthlyProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro("");
    try {
      setProgress(await fetchMySellerMonthlyProgress(month, year));
    } catch (error: any) {
      setErro(error.message || "Não foi possível carregar suas metas.");
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => {
    void carregar();
    const refresh = () => void carregar();
    const channel = supabase
      .channel("seller-monthly-goals")
      .on("postgres_changes", { event: "*", schema: "public", table: "seller_goals" }, refresh)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_appointments" },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_client_partnerships" },
        refresh,
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "apolices" }, refresh)
      .subscribe();
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      void supabase.removeChannel(channel);
    };
  }, [carregar]);

  const contracts = progress?.contracts_closed ?? 0;
  const ganho = useMemo(() => calcularGanhoTotal(contracts), [contracts]);
  const nivel = useMemo(() => getNivelComissaoVendedor(contracts), [contracts]);
  const hasGoals =
    progress?.target_meetings != null &&
    progress?.target_clients != null &&
    progress?.target_contracts != null;

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
              <p className="text-sm font-medium text-neutral-500">
                Resultados automáticos de {MONTHS[month - 1]} definidos pela Equipe NOX.
              </p>
            </div>
          </div>
          <Button variant="outline" className="gap-2" onClick={carregar} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        </div>

        {erro && <Estado titulo="Não foi possível carregar suas metas" descricao={erro} erro />}
        {loading ? (
          <Estado
            titulo="Carregando metas..."
            descricao="Contabilizando agenda, clientes e contratos em tempo real."
          />
        ) : (
          !erro &&
          progress && (
            <>
              {!hasGoals && (
                <Estado
                  titulo="Metas ainda não definidas"
                  descricao="O administrador precisa definir as três metas do mês na aba Metas da Equipe NOX."
                />
              )}

              <div className="grid gap-4 lg:grid-cols-3">
                <GoalCard
                  icon={Video}
                  label="Reuniões realizadas"
                  current={progress.meetings_completed}
                  target={progress.target_meetings}
                />
                <GoalCard
                  icon={Users}
                  label="Clientes cadastrados"
                  current={progress.clients_registered}
                  target={progress.target_clients}
                />
                <GoalCard
                  icon={Trophy}
                  label="Contratos fechados"
                  current={progress.contracts_closed}
                  target={progress.target_contracts}
                />
              </div>

              <Card className="overflow-hidden border-yellow-300 bg-gradient-to-br from-yellow-50 to-white">
                <CardContent className="grid gap-5 p-6 lg:grid-cols-[1fr_auto] lg:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-neutral-700">
                        {formatMoney(nivel.valorPorProximoContrato)} por próximo contrato
                      </span>
                    </div>
                    <p className="mt-3 text-lg font-black text-neutral-950">{nivel.mensagem}</p>
                    <p className="mt-1 text-sm text-neutral-500">
                      A contagem considera os contratos fechados pelos clientes que você cadastrou.
                    </p>
                  </div>
                  <div className="rounded-2xl bg-neutral-950 p-5 text-white lg:min-w-64">
                    <p className="text-xs font-black uppercase tracking-widest text-neutral-400">
                      Comissões do mês
                    </p>
                    <p className="mt-1 text-3xl font-black text-yellow-300">
                      {formatMoney(ganho.total)}
                    </p>
                    <p className="mt-2 text-xs text-neutral-300">
                      Comissão {formatMoney(ganho.comissao)} + bônus {formatMoney(ganho.bonus)}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Faixas e bônus cumulativos</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-3">
                  <Tier
                    title="1º ao 15º contrato"
                    value="R$ 35 cada"
                    bonus="No 15º: + R$ 400"
                    active={contracts <= 15}
                  />
                  <Tier
                    title="16º ao 25º contrato"
                    value="R$ 55 cada"
                    bonus="No 30º: + R$ 600"
                    active={contracts >= 16 && contracts <= 25}
                  />
                  <Tier
                    title="A partir do 26º"
                    value="R$ 75 cada"
                    bonus="Acima de 45: + R$ 1.200"
                    active={contracts >= 26}
                  />
                </CardContent>
              </Card>
            </>
          )
        )}
      </div>
    </DashboardLayout>
  );
}

function GoalCard({
  icon: Icon,
  label,
  current,
  target,
}: {
  icon: typeof Target;
  label: string;
  current: number;
  target: number | null;
}) {
  const percentage = target && target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const remaining = target == null ? null : Math.max(0, target - current);
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <Icon className="h-5 w-5 text-yellow-700" />
          <span className="text-xs font-black text-neutral-400">{percentage}%</span>
        </div>
        <div>
          <p className="text-sm font-bold text-neutral-600">{label}</p>
          <p className="text-3xl font-black text-neutral-950">
            {current} <span className="text-base text-neutral-400">/ {target ?? "—"}</span>
          </p>
        </div>
        <Progress value={percentage} className="h-2" />
        <p className="text-xs text-neutral-500">
          {remaining == null
            ? "Aguardando definição do admin"
            : remaining > 0
              ? `Faltam ${remaining}`
              : "Meta atingida. Continue superando!"}
        </p>
      </CardContent>
    </Card>
  );
}

function Tier({
  title,
  value,
  bonus,
  active,
}: {
  title: string;
  value: string;
  bonus: string;
  active: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${active ? "border-yellow-400 bg-yellow-50 ring-2 ring-yellow-200" : "border-neutral-200"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-black text-neutral-950">{title}</p>
        {active && <Badge className="bg-yellow-500 text-black">Atual</Badge>}
      </div>
      <p className="mt-2 text-lg font-black text-yellow-700">{value}</p>
      <p className="text-xs text-neutral-500">{bonus}</p>
    </div>
  );
}

function Estado({
  titulo,
  descricao,
  erro = false,
}: {
  titulo: string;
  descricao: string;
  erro?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-6 text-center ${erro ? "border-red-200 bg-red-50 text-red-800" : "border-dashed border-neutral-200 bg-white text-neutral-500"}`}
    >
      <AlertCircle
        className={`mx-auto mb-2 h-4 w-4 ${erro ? "text-red-600" : "text-neutral-400"}`}
      />
      <p className="font-bold">{titulo}</p>
      <p className="mt-1 text-sm">{descricao}</p>
    </div>
  );
}
