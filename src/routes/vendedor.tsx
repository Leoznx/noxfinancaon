import { createFileRoute, Link } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  calcularComissaoContratos,
  calcularBonus,
  calcularGanhoTotal,
  META_PADRAO_VENDEDOR,
  RECEITA_LTV_CONTRATO,
} from "@/lib/comissao-vendedor";
import {
  Briefcase, Target, DollarSign, TrendingUp, Users, Trophy, ListChecks,
  CalendarClock, Flame, AlertTriangle, Sparkles, Clock,
} from "lucide-react";

export const Route = createFileRoute("/vendedor")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin"]}>
      <VendedorDashboard />
    </ProtectedRoute>
  ),
});

function VendedorDashboard() {
  const [contratos, setContratos] = useState(12);
  const [leadsNovos, setLeadsNovos] = useState(0);
  const [leadsContato, setLeadsContato] = useState(0);
  const [reunioesHoje, setReunioesHoje] = useState(0);
  const [followUpsAtrasados, setFollowUpsAtrasados] = useState(0);
  const [leadsSemRetorno, setLeadsSemRetorno] = useState(0);
  const [proximas, setProximas] = useState<any[]>([]);
  const [ranking, setRanking] = useState<number | null>(null);
  const [meta, setMeta] = useState(META_PADRAO_VENDEDOR);
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setIsDemo(true); demo(); return; }
      const { data: iu } = await supabase.from("internal_users" as any)
        .select("id").eq("auth_user_id", user.id).maybeSingle();
      const sid = (iu as any)?.id;
      if (!sid) { setIsDemo(true); demo(); return; }

      const now = new Date();
      const m = now.getMonth() + 1, y = now.getFullYear();
      const { data: perf } = await supabase.from("seller_performance" as any)
        .select("contracts_activated").eq("seller_id", sid).eq("month", m).eq("year", y).maybeSingle();
      const c = (perf as any)?.contracts_activated ?? 0;
      setContratos(c);

      const { data: g } = await supabase.from("seller_goals" as any)
        .select("target_contracts").eq("seller_id", sid).eq("month", m).eq("year", y).maybeSingle();
      if ((g as any)?.target_contracts) setMeta((g as any).target_contracts);

      const { count: novos } = await supabase.from("sales_leads" as any)
        .select("id", { count: "exact", head: true }).eq("assigned_seller_id", sid).eq("status", "novo");
      setLeadsNovos(novos ?? 0);
      const { count: contato } = await supabase.from("sales_leads" as any)
        .select("id", { count: "exact", head: true }).eq("assigned_seller_id", sid).eq("status", "em_contato");
      setLeadsContato(contato ?? 0);

      const ini = new Date(); ini.setHours(0, 0, 0, 0);
      const fim = new Date(); fim.setHours(23, 59, 59, 999);
      const { data: ag, count: agC } = await supabase.from("seller_appointments" as any)
        .select("*, sales_leads(full_name)", { count: "exact" })
        .eq("seller_id", sid)
        .gte("scheduled_at", ini.toISOString()).lte("scheduled_at", fim.toISOString())
        .order("scheduled_at");
      setReunioesHoje(agC ?? 0);
      setProximas(((ag as any[]) ?? []).slice(0, 5));

      const { count: atrasados } = await supabase.from("seller_appointments" as any)
        .select("id", { count: "exact", head: true })
        .eq("seller_id", sid).lt("scheduled_at", new Date().toISOString())
        .in("status", ["agendado", "confirmado", "remarcado"]);
      setFollowUpsAtrasados(atrasados ?? 0);

      const dois = new Date(Date.now() - 48 * 3600e3).toISOString();
      const { count: semRet } = await supabase.from("sales_leads" as any)
        .select("id", { count: "exact", head: true })
        .eq("assigned_seller_id", sid).lt("updated_at", dois).in("status", ["novo", "em_contato"]);
      setLeadsSemRetorno(semRet ?? 0);

      const { data: rank } = await supabase.from("seller_performance" as any)
        .select("seller_id, contracts_activated").eq("month", m).eq("year", y)
        .order("contracts_activated", { ascending: false });
      const idx = ((rank as any[]) ?? []).findIndex((r) => r.seller_id === sid);
      setRanking(idx >= 0 ? idx + 1 : null);

      if (c === 0 && (novos ?? 0) === 0) { setIsDemo(true); demo(); }
    })();

    function demo() {
      setContratos(12); setLeadsNovos(4); setLeadsContato(7);
      setReunioesHoje(3); setFollowUpsAtrasados(2); setLeadsSemRetorno(3); setRanking(4);
      setProximas([
        { id: "d1", scheduled_at: new Date(Date.now() + 3600e3).toISOString(), title: "Reunião com João da Silva", sales_leads: { full_name: "João da Silva" } },
        { id: "d2", scheduled_at: new Date(Date.now() + 2 * 3600e3).toISOString(), title: "Retorno para Maria Oliveira", sales_leads: { full_name: "Maria Oliveira" } },
        { id: "d3", scheduled_at: new Date(Date.now() + 5 * 3600e3).toISOString(), title: "Apresentação Carlos Mendes", sales_leads: { full_name: "Carlos Mendes" } },
      ]);
    }
  }, []);

  const ganho = calcularGanhoTotal(contratos);
  const pct = Math.min(100, Math.round((contratos / meta) * 100));
  const faltam = Math.max(0, meta - contratos);
  const receitaLTV = contratos * RECEITA_LTV_CONTRATO;
  const proximaFaixa =
    contratos < 10 ? { n: 10, msg: "R$ 25/contrato" } :
    contratos < 14 ? { n: 14, msg: "R$ 35/contrato" } :
    contratos < 20 ? { n: 20, msg: "R$ 50/contrato + bônus R$ 300" } :
    contratos < 30 ? { n: 30, msg: "bônus extra R$ 600" } :
    contratos < 40 ? { n: 40, msg: "bônus extra R$ 1.000" } : null;

  const alertas: { tipo: "leve" | "forte" | "grave"; msg: string }[] = [];
  if (reunioesHoje > 0) alertas.push({ tipo: "leve", msg: `Você tem ${reunioesHoje} reunião(ões) agendada(s) para hoje.` });
  if (followUpsAtrasados > 0) alertas.push({ tipo: followUpsAtrasados > 5 ? "grave" : followUpsAtrasados > 2 ? "forte" : "leve", msg: `${followUpsAtrasados} follow-up(s) atrasado(s). Priorize esses contatos.` });
  if (leadsSemRetorno > 0) alertas.push({ tipo: leadsSemRetorno > 5 ? "forte" : "leve", msg: `${leadsSemRetorno} lead(s) sem retorno há mais de 48h.` });
  if (faltam > 0 && faltam <= 5) alertas.push({ tipo: "leve", msg: `Faltam ${faltam} contrato(s) para bater sua meta mensal.` });

  const cards = [
    { label: "Leads novos", value: leadsNovos, icon: Users },
    { label: "Leads em contato", value: leadsContato, icon: Users },
    { label: "Reuniões hoje", value: reunioesHoje, icon: CalendarClock },
    { label: "Follow-ups atrasados", value: followUpsAtrasados, icon: AlertTriangle },
    { label: "Contratos ativados", value: contratos, icon: ListChecks },
    { label: "Comissão estimada", value: `R$ ${ganho.comissao.toLocaleString("pt-BR")}`, icon: DollarSign },
    { label: "Bônus do mês", value: `R$ ${ganho.bonus.toLocaleString("pt-BR")}`, icon: Trophy },
    { label: "Ganho total previsto", value: `R$ ${ganho.total.toLocaleString("pt-BR")}`, icon: TrendingUp },
    { label: "Receita LTV gerada", value: `R$ ${receitaLTV.toLocaleString("pt-BR")}`, icon: Sparkles },
    { label: "Posição no ranking", value: ranking ? `#${ranking}` : "—", icon: Trophy },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Briefcase className="w-7 h-7 text-yellow-600" />
            <div>
              <h1 className="text-2xl font-bold">Painel do Vendedor</h1>
              <p className="text-sm text-muted-foreground">
                Acompanhe sua meta, leads, agenda, comissões e receita gerada em tempo real.
              </p>
            </div>
          </div>
          {isDemo && <Badge variant="outline" className="border-amber-400 text-amber-700">Dados de exemplo</Badge>}
        </div>

        {alertas.length > 0 && (
          <div className="space-y-2">
            {alertas.map((a, i) => (
              <div key={i} className={`rounded-lg border p-3 flex items-center gap-3 text-sm ${
                a.tipo === "grave" ? "border-red-300 bg-red-50 text-red-800" :
                a.tipo === "forte" ? "border-orange-300 bg-orange-50 text-orange-800" :
                "border-yellow-300 bg-yellow-50 text-yellow-900"
              }`}>
                <AlertTriangle className="w-4 h-4 shrink-0" /> {a.msg}
              </div>
            ))}
          </div>
        )}

        <Card className="border-yellow-300 bg-gradient-to-br from-yellow-50 to-white">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Performance mensal</p>
                <p className="text-4xl font-bold">{contratos} <span className="text-2xl text-muted-foreground">de {meta} contratos</span></p>
                <p className="text-sm text-yellow-800 mt-1">{pct}% da meta · {faltam > 0 ? `Faltam ${faltam} contratos para bater a meta` : "Meta atingida 🎯"}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Ganho total estimado</p>
                <p className="text-3xl font-bold text-yellow-700">R$ {ganho.total.toLocaleString("pt-BR")}</p>
                <p className="text-xs text-muted-foreground">Fixo R$ {ganho.salarioFixo.toLocaleString("pt-BR")} · Com. R$ {ganho.comissao.toLocaleString("pt-BR")} · Bônus R$ {ganho.bonus.toLocaleString("pt-BR")}</p>
              </div>
            </div>
            <Progress value={pct} className="h-3" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Stat label="Receita LTV gerada" value={`R$ ${receitaLTV.toLocaleString("pt-BR")}`} />
              <Stat label="Comissão estimada" value={`R$ ${ganho.comissao.toLocaleString("pt-BR")}`} />
              <Stat label="Bônus estimado" value={`R$ ${ganho.bonus.toLocaleString("pt-BR")}`} />
              <Stat label="Próximo salto" value={proximaFaixa ? `${proximaFaixa.n} contratos · ${proximaFaixa.msg}` : "Top tier"} />
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {cards.map((c) => (
            <Card key={c.label}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <c.icon className="w-4 h-4" />
                  <span className="text-xs">{c.label}</span>
                </div>
                <p className="text-xl font-bold">{c.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Flame className="w-4 h-4 text-orange-500" /> Próximas ações</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {proximas.length === 0 && <p className="text-sm text-muted-foreground">Nada agendado.</p>}
              {proximas.map((p) => (
                <div key={p.id} className="flex items-center justify-between text-sm border rounded-md p-2">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="font-medium">{p.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(p.scheduled_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                        {p.sales_leads?.full_name && ` · ${p.sales_leads.full_name}`}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
              <Link to="/vendedor/agenda" className="text-xs text-yellow-700 hover:underline inline-block mt-2">Abrir agenda completa →</Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Atalhos</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              {[
                { to: "/vendedor/leads", label: "Meus Leads", icon: Users },
                { to: "/vendedor/pipeline", label: "Pipeline", icon: ListChecks },
                { to: "/vendedor/agenda", label: "Agenda", icon: CalendarClock },
                { to: "/vendedor/metas", label: "Metas", icon: Target },
                { to: "/vendedor/comissoes", label: "Comissões", icon: DollarSign },
                { to: "/vendedor/ranking", label: "Ranking", icon: Trophy },
              ].map((l) => (
                <Link key={l.to} to={l.to as any}
                  className="flex items-center gap-2 p-3 rounded-md border hover:border-yellow-400 hover:bg-yellow-50 transition">
                  <l.icon className="w-4 h-4 text-yellow-600" />
                  <span className="text-sm font-medium">{l.label}</span>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-white border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}
