import { createLazyFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Briefcase, Plus, Pencil, Trash2, Pause, Play, Download, Eye, FileText } from "lucide-react";
import { toast } from "sonner";

export const Route = createLazyFileRoute("/admin/vagas")({
  component: () => (
    <ProtectedRoute roles={["admin"]} moduleKey="vagas_abertas">
      <DashboardLayout>
        <AdminVagasPage />
      </DashboardLayout>
    </ProtectedRoute>
  ),
});

type Vaga = {
  id: string; title: string; area: string; description: string;
  requirements: string | null; benefits: string | null;
  contract_type: string | null; work_model: string;
  city: string | null; state: string | null;
  status: string; published_at: string | null; created_at: string;
};
type Cand = {
  id: string; job_id: string | null; full_name: string; email: string; phone: string;
  city: string | null; state: string | null; area_interest: string | null;
  linkedin_url: string | null; message: string | null;
  resume_file_path: string; resume_file_name: string;
  status: string; source: string; internal_notes: string | null;
  created_at: string;
};

const STATUS_VAGA = ["aberta", "pausada", "encerrada"] as const;
const STATUS_CAND = ["novo", "em_analise", "selecionado", "recusado", "contratado", "arquivado"] as const;

function AdminVagasPage() {
  const [tab, setTab] = useState("vagas");
  const [vagas, setVagas] = useState<Vaga[]>([]);
  const [cands, setCands] = useState<Cand[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const [openVagaModal, setOpenVagaModal] = useState(false);
  const [editingVaga, setEditingVaga] = useState<Partial<Vaga> | null>(null);

  const [openCandModal, setOpenCandModal] = useState<Cand | null>(null);

  const load = async () => {
    setLoading(true);
    const [v, c] = await Promise.all([
      supabase.from("job_openings").select("*").order("created_at", { ascending: false }),
      supabase.from("job_applications").select("*").order("created_at", { ascending: false }),
    ]);
    setVagas((v.data ?? []) as Vaga[]);
    setCands((c.data ?? []) as Cand[]);
    const cnt: Record<string, number> = {};
    (c.data ?? []).forEach((x: any) => { if (x.job_id) cnt[x.job_id] = (cnt[x.job_id] ?? 0) + 1; });
    setCounts(cnt);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const newVaga = () => {
    setEditingVaga({ title: "", area: "", description: "", work_model: "remoto", status: "aberta" });
    setOpenVagaModal(true);
  };
  const editVaga = (v: Vaga) => { setEditingVaga(v); setOpenVagaModal(true); };
  const saveVaga = async () => {
    if (!editingVaga?.title || !editingVaga?.area || !editingVaga?.description || !editingVaga?.work_model) {
      toast.error("Preencha título, área, descrição e modelo."); return;
    }
    const payload = {
      title: editingVaga.title, area: editingVaga.area,
      description: editingVaga.description,
      requirements: editingVaga.requirements ?? null,
      benefits: editingVaga.benefits ?? null,
      contract_type: editingVaga.contract_type ?? null,
      work_model: editingVaga.work_model,
      city: editingVaga.city ?? null, state: editingVaga.state ?? null,
      status: editingVaga.status ?? "aberta",
      published_at: editingVaga.published_at ?? new Date().toISOString(),
    };
    const { error } = editingVaga.id
      ? await supabase.from("job_openings").update(payload).eq("id", editingVaga.id)
      : await supabase.from("job_openings").insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success("Vaga salva.");
    setOpenVagaModal(false); setEditingVaga(null); load();
  };
  const setStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("job_openings").update({ status }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Status atualizado."); load();
  };
  const delVaga = async (id: string) => {
    if (!confirm("Excluir esta vaga?")) return;
    const { error } = await supabase.from("job_openings").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Vaga excluída."); load();
  };

  const setCandStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("job_applications").update({ status, reviewed_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Status atualizado."); load();
    if (openCandModal?.id === id) setOpenCandModal({ ...openCandModal, status });
  };
  const saveNotes = async (id: string, notes: string) => {
    const { error } = await supabase.from("job_applications").update({ internal_notes: notes }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Observações salvas.");
  };
  const downloadResume = async (path: string) => {
    const { data, error } = await supabase.storage.from("curriculos").createSignedUrl(path, 300);
    if (error || !data?.signedUrl) { toast.error("Não foi possível gerar link."); return; }
    window.open(data.signedUrl, "_blank");
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2"><Briefcase size={24} /> Vagas abertas</h1>
          <p className="text-sm text-neutral-500">Gestão de vagas e currículos recebidos.</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="vagas">Vagas cadastradas ({vagas.length})</TabsTrigger>
          <TabsTrigger value="curriculos">Currículos recebidos ({cands.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="vagas" className="mt-6">
          <div className="flex justify-end mb-4">
            <Button onClick={newVaga} className="bg-yellow-400 text-neutral-900 hover:bg-yellow-500 font-bold gap-2"><Plus size={16} /> Criar vaga</Button>
          </div>
          <div className="bg-white border rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="p-3">Título</th><th className="p-3">Área</th><th className="p-3">Modelo</th>
                  <th className="p-3">Local</th><th className="p-3">Status</th><th className="p-3">Candidatos</th>
                  <th className="p-3">Criada em</th><th className="p-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td className="p-6 text-center text-neutral-500" colSpan={8}>Carregando...</td></tr> :
                  vagas.length === 0 ? <tr><td className="p-6 text-center text-neutral-500" colSpan={8}>Nenhuma vaga cadastrada.</td></tr> :
                  vagas.map(v => (
                    <tr key={v.id} className="border-t hover:bg-neutral-50">
                      <td className="p-3 font-bold">{v.title}</td>
                      <td className="p-3">{v.area}</td>
                      <td className="p-3 capitalize">{v.work_model}</td>
                      <td className="p-3">{[v.city, v.state].filter(Boolean).join("/") || "—"}</td>
                      <td className="p-3"><Badge variant={v.status === "aberta" ? "default" : "secondary"} className={v.status === "aberta" ? "bg-emerald-500" : v.status === "pausada" ? "bg-yellow-500" : "bg-neutral-500"}>{v.status}</Badge></td>
                      <td className="p-3">{counts[v.id] ?? 0}</td>
                      <td className="p-3 text-xs text-neutral-500">{new Date(v.created_at).toLocaleDateString("pt-BR")}</td>
                      <td className="p-3">
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => editVaga(v)} title="Editar"><Pencil size={14} /></Button>
                          {v.status === "aberta" && <Button size="sm" variant="ghost" onClick={() => setStatus(v.id, "pausada")} title="Pausar"><Pause size={14} /></Button>}
                          {v.status === "pausada" && <Button size="sm" variant="ghost" onClick={() => setStatus(v.id, "aberta")} title="Reabrir"><Play size={14} /></Button>}
                          {v.status !== "encerrada" && <Button size="sm" variant="ghost" onClick={() => setStatus(v.id, "encerrada")} title="Encerrar"><FileText size={14} /></Button>}
                          <Button size="sm" variant="ghost" onClick={() => delVaga(v.id)} title="Excluir" className="text-red-600"><Trash2 size={14} /></Button>
                        </div>
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="curriculos" className="mt-6">
          <div className="bg-white border rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="p-3">Nome</th><th className="p-3">Contato</th><th className="p-3">Área</th>
                  <th className="p-3">Vaga</th><th className="p-3">Origem</th><th className="p-3">Status</th>
                  <th className="p-3">Enviado em</th><th className="p-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td className="p-6 text-center text-neutral-500" colSpan={8}>Carregando...</td></tr> :
                  cands.length === 0 ? <tr><td className="p-6 text-center text-neutral-500" colSpan={8}>Nenhum currículo recebido.</td></tr> :
                  cands.map(c => {
                    const vaga = vagas.find(v => v.id === c.job_id);
                    return (
                      <tr key={c.id} className="border-t hover:bg-neutral-50">
                        <td className="p-3 font-bold">{c.full_name}<div className="text-xs text-neutral-500 font-normal">{[c.city, c.state].filter(Boolean).join("/")}</div></td>
                        <td className="p-3 text-xs">{c.email}<div className="text-neutral-500">{c.phone}</div></td>
                        <td className="p-3">{c.area_interest ?? "—"}</td>
                        <td className="p-3">{vaga?.title ?? <span className="text-neutral-400 italic">Espontânea</span>}</td>
                        <td className="p-3 text-xs capitalize">{c.source.replace(/_/g, " ")}</td>
                        <td className="p-3">
                          <Select value={c.status} onValueChange={(v) => setCandStatus(c.id, v)}>
                            <SelectTrigger className="h-8 text-xs w-32"><SelectValue /></SelectTrigger>
                            <SelectContent>{STATUS_CAND.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                          </Select>
                        </td>
                        <td className="p-3 text-xs text-neutral-500">{new Date(c.created_at).toLocaleDateString("pt-BR")}</td>
                        <td className="p-3">
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setOpenCandModal(c)} title="Detalhes"><Eye size={14} /></Button>
                            <Button size="sm" variant="ghost" onClick={() => downloadResume(c.resume_file_path)} title="Baixar PDF"><Download size={14} /></Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                }
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Modal Vaga */}
      <Dialog open={openVagaModal} onOpenChange={(o) => { if (!o) { setOpenVagaModal(false); setEditingVaga(null); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingVaga?.id ? "Editar vaga" : "Criar nova vaga"}</DialogTitle></DialogHeader>
          {editingVaga && (
            <div className="grid md:grid-cols-2 gap-4">
              <Lab label="Título *" className="md:col-span-2"><Input value={editingVaga.title ?? ""} onChange={(e) => setEditingVaga({ ...editingVaga, title: e.target.value })} /></Lab>
              <Lab label="Área *"><Input value={editingVaga.area ?? ""} onChange={(e) => setEditingVaga({ ...editingVaga, area: e.target.value })} /></Lab>
              <Lab label="Tipo de contratação"><Input placeholder="CLT, PJ, Estágio..." value={editingVaga.contract_type ?? ""} onChange={(e) => setEditingVaga({ ...editingVaga, contract_type: e.target.value })} /></Lab>
              <Lab label="Modelo de trabalho *">
                <Select value={editingVaga.work_model ?? "remoto"} onValueChange={(v) => setEditingVaga({ ...editingVaga, work_model: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="presencial">Presencial</SelectItem><SelectItem value="hibrido">Híbrido</SelectItem><SelectItem value="remoto">Remoto</SelectItem></SelectContent>
                </Select>
              </Lab>
              <Lab label="Status">
                <Select value={editingVaga.status ?? "aberta"} onValueChange={(v) => setEditingVaga({ ...editingVaga, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUS_VAGA.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </Lab>
              <Lab label="Cidade"><Input value={editingVaga.city ?? ""} onChange={(e) => setEditingVaga({ ...editingVaga, city: e.target.value })} /></Lab>
              <Lab label="Estado"><Input value={editingVaga.state ?? ""} onChange={(e) => setEditingVaga({ ...editingVaga, state: e.target.value })} /></Lab>
              <Lab label="Descrição *" className="md:col-span-2"><Textarea rows={4} value={editingVaga.description ?? ""} onChange={(e) => setEditingVaga({ ...editingVaga, description: e.target.value })} /></Lab>
              <Lab label="Requisitos" className="md:col-span-2"><Textarea rows={3} value={editingVaga.requirements ?? ""} onChange={(e) => setEditingVaga({ ...editingVaga, requirements: e.target.value })} /></Lab>
              <Lab label="Diferenciais" className="md:col-span-2"><Textarea rows={3} value={editingVaga.benefits ?? ""} onChange={(e) => setEditingVaga({ ...editingVaga, benefits: e.target.value })} /></Lab>
            </div>
          )}
          <DialogFooter><Button onClick={saveVaga} className="bg-yellow-400 text-neutral-900 hover:bg-yellow-500 font-bold">Salvar vaga</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Candidato */}
      <Dialog open={!!openCandModal} onOpenChange={(o) => !o && setOpenCandModal(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Detalhes do candidato</DialogTitle></DialogHeader>
          {openCandModal && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Info l="Nome" v={openCandModal.full_name} />
                <Info l="Status" v={openCandModal.status} />
                <Info l="E-mail" v={openCandModal.email} />
                <Info l="WhatsApp" v={openCandModal.phone} />
                <Info l="Cidade/UF" v={[openCandModal.city, openCandModal.state].filter(Boolean).join("/")} />
                <Info l="Área" v={openCandModal.area_interest ?? "—"} />
                <Info l="Origem" v={openCandModal.source} />
                <Info l="Vaga" v={vagas.find(v => v.id === openCandModal.job_id)?.title ?? "Espontânea"} />
              </div>
              {openCandModal.linkedin_url && <Info l="LinkedIn" v={<a href={openCandModal.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">{openCandModal.linkedin_url}</a>} />}
              {openCandModal.message && <div><Label className="text-xs uppercase tracking-wide text-neutral-500">Mensagem</Label><p className="mt-1 bg-neutral-50 p-3 rounded-lg">{openCandModal.message}</p></div>}
              <div>
                <Label className="text-xs uppercase tracking-wide text-neutral-500">Currículo PDF</Label>
                <div className="mt-1"><Button size="sm" onClick={() => downloadResume(openCandModal.resume_file_path)} className="gap-2"><Download size={14} /> Baixar {openCandModal.resume_file_name}</Button></div>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wide text-neutral-500">Vincular a uma vaga</Label>
                <Select value={openCandModal.job_id ?? "_none"} onValueChange={async (v) => {
                  const jobId = v === "_none" ? null : v;
                  await supabase.from("job_applications").update({ job_id: jobId }).eq("id", openCandModal.id);
                  setOpenCandModal({ ...openCandModal, job_id: jobId });
                  load();
                  toast.success("Candidato vinculado.");
                }}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">Sem vínculo (espontânea)</SelectItem>
                    {vagas.map(v => <SelectItem key={v.id} value={v.id}>{v.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wide text-neutral-500">Observações internas</Label>
                <Textarea defaultValue={openCandModal.internal_notes ?? ""} rows={3} onBlur={(e) => saveNotes(openCandModal.id, e.target.value)} placeholder="Anotações da análise..." className="mt-1" />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Lab({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><Label className="text-xs uppercase tracking-wide text-neutral-500">{label}</Label><div className="mt-1">{children}</div></div>;
}
function Info({ l, v }: { l: string; v: React.ReactNode }) {
  return <div><Label className="text-xs uppercase tracking-wide text-neutral-500">{l}</Label><div className="mt-0.5 font-medium">{v}</div></div>;
}
