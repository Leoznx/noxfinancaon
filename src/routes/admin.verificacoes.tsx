import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Search, Eye, CheckCircle2, XCircle, IdCard, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/verificacoes")({
  component: () => (
    <ProtectedRoute roles={["admin", "analista", "juridico", "admin_master"]} moduleKey="documentos">
      <VerificacoesDocumentoPage />
    </ProtectedRoute>
  ),
});

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  analista: "Analista",
  corretor: "Corretor",
  imobiliaria: "Imobiliária",
  proprietario: "Proprietário",
  inquilino: "Inquilino",
};

const DOC_LABEL: Record<string, string> = { cnh: "CNH", rg: "Identidade / RG" };

type SlotKey = "frente" | "verso" | "selfie";

function VerificacoesDocumentoPage() {
  const [linhas, setLinhas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<string>("em_analise");
  const [adminId, setAdminId] = useState<string | null>(null);

  const [detalhe, setDetalhe] = useState<any | null>(null);
  const [signedUrls, setSignedUrls] = useState<Record<SlotKey, string | null>>({
    frente: null,
    verso: null,
    selfie: null,
  });
  const [loadingImagens, setLoadingImagens] = useState(false);

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [processando, setProcessando] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: verifs, error } = await supabase
      .from("verificacoes_documento" as any)
      .select("*")
      .order("submitted_at", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Erro ao carregar verificações: " + error.message);
      setLoading(false);
      return;
    }

    const userIds = [...new Set((verifs ?? []).map((v: any) => v.user_id))];
    let profilesMap: Record<string, any> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, nome, email, role")
        .in("id", userIds);
      profilesMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]));
    }

    setLinhas((verifs ?? []).map((v: any) => ({ ...v, perfil: profilesMap[v.user_id] ?? null })));
    setLoading(false);
  };

  useEffect(() => {
    load();
    supabase.auth.getUser().then(({ data }) => setAdminId(data.user?.id ?? null));
  }, []);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhas.filter((v) => {
      if (status !== "todas" && v.verification_status !== status) return false;
      if (!q) return true;
      return (
        (v.perfil?.nome ?? "").toLowerCase().includes(q) ||
        (v.perfil?.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [linhas, busca, status]);

  const abrirDetalhes = async (v: any) => {
    setDetalhe(v);
    setSignedUrls({ frente: null, verso: null, selfie: null });
    setLoadingImagens(true);
    try {
      const pares: Array<[SlotKey, string | null]> = [
        ["frente", v.document_front_url],
        ["verso", v.document_back_url],
        ["selfie", v.selfie_url],
      ];
      const result: Record<SlotKey, string | null> = { frente: null, verso: null, selfie: null };
      for (const [key, path] of pares) {
        if (!path) continue;
        const { data } = await supabase.storage
          .from("documentos-verificacao")
          .createSignedUrl(path, 600);
        result[key] = data?.signedUrl ?? null;
      }
      setSignedUrls(result);
    } catch (e: any) {
      toast.error("Erro ao carregar imagens: " + (e?.message || "desconhecido"));
    } finally {
      setLoadingImagens(false);
    }
  };

  const notificarUsuario = async (v: any, opts: { titulo: string; mensagem: string; tipo: string; cor: string }) => {
    const { error } = await supabase.from("notificacoes").insert({
      user_id: v.user_id,
      titulo: opts.titulo,
      mensagem: opts.mensagem,
      tipo: opts.tipo,
      cor_destaque: opts.cor,
      link: "/configuracoes?tab=conta",
    } as any);
    if (error) console.error("[admin.verificacoes] falha ao notificar usuário:", error);
  };

  const aprovar = async (v: any) => {
    setProcessando(v.id);
    try {
      const { error } = await supabase
        .from("verificacoes_documento" as any)
        .update({
          verification_status: "aprovado",
          reviewed_at: new Date().toISOString(),
          reviewer_id: adminId,
          rejection_reason: null,
        } as any)
        .eq("id", v.id);
      if (error) { toast.error("Erro ao aprovar: " + error.message); return; }
      toast.success("Documento aprovado.");
      await notificarUsuario(v, {
        titulo: "Documento aprovado",
        mensagem: "Sua verificação de identidade foi aprovada. Sua conta está totalmente verificada.",
        tipo: "documento_aprovado",
        cor: "verde",
      });
      setDetalhe(null);
      load();
    } finally {
      setProcessando(null);
    }
  };

  const reprovar = async () => {
    if (!rejectingId) return;
    if (!motivo.trim()) { toast.error("Informe o motivo da recusa"); return; }
    const v = linhas.find((l) => l.id === rejectingId);
    setProcessando(rejectingId);
    try {
      const { error } = await supabase
        .from("verificacoes_documento" as any)
        .update({
          verification_status: "recusado",
          rejection_reason: motivo,
          reviewed_at: new Date().toISOString(),
          reviewer_id: adminId,
        } as any)
        .eq("id", rejectingId);
      if (error) { toast.error("Erro ao reprovar: " + error.message); return; }
      toast.success("Documento recusado.");
      await notificarUsuario(v, {
        titulo: "Documento recusado",
        mensagem: `Sua verificação de identidade foi recusada. Motivo: ${motivo}. Envie os documentos novamente.`,
        tipo: "documento_recusado",
        cor: "vermelho",
      });
      setRejectingId(null);
      setMotivo("");
      setDetalhe(null);
      load();
    } finally {
      setProcessando(null);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">Aprovações de Documentos</h1>
          <p className="text-neutral-500 mt-2 font-medium">
            Fotos de verificação de identidade enviadas no cadastro. Aprove ou recuse cada envio.
          </p>
        </div>

        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou e-mail..."
              className="pl-10 h-11"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-56 h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="em_analise">Em análise</SelectItem>
              <SelectItem value="aprovado">Aprovados</SelectItem>
              <SelectItem value="recusado">Recusados</SelectItem>
              <SelectItem value="pendente">Pendentes (não enviados)</SelectItem>
              <SelectItem value="todas">Todos</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-sm">
          <Table>
            <TableHeader className="bg-neutral-50">
              <TableRow>
                <TableHead className="px-6">Nome</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Tipo de conta</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Enviado em</TableHead>
                <TableHead className="text-right pr-6">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-16 text-neutral-400">Carregando...</TableCell>
                </TableRow>
              ) : !filtradas.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-16 text-neutral-500">Nenhuma verificação encontrada.</TableCell>
                </TableRow>
              ) : (
                filtradas.map((v) => (
                  <TableRow key={v.id} className="hover:bg-neutral-50/50">
                    <TableCell className="px-6 font-semibold">{v.perfil?.nome ?? "—"}</TableCell>
                    <TableCell className="text-xs text-neutral-500">{v.perfil?.email ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="uppercase text-[10px] font-bold">
                        {ROLE_LABEL[v.perfil?.role] ?? v.perfil?.role ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{DOC_LABEL[v.document_type] ?? v.document_type}</TableCell>
                    <TableCell>
                      <StatusBadge status={v.verification_status} />
                    </TableCell>
                    <TableCell className="text-xs text-neutral-400">
                      {v.submitted_at ? new Date(v.submitted_at).toLocaleDateString("pt-BR") : "—"}
                    </TableCell>
                    <TableCell className="text-right pr-6 space-x-1">
                      <Button size="sm" variant="ghost" className="gap-1" onClick={() => abrirDetalhes(v)}>
                        <Eye size={14} /> Ver
                      </Button>
                      {v.verification_status === "em_analise" && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1 text-emerald-700"
                            disabled={processando === v.id}
                            onClick={() => aprovar(v)}
                          >
                            <CheckCircle2 size={14} />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1 text-red-700"
                            disabled={processando === v.id}
                            onClick={() => { setRejectingId(v.id); setMotivo(""); }}
                          >
                            <XCircle size={14} />
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={!!detalhe} onOpenChange={(open) => !open && setDetalhe(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Verificação de {detalhe?.perfil?.nome ?? "usuário"}</DialogTitle>
            <DialogDescription>
              {ROLE_LABEL[detalhe?.perfil?.role] ?? detalhe?.perfil?.role} · {DOC_LABEL[detalhe?.document_type] ?? detalhe?.document_type} · {detalhe?.perfil?.email}
            </DialogDescription>
          </DialogHeader>

          {detalhe && (
            <div className="space-y-5 py-2">
              {detalhe.verification_status === "recusado" && detalhe.rejection_reason && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                  <p className="font-bold mb-1">Motivo da recusa anterior</p>
                  <p>{detalhe.rejection_reason}</p>
                </div>
              )}

              {loadingImagens ? (
                <div className="py-16 flex items-center justify-center">
                  <Loader2 className="animate-spin text-neutral-300" />
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <ImagemDoc titulo="Frente do documento" url={signedUrls.frente} />
                  <ImagemDoc titulo="Verso do documento" url={signedUrls.verso} />
                  <ImagemDoc titulo="Segurando o documento" url={signedUrls.selfie} />
                </div>
              )}
            </div>
          )}

          {detalhe?.verification_status === "em_analise" && (
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                className="text-red-700 border-red-200 hover:bg-red-50"
                disabled={processando === detalhe.id}
                onClick={() => { setRejectingId(detalhe.id); setMotivo(""); }}
              >
                <XCircle size={14} className="mr-1.5" /> Reprovar
              </Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700"
                disabled={processando === detalhe.id}
                onClick={() => aprovar(detalhe)}
              >
                <CheckCircle2 size={14} className="mr-1.5" /> Aprovar
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectingId} onOpenChange={(o) => !o && setRejectingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reprovar documento</DialogTitle>
            <DialogDescription>Informe o motivo (obrigatório). O usuário verá esse motivo e poderá reenviar.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <Label>Motivo</Label>
            <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={4} placeholder="Ex.: foto ilegível, documento vencido, dados não conferem..." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectingId(null)}>Cancelar</Button>
            <Button className="bg-red-600 hover:bg-red-700" disabled={!!processando} onClick={reprovar}>
              {processando ? "Reprovando..." : "Reprovar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

function ImagemDoc({ titulo, url }: { titulo: string; url: string | null }) {
  return (
    <div className="rounded-xl border border-neutral-200 overflow-hidden bg-neutral-50">
      <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-neutral-500 border-b border-neutral-100">
        {titulo}
      </div>
      <div className="aspect-[4/3] flex items-center justify-center bg-white">
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="block w-full h-full">
            <img src={url} alt={titulo} className="w-full h-full object-cover" />
          </a>
        ) : (
          <div className="flex flex-col items-center text-neutral-300">
            <IdCard size={28} />
            <p className="text-[10px] font-bold uppercase tracking-widest mt-2">Não enviado</p>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    aprovado: "bg-emerald-100 text-emerald-700 border-emerald-200",
    em_analise: "bg-amber-100 text-amber-700 border-amber-200",
    enviado: "bg-blue-100 text-blue-700 border-blue-200",
    recusado: "bg-red-100 text-red-700 border-red-200",
    pendente: "bg-neutral-100 text-neutral-600 border-neutral-200",
  };
  const labels: Record<string, string> = {
    aprovado: "Aprovado",
    em_analise: "Em análise",
    enviado: "Enviado",
    recusado: "Recusado",
    pendente: "Pendente",
  };
  return (
    <Badge className={map[status] ?? "bg-neutral-100 text-neutral-700"}>
      {labels[status] ?? status}
    </Badge>
  );
}
