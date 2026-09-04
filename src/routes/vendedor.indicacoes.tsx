import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Gift, Link2, MessageCircle, Plus, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/lib/vendedor-portal";
import { maskPhone } from "@/utils/validators";

export const Route = createFileRoute("/vendedor/indicacoes")({
  component: () => (
    <ProtectedRoute roles={["vendedor"]} sellerTypes={["sdr"]}>
      <SellerReferralPage />
    </ProtectedRoute>
  ),
});

type Invite = {
  id: string;
  invitee_name: string;
  invitee_phone: string;
  token: string;
  status: string;
  registered_at: string | null;
  created_at: string;
};
type Reward = { invite_id: string; amount: number; status: string };

function SellerReferralPage() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [inviteResult, rewardResult] = await Promise.all([
      supabase.from("seller_referral_invites" as any).select("id,invitee_name,invitee_phone,token,status,registered_at,created_at").order("created_at", { ascending: false }),
      supabase.from("seller_referral_rewards" as any).select("invite_id,amount,status"),
    ]);
    if (inviteResult.error || rewardResult.error) {
      toast.error(inviteResult.error?.message || rewardResult.error?.message || "Não foi possível carregar as indicações.");
    } else {
      setInvites(((inviteResult.data as any[]) ?? []) as Invite[]);
      setRewards(((rewardResult.data as any[]) ?? []) as Reward[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createInvite() {
    if (name.trim().length < 3 || phone.replace(/\D/g, "").length < 10) {
      toast.error("Informe o nome completo e um telefone válido.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("create_my_sdr_referral_invite" as any, {
      p_name: name.trim(), p_phone: phone,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Link individual liberado.");
    setName(""); setPhone("");
    await load();
  }

  const totals = useMemo(() => ({
    contracts: rewards.length,
    available: rewards.filter((item) => item.status === "disponivel").reduce((sum, item) => sum + Number(item.amount), 0),
    paid: rewards.filter((item) => item.status === "paga").reduce((sum, item) => sum + Number(item.amount), 0),
  }), [rewards]);

  function inviteLink(token: string) {
    const origin = typeof window === "undefined" ? "https://noxfianca.com" : window.location.origin;
    return `${origin}/cadastro?sr=${token}`;
  }

  async function copy(link: string) {
    await navigator.clipboard.writeText(link);
    toast.success("Link individual copiado.");
  }

  return (
    <DashboardLayout>
      <main className="space-y-5">
        <section className="overflow-hidden rounded-[22px] bg-neutral-950 p-5 text-white shadow-lg sm:p-7">
          <Badge className="border-0 bg-yellow-400 text-neutral-950"><Gift className="mr-1.5 h-4 w-4" />Plano de indicação SDR</Badge>
          <h1 className="mt-4 text-3xl font-black tracking-tight">Organize seus indicadores e acompanhe <span className="text-yellow-400">R$ 50 por contrato</span></h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-300">Cadastre primeiro o nome e o telefone da pessoa que fará a indicação. O link gerado é exclusivo, vincula os cadastros ao seu perfil de SDR e libera R$ 50,00 para o indicador por contrato após o pagamento da segunda parcela.</p>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <Summary icon={Users} label="Pessoas indicadas" value={String(invites.length)} />
          <Summary icon={Gift} label="Contratos elegíveis" value={String(totals.contracts)} />
          <Summary icon={Link2} label="Devido aos indicadores" value={formatMoney(totals.available)} hint={`${formatMoney(totals.paid)} já pagos`} />
        </section>

        <Card className="border-yellow-300 bg-yellow-50/40">
          <CardContent className="p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
              <div className="flex-1"><label className="mb-1.5 block text-xs font-bold">Nome completo do indicado</label><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome do corretor ou responsável" /></div>
              <div className="flex-1"><label className="mb-1.5 block text-xs font-bold">Telefone / WhatsApp</label><Input value={phone} onChange={(event) => setPhone(maskPhone(event.target.value))} placeholder="(00) 00000-0000" /></div>
              <Button className="bg-neutral-950 text-white hover:bg-neutral-800" onClick={() => void createInvite()} disabled={saving}><Plus className="mr-2 h-4 w-4" />{saving ? "Gerando..." : "Cadastrar e gerar link"}</Button>
            </div>
          </CardContent>
        </Card>

        <section>
          <div className="mb-3 flex items-center justify-between"><div><h2 className="text-xl font-black">Links individuais</h2><p className="text-sm text-neutral-500">Um cadastro e um histórico separado para cada pessoa.</p></div><Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button></div>
          {loading ? <div className="h-40 animate-pulse rounded-2xl bg-neutral-100" /> : invites.length === 0 ? <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-500">Cadastre o primeiro indicado para liberar o link particular.</div> : <div className="grid gap-3 lg:grid-cols-2">{invites.map((invite) => {
            const link = inviteLink(invite.token);
            const inviteRewards = rewards.filter((reward) => reward.invite_id === invite.id);
            return <article key={invite.id} className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate font-black text-neutral-950">{invite.invitee_name}</h3><p className="text-sm text-neutral-500">{invite.invitee_phone}</p></div><Badge className={invite.status === "cadastrado" ? "bg-emerald-100 text-emerald-800" : "bg-yellow-100 text-yellow-800"}>{invite.status === "cadastrado" ? "Cadastro concluído" : "Aguardando cadastro"}</Badge></div><div className="mt-3 rounded-xl bg-neutral-50 p-3"><p className="truncate font-mono text-xs text-neutral-600">{link}</p><p className="mt-2 text-xs font-semibold text-neutral-500">{inviteRewards.length} contrato(s) · {formatMoney(inviteRewards.reduce((sum, item) => sum + Number(item.amount), 0))}</p></div><div className="mt-3 flex gap-2"><Button variant="outline" size="sm" className="flex-1" onClick={() => void copy(link)}><Copy className="mr-2 h-4 w-4" />Copiar</Button><Button size="sm" className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700" asChild><a href={`https://wa.me/?text=${encodeURIComponent(`Olá, ${invite.invitee_name}! Faça seu cadastro na NOX Fiança por este link exclusivo: ${link}`)}`} target="_blank" rel="noreferrer"><MessageCircle className="mr-2 h-4 w-4" />WhatsApp</a></Button></div></article>;
          })}</div>}
        </section>
      </main>
    </DashboardLayout>
  );
}

function Summary({ icon: Icon, label, value, hint }: { icon: typeof Users; label: string; value: string; hint?: string }) {
  return <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm"><Icon className="h-5 w-5 text-yellow-600" /><p className="mt-3 text-xs font-bold text-neutral-500">{label}</p><p className="text-2xl font-black text-neutral-950">{value}</p>{hint && <p className="mt-1 text-xs text-neutral-400">{hint}</p>}</div>;
}
