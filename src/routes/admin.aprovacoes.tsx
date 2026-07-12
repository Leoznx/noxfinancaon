import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Search, Eye, CheckCircle2, XCircle, Download, FileText } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/aprovacoes")({
  component: () => (
    <ProtectedRoute roles={["admin", "analista", "juridico", "admin_master"]} moduleKey="aprovacoes">
      <AprovacoesPage />
    </ProtectedRoute>
  ),
});

function AprovacoesPage() {
  const [linhas, setLinhas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [adminId, setAdminId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [detalhe, setDetalhe] = useState<any | null>(null);
  const [docsDetalhe, setDocsDetalhe] = useState<any[]>([]);
  const [loadingDetalhe, setLoadingDetalhe] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("consultas_credito")
      .select("id, profile_id_solicitante, tenant_name, tenant_document, tenant_email, tenant_telefone, property_address, rent_value, role_solicitante, created_at, status, substatus, documentos, dados_complementares_em, plano:planos(nome), solicitante:profiles!consultas_credito_profile_id_solicitante_fkey(nome, email)")
      .in("status", ["pendente", "em_analise"])
      .eq("substatus", "documentacao_complementar_enviada")
      .order("created_at", { ascending: false });
    if (error) toast.error("Erro ao carregar pendências");
    else setLinhas(data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    supabase.auth.getUser().then(({ data }) => setAdminId(data.user?.id ?? null));
  }, []);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return linhas;
    return linhas.filter((c) =>
      (c.tenant_name ?? "").toLowerCase().includes(q) ||
      (c.tenant_document ?? "").toLowerCase().includes(q) ||
      (c.solicitante?.nome ?? "").toLowerCase().includes(q)
    );
  }, [linhas, busca]);

  // Avisa o corretor/imobiliária/proprietário que pediu a consulta — o sino já
  // escuta INSERT em notificacoes via Realtime (ver SinoNotificacoes.tsx).
  const notificarSolicitante = async (consulta: any, opts: { titulo: string; mensagem: string; tipo: string; cor: string }) => {
    if (!consulta?.profile_id_solicitante) return;
    const { error } = await supabase.from("notificacoes").insert({
      user_id: consulta.profile_id_solicitante,
      titulo: opts.titulo,
      mensagem: opts.mensagem,
      tipo: opts.tipo,
      cor_destaque: opts.cor,
      link: `/consultas/${consulta.id}/status`,
    } as any);
    if (error) console.error("[admin.aprovacoes] falha ao notificar solicitante:", error);
  };

  const aprovar = async (id: string) => {
    const consulta = linhas.find((l) => l.id === id);
    const { error } = await supabase.from("consultas_credito").update({
      status: "aprovado", resultado: "aprovado", approved_by: adminId, approved_at: new Date().toISOString()
    }).eq("id", id);
    if (error) { toast.error("Erro ao aprovar"); return; }
    toast.success("Consulta aprovada");
    await notificarSolicitante(consulta, {
      titulo: "Consulta aprovada",
      mensagem: `A consulta de ${consulta?.tenant_name ?? "cliente"} (${consulta?.tenant_document ?? "—"}) foi aprovada.`,
      tipo: "contrato_aprovado",
      cor: "verde",
    });
    load();
  };

  const reprovar = async () => {
    if (!rejectingId) return;
    if (!motivo.trim()) { toast.error("Informe o motivo"); return; }
    const consulta = linhas.find((l) => l.id === rejectingId);
    const { error } = await supabase.from("consultas_credito").update({
      status: "reprovado", resultado: "recusado", rejected_by: adminId, rejected_at: new Date().toISOString(), rejection_reason: motivo
    }).eq("id", rejectingId);
    if (error) { toast.error("Erro ao reprovar"); return; }
    toast.success("Consulta reprovada");
    await notificarSolicitante(consulta, {
      titulo: "Consulta recusada",
      mensagem: `A consulta de ${consulta?.tenant_name ?? "cliente"} (${consulta?.tenant_document ?? "—"}) foi recusada. Motivo: ${motivo}`,
      tipo: "contrato_reprovado",
      cor: "vermelho",
    });
    setRejectingId(null); setMotivo(""); load();
  };

  const abrirDetalhes = async (consulta: any) => {
    setDetalhe(consulta);
    setDocsDetalhe([]);
    setLoadingDetalhe(true);
    try {
      const { data, error } = await supabase
        .from("documentos_proposta")
        .select("id, file_name, file_url, file_type, document_type, document_subtype, created_at, uploaded_by")
        .eq("consulta_id", consulta.id)
        .in("document_type", ["cnh_analise", "comprovante_renda_analise"])
        .order("created_at", { ascending: true });
      if (error) throw error;

      const docs = await Promise.all((data ?? []).map(async (doc: any) => {
        if (!doc.file_url || /^https?:\/\//i.test(doc.file_url)) return { ...doc, signedUrl: doc.file_url };
        // document_subtype grava o bucket real onde o arquivo foi enviado
        // (approval-documents) — usar um nome fixo diferente aqui fazia o
        // signed URL sempre falhar silenciosamente.
        const { data: signed, error: signedError } = await supabase.storage
          .from(doc.document_subtype || "approval-documents")
          .createSignedUrl(doc.file_url, 600);
        if (signedError) console.error("Erro ao gerar signed URL:", signedError);
        return { ...doc, signedUrl: signed?.signedUrl ?? null };
      }));
      setDocsDetalhe(docs);
    } catch (error: any) {
      toast.error("Erro ao carregar documentos: " + (error?.message || "desconhecido"));
    } finally {
      setLoadingDetalhe(false);
    }
  };

  const detalheMeta = detalhe?.documentos?.analise_complementar ?? {};
  const labelDocumento = (tipo?: string | null) => {
    if (tipo === "cnh_analise") return "CNH";
    if (tipo === "comprovante_renda_analise") return "Comprovante de renda";
    return tipo ?? "Documento";
  };

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Aprovações</h1>
          <p className="text-neutral-500 mt-2">
            Consultas em análise que já tiveram o formulário complementar enviado pelo solicitante.
          </p>
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por inquilino, CPF ou solicitante..." className="pl-10 h-11" />
        </div>

        <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-sm">
          <Table>
            <TableHeader className="bg-neutral-50">
              <TableRow>
                <TableHead className="px-6">Inquilino</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Imóvel</TableHead>
                <TableHead>Aluguel</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Solicitante</TableHead>
                <TableHead>Data</TableHead>
                <TableHead className="text-right pr-6">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-16 text-neutral-400">Carregando...</TableCell></TableRow>
              ) : !filtradas.length ? (
                <TableRow><TableCell colSpan={9} className="text-center py-16 text-neutral-500">Nenhuma consulta pendente.</TableCell></TableRow>
              ) : filtradas.map((c) => (
                <TableRow key={c.id} className="hover:bg-neutral-50/50">
                  <TableCell className="px-6 font-semibold">{c.tenant_name ?? "—"}</TableCell>
                  <TableCell className="text-xs text-neutral-500">{c.tenant_document ?? "—"}</TableCell>
                  <TableCell className="text-xs text-neutral-500 max-w-[200px] truncate">{c.property_address ?? "—"}</TableCell>
                  <TableCell>{c.rent_value ? `R$ ${Number(c.rent_value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "—"}</TableCell>
                  <TableCell className="text-xs">{c.plano?.nome ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={c.status === "em_analise" ? "bg-yellow-50 text-yellow-800 border-yellow-200" : "bg-amber-50 text-amber-700 border-amber-200"}>
                      {c.status === "em_analise" ? "Em análise" : "Pendente"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    <p className="font-semibold">{c.solicitante?.nome ?? "—"}</p>
                    <p className="text-neutral-400 uppercase">{c.role_solicitante}</p>
                  </TableCell>
                  <TableCell className="text-xs text-neutral-400">{new Date(c.created_at).toLocaleDateString("pt-BR")}</TableCell>
                  <TableCell className="text-right pr-6 space-x-1">
                    <Button size="sm" variant="ghost" className="gap-1" onClick={() => abrirDetalhes(c)}><Eye size={14} /></Button>
                    <Button size="sm" variant="ghost" className="gap-1 text-emerald-700" onClick={() => aprovar(c.id)}><CheckCircle2 size={14} /></Button>
                    <Button size="sm" variant="ghost" className="gap-1 text-red-700" onClick={() => { setRejectingId(c.id); setMotivo(""); }}><XCircle size={14} /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={!!detalhe} onOpenChange={(open) => !open && setDetalhe(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Detalhes da aprovação</DialogTitle>
            <DialogDescription>Dados complementares enviados para análise manual.</DialogDescription>
          </DialogHeader>

          {detalhe && (
            <div className="space-y-5 py-2">
              <div className="grid grid-cols-1 gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm sm:grid-cols-2">
                <Info label="Cliente" value={detalhe.tenant_name ?? "—"} />
                <Info label="CPF/CNPJ" value={detalhe.tenant_document ?? "—"} />
                <Info label="Status" value={detalhe.status === "em_analise" ? "Em análise" : "Pendente"} />
                <Info label="Data" value={detalhe.created_at ? new Date(detalhe.created_at).toLocaleString("pt-BR") : "—"} />
                <Info label="E-mail enviado" value={detalhe.tenant_email || detalheMeta.email || "—"} />
                <Info label="Telefone enviado" value={detalhe.tenant_telefone || detalheMeta.telefone || "—"} />
                <Info label="Estado civil" value={detalheMeta.estado_civil || "—"} />
                <Info label="Origem" value={detalhe.solicitante?.nome || detalhe.role_solicitante || "—"} />
              </div>

              <div className="rounded-2xl border border-neutral-200 bg-white p-4">
                <h3 className="mb-3 text-sm font-bold uppercase tracking-widest text-neutral-500">Documentos enviados</h3>
                {loadingDetalhe ? (
                  <p className="py-4 text-sm text-neutral-400">Carregando documentos...</p>
                ) : docsDetalhe.length === 0 ? (
                  <p className="py-4 text-sm text-neutral-400">Nenhum documento complementar enviado.</p>
                ) : (
                  <div className="space-y-2">
                    {docsDetalhe.map((doc) => (
                      <div key={doc.id} className="flex flex-col gap-3 rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-yellow-100 text-neutral-900">
                            <FileText size={16} />
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-neutral-900">{labelDocumento(doc.document_type)}</p>
                            <p className="truncate text-xs text-neutral-500">{doc.file_name}</p>
                          </div>
                        </div>
                        {doc.signedUrl && (
                          <Button asChild size="sm" variant="outline" className="gap-2">
                            <a href={doc.signedUrl} target="_blank" rel="noreferrer">
                              <Download size={14} /> Abrir
                            </a>
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectingId} onOpenChange={(o) => !o && setRejectingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reprovar consulta</DialogTitle>
            <DialogDescription>Informe o motivo (obrigatório).</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <Label>Motivo</Label>
            <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={4} placeholder="Ex.: documentação incompleta, score insuficiente..." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectingId(null)}>Cancelar</Button>
            <Button className="bg-red-600 hover:bg-red-700" onClick={reprovar}>Reprovar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">{label}</p>
      <p className="mt-1 break-words font-semibold text-neutral-900">{value}</p>
    </div>
  );
}
