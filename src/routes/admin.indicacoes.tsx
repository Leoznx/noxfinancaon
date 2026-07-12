import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Search, CheckCircle2, XCircle, Ban, DollarSign } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/indicacoes")({
  component: () => (
    <ProtectedRoute roles={["admin", "analista"]} moduleKey="indicacoes">
      <AdminIndicacoesPage />
    </ProtectedRoute>
  ),
});

const brl = (n: number) => `R$ ${Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

function AdminIndicacoesPage() {
  const [linhas, setLinhas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<string>("todos");
  const [adminId, setAdminId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [motivo, setMotivo] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("referrals")
      .select("*, referrer:profiles!referrals_referrer_user_id_fkey(nome,email,role), referred:profiles!referrals_referred_user_id_fkey(nome,email,role)")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) toast.error("Erro ao carregar indicações");
    else setLinhas(data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    supabase.auth.getUser().then(({ data }) => setAdminId(data.user?.id ?? null));
  }, []);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhas.filter(r => {
      if (status !== "todos" && r.reward_status !== status) return false;
      if (!q) return true;
      return (
        (r.referrer?.nome ?? "").toLowerCase().includes(q) ||
        (r.referrer?.email ?? "").toLowerCase().includes(q) ||
        (r.referred?.nome ?? "").toLowerCase().includes(q) ||
        (r.referred_email ?? "").toLowerCase().includes(q) ||
        (r.referral_code ?? "").toLowerCase().includes(q)
      );
    });
  }, [linhas, busca, status]);

  const aprovar = async (r: any) => {
    const { error: e1 } = await supabase.from("referrals").update({
      reward_status: "liberada", approved_by: adminId, approved_at: new Date().toISOString()
    }).eq("id", r.id);
    if (e1) { toast.error("Erro ao aprovar"); return; }
    await supabase.from("referral_rewards").upsert({
      user_id: r.referrer_user_id, referral_id: r.id, amount: r.reward_amount,
      status: "disponivel", available_at: new Date().toISOString()
    }, { onConflict: "referral_id" });
    toast.success("Recompensa liberada");
    load();
  };

  const reprovar = async () => {
    if (!rejecting) return;
    if (!motivo.trim()) { toast.error("Motivo obrigatório"); return; }
    const { error } = await supabase.from("referrals").update({
      reward_status: "recusada", rejected_by: adminId, rejected_at: new Date().toISOString(), rejection_reason: motivo
    }).eq("id", rejecting.id);
    if (error) toast.error("Erro ao recusar");
    else { toast.success("Indicação recusada"); setRejecting(null); setMotivo(""); load(); }
  };

  const marcarPaga = async (r: any) => {
    await supabase.from("referrals").update({ reward_status: "paga", paid_at: new Date().toISOString() }).eq("id", r.id);
    await supabase.from("referral_rewards").update({ status: "paga", paid_at: new Date().toISOString() }).eq("referral_id", r.id);
    toast.success("Marcada como paga");
    load();
  };

  const bloquear = async (r: any) => {
    await supabase.from("referrals").update({ fraud_status: "bloqueado", reward_status: "cancelada" }).eq("id", r.id);
    toast.success("Indicação bloqueada");
    load();
  };

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Indicações</h1>
          <p className="text-neutral-500 mt-2">Controle total do programa de indicação: aprovar, pagar, bloquear e auditar.</p>
        </div>

        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Indicador, indicado, e-mail ou código..." className="pl-10 h-11" />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-56 h-11"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="aguardando_contrato">Aguardando contrato</SelectItem>
              <SelectItem value="em_analise">Em análise</SelectItem>
              <SelectItem value="liberada">Liberadas</SelectItem>
              <SelectItem value="paga">Pagas</SelectItem>
              <SelectItem value="recusada">Recusadas</SelectItem>
              <SelectItem value="cancelada">Canceladas</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-sm">
          <Table>
            <TableHeader className="bg-neutral-50">
              <TableRow>
                <TableHead className="px-6">Indicador</TableHead>
                <TableHead>Indicado</TableHead>
                <TableHead>Cadastro</TableHead>
                <TableHead>1º Contrato</TableHead>
                <TableHead>Recompensa</TableHead>
                <TableHead>Antifraude</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead className="pr-6 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-16 text-neutral-400">Carregando...</TableCell></TableRow>
              ) : !filtradas.length ? (
                <TableRow><TableCell colSpan={8} className="text-center py-16 text-neutral-500">Nenhuma indicação encontrada.</TableCell></TableRow>
              ) : filtradas.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="px-6">
                    <p className="font-semibold">{r.referrer?.nome ?? "—"}</p>
                    <p className="text-xs text-neutral-500 uppercase">{r.referrer_role ?? r.referrer?.role}</p>
                  </TableCell>
                  <TableCell>
                    <p className="font-semibold">{r.referred?.nome ?? r.referred_email ?? "—"}</p>
                    <p className="text-xs text-neutral-500">{r.referred?.email ?? r.referred_email}</p>
                  </TableCell>
                  <TableCell className="text-xs">{r.signup_at ? new Date(r.signup_at).toLocaleDateString("pt-BR") : "—"}</TableCell>
                  <TableCell className="text-xs">{r.first_contract_at ? new Date(r.first_contract_at).toLocaleDateString("pt-BR") : "—"}</TableCell>
                  <TableCell><RewardBadge status={r.reward_status} /></TableCell>
                  <TableCell><FraudBadge status={r.fraud_status} /></TableCell>
                  <TableCell className="font-semibold">{brl(r.reward_amount)}</TableCell>
                  <TableCell className="pr-6 text-right space-x-1">
                    {r.reward_status === "em_analise" && (
                      <Button size="sm" variant="ghost" className="text-emerald-700" title="Aprovar" onClick={() => aprovar(r)}><CheckCircle2 size={14} /></Button>
                    )}
                    {(r.reward_status === "em_analise" || r.reward_status === "aguardando_contrato") && (
                      <Button size="sm" variant="ghost" className="text-red-700" title="Recusar" onClick={() => { setRejecting(r); setMotivo(""); }}><XCircle size={14} /></Button>
                    )}
                    {r.reward_status === "liberada" && (
                      <Button size="sm" variant="ghost" className="text-emerald-700" title="Marcar paga" onClick={() => marcarPaga(r)}><DollarSign size={14} /></Button>
                    )}
                    {r.fraud_status !== "bloqueado" && (
                      <Button size="sm" variant="ghost" className="text-neutral-700" title="Bloquear" onClick={() => bloquear(r)}><Ban size={14} /></Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Recusar indicação</DialogTitle></DialogHeader>
          <div className="space-y-2 py-4">
            <Label>Motivo</Label>
            <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={4} placeholder="Autoindicação, usuário já cadastrado, contrato cancelado, suspeita de fraude..." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>Cancelar</Button>
            <Button className="bg-red-600 hover:bg-red-700" onClick={reprovar}>Recusar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

function RewardBadge({ status }: { status: string }) {
  const map: Record<string, { c: string; t: string }> = {
    aguardando_contrato: { c: "bg-neutral-100 text-neutral-700", t: "Aguardando" },
    consulta_iniciada: { c: "bg-blue-100 text-blue-700", t: "Consulta" },
    em_analise: { c: "bg-amber-100 text-amber-700", t: "Análise" },
    liberada: { c: "bg-emerald-100 text-emerald-700", t: "Liberada" },
    paga: { c: "bg-emerald-200 text-emerald-800", t: "Paga" },
    recusada: { c: "bg-red-100 text-red-700", t: "Recusada" },
    cancelada: { c: "bg-neutral-200 text-neutral-700", t: "Cancelada" },
  };
  const v = map[status] ?? { c: "bg-neutral-100", t: status };
  return <Badge className={v.c}>{v.t}</Badge>;
}

function FraudBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    aprovado: "bg-emerald-50 text-emerald-700 border-emerald-200",
    em_analise: "bg-amber-50 text-amber-700 border-amber-200",
    suspeito: "bg-orange-50 text-orange-700 border-orange-200",
    bloqueado: "bg-red-50 text-red-700 border-red-200",
  };
  return <Badge variant="outline" className={map[status] ?? ""}>{status}</Badge>;
}
