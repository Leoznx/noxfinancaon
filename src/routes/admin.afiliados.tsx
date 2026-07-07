import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Handshake, Eye, Check, X, Ban, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/afiliados")({
  component: () => (
    <ProtectedRoute roles={["admin", "analista", "marketing"]}>
      <DashboardLayout>
        <AdminAfiliadosPage />
      </DashboardLayout>
    </ProtectedRoute>
  ),
});

type Affiliate = {
  id: string; user_id: string | null;
  full_name: string; email: string; phone: string;
  partner_type: string; city: string | null; state: string | null;
  works_with_rental: boolean | null; message: string | null;
  status: string; referral_code: string | null; referral_link: string | null;
  approved_at: string | null; rejected_at: string | null; rejection_reason: string | null;
  internal_notes: string | null; created_at: string;
};

const SITE_BASE = "https://www.noxfianca.com";

function genCode(name: string) {
  const base = name.trim().split(/\s+/)[0]?.toUpperCase().replace(/[^A-Z0-9]/g, "") || "PARCEIRO";
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `NOX-${base.slice(0, 12)}-${suffix}`;
}

function AdminAfiliadosPage() {
  const [list, setList] = useState<Affiliate[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Affiliate | null>(null);
  const [rejectFor, setRejectFor] = useState<Affiliate | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("affiliate_applications").select("*").order("created_at", { ascending: false });
    setList((data ?? []) as Affiliate[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const approve = async (a: Affiliate) => {
    const code = a.referral_code ?? genCode(a.full_name);
    const link = `${SITE_BASE}/seja-parceiro?ref=${code}`;
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("affiliate_applications").update({
      status: "aprovado",
      referral_code: code,
      referral_link: link,
      approved_at: new Date().toISOString(),
      approved_by: userData.user?.id ?? null,
    }).eq("id", a.id);
    if (error) { toast.error(error.message); return; }
    // Se houver user_id, atualiza referral_code no profile
    if (a.user_id) {
      await supabase.from("profiles").update({ referral_code: code }).eq("id", a.user_id);
    }
    toast.success("Afiliado aprovado. Link liberado.");
    load();
    if (open?.id === a.id) setOpen({ ...a, status: "aprovado", referral_code: code, referral_link: link });
  };

  const reject = async () => {
    if (!rejectFor) return;
    if (!rejectReason.trim()) { toast.error("Informe o motivo."); return; }
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("affiliate_applications").update({
      status: "recusado",
      rejection_reason: rejectReason,
      rejected_at: new Date().toISOString(),
      rejected_by: userData.user?.id ?? null,
    }).eq("id", rejectFor.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Afiliado recusado.");
    setRejectFor(null); setRejectReason(""); load();
  };

  const block = async (a: Affiliate) => {
    if (!confirm("Bloquear este afiliado?")) return;
    await supabase.from("affiliate_applications").update({ status: "bloqueado" }).eq("id", a.id);
    toast.success("Afiliado bloqueado."); load();
  };

  const copyLink = (link: string) => {
    navigator.clipboard.writeText(link);
    toast.success("Link copiado!");
  };

  const saveNotes = async (id: string, notes: string) => {
    await supabase.from("affiliate_applications").update({ internal_notes: notes }).eq("id", id);
    toast.success("Observações salvas.");
  };

  const statusBadge = (s: string) => {
    const colors: Record<string, string> = {
      pendente: "bg-yellow-500", aprovado: "bg-emerald-500", recusado: "bg-red-500", bloqueado: "bg-neutral-700",
    };
    return <Badge className={colors[s] ?? "bg-neutral-500"}>{s}</Badge>;
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-black tracking-tight flex items-center gap-2"><Handshake size={24} /> Afiliados</h1>
        <p className="text-sm text-neutral-500">Gestão de parceiros e programa de indicação.</p>
      </div>

      <div className="bg-white border rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wider text-neutral-500">
            <tr>
              <th className="p-3">Nome</th><th className="p-3">Contato</th><th className="p-3">Tipo</th>
              <th className="p-3">Cidade/UF</th><th className="p-3">Status</th>
              <th className="p-3">Link</th><th className="p-3">Inscrito em</th><th className="p-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td className="p-6 text-center text-neutral-500" colSpan={8}>Carregando...</td></tr> :
              list.length === 0 ? <tr><td className="p-6 text-center text-neutral-500" colSpan={8}>Nenhuma inscrição.</td></tr> :
              list.map(a => (
                <tr key={a.id} className="border-t hover:bg-neutral-50">
                  <td className="p-3 font-bold">{a.full_name}</td>
                  <td className="p-3 text-xs">{a.email}<div className="text-neutral-500">{a.phone}</div></td>
                  <td className="p-3 capitalize">{a.partner_type}</td>
                  <td className="p-3">{[a.city, a.state].filter(Boolean).join("/") || "—"}</td>
                  <td className="p-3">{statusBadge(a.status)}</td>
                  <td className="p-3 text-xs">
                    {a.referral_link
                      ? <button onClick={() => copyLink(a.referral_link!)} className="text-blue-600 underline inline-flex items-center gap-1"><Copy size={12} /> Copiar</button>
                      : <span className="text-neutral-400">—</span>}
                  </td>
                  <td className="p-3 text-xs text-neutral-500">{new Date(a.created_at).toLocaleDateString("pt-BR")}</td>
                  <td className="p-3">
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setOpen(a)} title="Detalhes"><Eye size={14} /></Button>
                      {a.status === "pendente" && <>
                        <Button size="sm" variant="ghost" className="text-emerald-600" onClick={() => approve(a)} title="Aprovar"><Check size={14} /></Button>
                        <Button size="sm" variant="ghost" className="text-red-600" onClick={() => { setRejectFor(a); setRejectReason(""); }} title="Recusar"><X size={14} /></Button>
                      </>}
                      {a.status === "aprovado" && <Button size="sm" variant="ghost" className="text-neutral-700" onClick={() => block(a)} title="Bloquear"><Ban size={14} /></Button>}
                    </div>
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>

      {/* Modal Detalhes */}
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Detalhes do afiliado</DialogTitle></DialogHeader>
          {open && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Info l="Nome" v={open.full_name} />
                <Info l="Status" v={statusBadge(open.status)} />
                <Info l="E-mail" v={open.email} />
                <Info l="WhatsApp" v={open.phone} />
                <Info l="Tipo de parceiro" v={open.partner_type} />
                <Info l="Cidade/UF" v={[open.city, open.state].filter(Boolean).join("/")} />
                <Info l="Já atua com locação" v={open.works_with_rental ? "Sim" : "Não"} />
                <Info l="Usuário vinculado" v={open.user_id ? "Sim" : "Não"} />
              </div>
              {open.message && <div><Label className="text-xs uppercase tracking-wide text-neutral-500">Mensagem</Label><p className="mt-1 bg-neutral-50 p-3 rounded-lg">{open.message}</p></div>}
              {open.status === "aprovado" && open.referral_link && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                  <Label className="text-xs uppercase tracking-wide text-emerald-700">Código de indicação</Label>
                  <p className="font-mono font-bold mt-1">{open.referral_code}</p>
                  <Label className="text-xs uppercase tracking-wide text-emerald-700 mt-3 block">Link de parceiro</Label>
                  <div className="flex gap-2 mt-1">
                    <Input value={open.referral_link} readOnly className="font-mono text-xs" />
                    <Button size="sm" onClick={() => copyLink(open.referral_link!)} className="gap-1"><Copy size={14} /></Button>
                    <a href={open.referral_link} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="outline" className="gap-1"><ExternalLink size={14} /></Button></a>
                  </div>
                </div>
              )}
              {open.status === "recusado" && open.rejection_reason && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <Label className="text-xs uppercase tracking-wide text-red-700">Motivo da recusa</Label>
                  <p className="mt-1">{open.rejection_reason}</p>
                </div>
              )}
              <div>
                <Label className="text-xs uppercase tracking-wide text-neutral-500">Observações internas</Label>
                <Textarea defaultValue={open.internal_notes ?? ""} rows={3} onBlur={(e) => saveNotes(open.id, e.target.value)} placeholder="Anotações..." className="mt-1" />
              </div>
              <div className="flex gap-2 pt-2 border-t">
                {open.status === "pendente" && <>
                  <Button onClick={() => approve(open)} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"><Check size={14} /> Aprovar e liberar link</Button>
                  <Button variant="outline" onClick={() => { setRejectFor(open); setRejectReason(""); setOpen(null); }} className="text-red-600 gap-2"><X size={14} /> Recusar</Button>
                </>}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal Recusar */}
      <Dialog open={!!rejectFor} onOpenChange={(o) => !o && setRejectFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Recusar afiliado</DialogTitle></DialogHeader>
          <div>
            <Label>Motivo da recusa</Label>
            <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={4} placeholder="Explique o motivo (ficará no histórico)" className="mt-2" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectFor(null)}>Cancelar</Button>
            <Button onClick={reject} className="bg-red-600 hover:bg-red-700 text-white">Confirmar recusa</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Info({ l, v }: { l: string; v: React.ReactNode }) {
  return <div><Label className="text-xs uppercase tracking-wide text-neutral-500">{l}</Label><div className="mt-0.5 font-medium">{v}</div></div>;
}
