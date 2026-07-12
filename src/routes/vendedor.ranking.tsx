import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Crown, Medal, RefreshCw, Trophy, Users } from "lucide-react";
import { getSellerContext } from "@/lib/vendedor-portal";

export const Route = createFileRoute("/vendedor/ranking")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin", "financeiro"]} moduleKey="ranking">
      <Ranking />
    </ProtectedRoute>
  ),
});

type LinhaRanking = {
  id: string;
  nome: string;
  contratosFechados: number;
  totalLeads: number;
  emAtendimento: number;
  taxaConversao: number;
};

// Ranking calculado ao vivo a partir de sales_leads (lead status='convertido' =
// contrato fechado) — não depende de seller_performance, que é uma tabela de
// fechamento mensal preenchida só quando alguém clica "Materializar mês" em
// Equipe Comercial (hoje sempre vazia, o que deixava o ranking eternamente em
// branco mesmo com vendedores atendendo leads de verdade).
function Ranking() {
  const [linhas, setLinhas] = useState<LinhaRanking[]>([]);
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");

  async function carregar() {
    setLoading(true);
    setErro("");

    try {
      const context = await getSellerContext();
      setSellerId(context.sellerId);

      // RPC agregada (SECURITY DEFINER) — RLS de sales_leads restringe cada
      // vendedor às próprias linhas, então uma query direta na tabela nunca
      // enxergaria os outros pra montar o ranking. A função só devolve
      // contagens, sem nenhum dado de lead/cliente individual.
      const { data, error } = await supabase.rpc("ranking_vendedores" as any);
      if (error) throw error;

      const computado: LinhaRanking[] = ((data as any[]) ?? []).map((linha) => ({
        id: linha.vendedor_id,
        nome: linha.nome,
        contratosFechados: Number(linha.contratos_fechados ?? 0),
        totalLeads: Number(linha.total_leads ?? 0),
        emAtendimento: Number(linha.em_atendimento ?? 0),
        taxaConversao: Number(linha.total_leads) > 0 ? (Number(linha.contratos_fechados) / Number(linha.total_leads)) * 100 : 0,
      }));
      setLinhas(computado);
    } catch (e: any) {
      setErro(e.message || "Não foi possível carregar o ranking.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { carregar(); }, []);

  const pódio = useMemo(() => linhas.slice(0, 3), [linhas]);
  const restante = useMemo(() => linhas.slice(3), [linhas]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-yellow-100 p-2 text-yellow-700">
              <Trophy className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight text-neutral-950">Ranking</h1>
              <p className="text-sm font-medium text-neutral-500">Quem está fechando mais contratos na equipe comercial.</p>
            </div>
          </div>
          <Button variant="outline" className="gap-2" onClick={carregar} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>

        {erro && <Estado titulo="Não foi possível carregar o ranking" descricao={erro} erro />}

        {loading ? (
          <Estado titulo="Carregando ranking..." descricao="Buscando produção real dos vendedores." />
        ) : !erro && linhas.length === 0 ? (
          <Estado titulo="Nenhum vendedor ativo encontrado" descricao="Quando houver vendedores com leads atribuídos, o ranking aparecerá aqui." />
        ) : !erro && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              {pódio.map((linha, index) => (
                <PodioCard key={linha.id} linha={linha} posicao={index + 1} destaque={linha.id === sellerId} />
              ))}
            </div>

            {restante.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Demais posições</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {restante.map((linha, index) => (
                    <LinhaLista key={linha.id} linha={linha} posicao={index + 4} destaque={linha.id === sellerId} />
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

const PODIO_STYLE: Record<number, { bg: string; icon: any; iconColor: string; label: string }> = {
  1: { bg: "bg-gradient-to-br from-yellow-50 to-yellow-100 border-yellow-300", icon: Crown, iconColor: "text-yellow-600", label: "1º lugar" },
  2: { bg: "bg-gradient-to-br from-neutral-50 to-neutral-100 border-neutral-300", icon: Medal, iconColor: "text-neutral-500", label: "2º lugar" },
  3: { bg: "bg-gradient-to-br from-orange-50 to-orange-100 border-orange-300", icon: Medal, iconColor: "text-orange-600", label: "3º lugar" },
};

function PodioCard({ linha, posicao, destaque }: { linha: LinhaRanking; posicao: number; destaque: boolean }) {
  const estilo = PODIO_STYLE[posicao];
  const Icone = estilo.icon;
  return (
    <Card className={`border-2 ${estilo.bg} ${destaque ? "ring-2 ring-yellow-400" : ""}`}>
      <CardContent className="flex flex-col items-center p-6 text-center">
        <Icone className={`h-8 w-8 ${estilo.iconColor}`} />
        <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-neutral-500">{estilo.label}</p>
        <p className="mt-1 text-lg font-black text-neutral-950">{linha.nome}</p>
        {destaque && <Badge className="mt-1 border-yellow-300 bg-yellow-100 text-yellow-800">Você</Badge>}
        <p className="mt-4 text-3xl font-black text-neutral-950">{linha.contratosFechados}</p>
        <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">contratos fechados</p>
        <div className="mt-4 flex gap-4 text-xs text-neutral-500">
          <span>{linha.totalLeads} leads</span>
          <span>{linha.taxaConversao.toFixed(0)}% conversão</span>
        </div>
      </CardContent>
    </Card>
  );
}

function LinhaLista({ linha, posicao, destaque }: { linha: LinhaRanking; posicao: number; destaque: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 rounded-xl border p-4 ${destaque ? "border-yellow-300 bg-yellow-50" : "border-neutral-100"}`}>
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-sm font-black text-neutral-600">{posicao}</span>
        <div>
          <p className="font-bold text-neutral-950">{linha.nome}{destaque && <Badge className="ml-2 border-yellow-300 bg-yellow-100 text-yellow-800">Você</Badge>}</p>
          <p className="text-xs text-neutral-500">{linha.totalLeads} leads · {linha.emAtendimento} em atendimento</p>
        </div>
      </div>
      <div className="text-right">
        <p className="text-xl font-black text-neutral-950">{linha.contratosFechados}</p>
        <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">fechados</p>
      </div>
    </div>
  );
}

function Estado({ titulo, descricao, erro = false }: { titulo: string; descricao: string; erro?: boolean }) {
  return (
    <div className={`rounded-2xl border p-8 text-center ${erro ? "border-red-200 bg-red-50 text-red-800" : "border-dashed border-neutral-200 bg-white text-neutral-500"}`}>
      {erro ? <AlertCircle className="mx-auto mb-2 h-4 w-4 text-red-600" /> : <Users className="mx-auto mb-2 h-4 w-4 text-neutral-400" />}
      <p className="font-bold">{titulo}</p>
      <p className="mt-1 text-sm">{descricao}</p>
    </div>
  );
}
