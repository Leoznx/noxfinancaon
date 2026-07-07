import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Gift, Copy, MessageCircle, Mail, Rocket, Users, TrendingUp, Wallet, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/AuthProvider";

export const Route = createFileRoute("/indicacao")({
  component: () => (
    <ProtectedRoute roles={["corretor", "imobiliaria", "proprietario"]}>
      <IndicacaoPage />
    </ProtectedRoute>
  ),
});

const brl = (n: number) => `R$ ${Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
const SITE_BASE = "https://www.noxfianca.com";

function IndicacaoPage() {
  const { user } = useAuth();
  const mostrarAvisoVinculo = user?.role === "corretor" || user?.role === "imobiliaria";
  const [profileId, setProfileId] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [referrals, setReferrals] = useState<any[]>([]);
  const [rewards, setRewards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const link = useMemo(() => code ? `${SITE_BASE}/cadastro?ref=${code}` : "", [code]);

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) { setLoading(false); return; }
      setProfileId(uid);

      const { data: profile } = await supabase.from("profiles").select("referral_code").eq("id", uid).maybeSingle();
      let c = profile?.referral_code;
      if (!c) {
        const { data: gen } = await supabase.rpc("generate_referral_code", { _profile_id: uid });
        if (gen) {
          await supabase.from("profiles").update({ referral_code: gen }).eq("id", uid);
          c = gen as string;
        }
      }
      setCode(c ?? null);

      const [ref, rew] = await Promise.all([
        supabase.from("referrals").select("*, referred:profiles!referrals_referred_user_id_fkey(nome,email,role)").eq("referrer_user_id", uid).order("created_at", { ascending: false }),
        supabase.from("referral_rewards").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
      ]);
      setReferrals(ref.data ?? []);
      setRewards(rew.data ?? []);
      setLoading(false);
    })();
  }, []);

  const copiar = () => {
    if (!link) return;
    navigator.clipboard.writeText(link);
    toast.success("Link copiado com sucesso.");
  };

  const compartilharWhats = () => {
    const msg = `Olá! Estou te indicando a NOX Fiança. Cadastre-se pelo meu link e conheça uma solução simples para garantia locatícia: ${link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const compartilharEmail = () => {
    const subj = "Conheça a NOX Fiança";
    const body = `Olá! Estou te indicando a NOX Fiança. Cadastre-se pelo meu link: ${link}`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
  };

  const convertidos = referrals.filter(r => r.first_contract_id).length;
  const totalLiberado = rewards.filter(r => r.status === "disponivel").reduce((s, r) => s + Number(r.amount), 0);
  const totalPago = rewards.filter(r => r.status === "paga").reduce((s, r) => s + Number(r.amount), 0);
  const totalPendente = rewards.filter(r => r.status === "pendente").reduce((s, r) => s + Number(r.amount), 0);

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {/* Banner */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-neutral-900 via-neutral-900 to-neutral-800 p-8 md:p-12 text-white">
          <div className="absolute -top-10 -right-10 w-64 h-64 bg-yellow-400/10 rounded-full blur-3xl" />
          <div className="relative space-y-4">
            <Badge className="bg-yellow-400 text-neutral-900 border-0 gap-1.5"><Rocket size={14} /> Programa de Indicação</Badge>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight">Indique e ganhe <span className="text-yellow-400">R$ 50,00</span></h1>
            <p className="text-neutral-300 text-lg max-w-2xl">Compartilhe seu link exclusivo. Quando seu indicado fechar o primeiro contrato com sucesso, sua recompensa é liberada.</p>

            <div className="bg-white/10 backdrop-blur border border-white/20 rounded-xl p-4 mt-6 max-w-2xl">
              <p className="text-xs font-bold text-yellow-400 uppercase tracking-widest mb-2">Seu link exclusivo</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input value={link} readOnly className="bg-neutral-950/50 border-white/20 text-white font-mono text-sm" />
                <Button onClick={copiar} className="bg-yellow-400 text-neutral-900 hover:bg-yellow-500 gap-2 shrink-0"><Copy size={16} /> Copiar link</Button>
              </div>
              <div className="flex gap-2 mt-3">
                <Button onClick={compartilharWhats} variant="outline" className="bg-transparent border-white/30 text-white hover:bg-white/10 gap-2 flex-1"><MessageCircle size={16} /> WhatsApp</Button>
                <Button onClick={compartilharEmail} variant="outline" className="bg-transparent border-white/30 text-white hover:bg-white/10 gap-2 flex-1"><Mail size={16} /> E-mail</Button>
              </div>
            </div>
          </div>
        </div>

        {mostrarAvisoVinculo && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex gap-3">
            <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={20} />
            <div className="text-sm text-amber-900">
              <p className="font-bold mb-1">Indicações não válidas</p>
              <p className="text-amber-800">
                Não serão consideradas indicações para você mesmo, para a {user?.role === "corretor" ? "imobiliária à qual você está vinculado" : "sua própria imobiliária"}
                {user?.role === "imobiliaria" ? " nem para corretores já vinculados a ela" : " nem para outros corretores vinculados à mesma imobiliária"}.
                A recompensa só é liberada para indicados sem qualquer vínculo prévio com a sua conta.
              </p>
            </div>
          </div>
        )}

        {/* Cards de resumo */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <ResumoCard icone={<Users size={20} />} titulo="Indicados" valor={String(referrals.length)} />
          <ResumoCard icone={<TrendingUp size={20} />} titulo="Convertidos" valor={String(convertidos)} cor="text-emerald-600" />
          <ResumoCard icone={<Gift size={20} />} titulo="Liberado" valor={brl(totalLiberado)} cor="text-emerald-600" />
          <ResumoCard icone={<Wallet size={20} />} titulo="Pago" valor={brl(totalPago)} cor="text-neutral-700" />
        </div>

        {/* Como funciona */}
        <div className="bg-white border border-neutral-200 rounded-xl p-6">
          <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-500 mb-4">Como funciona</h3>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { n: 1, t: "Compartilhe seu link", d: "Envie para corretores, imobiliárias e proprietários." },
              { n: 2, t: "Seu indicado se cadastra", d: "Ele cria conta usando seu link exclusivo." },
              { n: 3, t: "Você ganha R$ 50,00", d: "Recompensa liberada após o primeiro contrato aprovado." },
            ].map(p => (
              <div key={p.n} className="flex gap-3">
                <div className="w-9 h-9 rounded-full bg-yellow-400 text-neutral-900 flex items-center justify-center font-bold shrink-0">{p.n}</div>
                <div>
                  <p className="font-bold">{p.t}</p>
                  <p className="text-sm text-neutral-500">{p.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Lista de indicados */}
        <div>
          <h2 className="text-xl font-bold mb-4">Meus indicados</h2>
          {loading ? (
            <div className="border border-neutral-200 rounded-xl bg-white py-16 text-center text-neutral-400">Carregando...</div>
          ) : !referrals.length ? (
            <div className="border border-dashed border-neutral-300 rounded-xl bg-white py-16 text-center text-neutral-500">
              Você ainda não indicou ninguém. Copie seu link e comece agora.
            </div>
          ) : (
            <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-sm">
              <Table>
                <TableHeader className="bg-neutral-50">
                  <TableRow>
                    <TableHead className="px-6">Indicado</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Cadastro</TableHead>
                    <TableHead>1º Contrato</TableHead>
                    <TableHead>Recompensa</TableHead>
                    <TableHead className="pr-6 text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {referrals.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="px-6">
                        <p className="font-semibold">{r.referred?.nome ?? r.referred_email ?? "—"}</p>
                        <p className="text-xs text-neutral-500">{r.referred?.email ?? r.referred_email ?? ""}</p>
                      </TableCell>
                      <TableCell className="text-xs uppercase">{r.referred_role ?? r.referred?.role ?? "—"}</TableCell>
                      <TableCell className="text-xs">{r.signup_at ? new Date(r.signup_at).toLocaleDateString("pt-BR") : "—"}</TableCell>
                      <TableCell className="text-xs">{r.first_contract_at ? new Date(r.first_contract_at).toLocaleDateString("pt-BR") : <span className="text-neutral-400">—</span>}</TableCell>
                      <TableCell><RecompensaBadge status={r.reward_status} /></TableCell>
                      <TableCell className="pr-6 text-right font-semibold">{r.first_contract_id ? brl(r.reward_amount) : brl(0)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {!!totalPendente && (
            <p className="text-xs text-neutral-500 mt-3">Você tem <strong>{brl(totalPendente)}</strong> em recompensas pendentes.</p>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

function ResumoCard({ icone, titulo, valor, cor }: { icone: React.ReactNode; titulo: string; valor: string; cor?: string }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="flex items-center justify-between text-neutral-400">
        <span className="text-xs font-bold uppercase tracking-widest">{titulo}</span>
        {icone}
      </div>
      <p className={`text-2xl font-bold mt-2 ${cor ?? "text-neutral-900"}`}>{valor}</p>
    </div>
  );
}

function RecompensaBadge({ status }: { status: string }) {
  const map: Record<string, { c: string; t: string }> = {
    aguardando_contrato: { c: "bg-neutral-100 text-neutral-700", t: "Aguardando contrato" },
    consulta_iniciada: { c: "bg-blue-100 text-blue-700", t: "Consulta iniciada" },
    em_analise: { c: "bg-amber-100 text-amber-700", t: "Em análise" },
    liberada: { c: "bg-emerald-100 text-emerald-700", t: "Liberada" },
    paga: { c: "bg-emerald-200 text-emerald-800", t: "Paga" },
    recusada: { c: "bg-red-100 text-red-700", t: "Recusada" },
    cancelada: { c: "bg-neutral-200 text-neutral-700", t: "Cancelada" },
  };
  const v = map[status] ?? { c: "bg-neutral-100 text-neutral-700", t: status };
  return <Badge className={v.c}>{v.t}</Badge>;
}
