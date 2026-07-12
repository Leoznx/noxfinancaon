import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/suporte")({
  component: () => (
    <ProtectedRoute roles={["suporte", "admin", "admin_master", "juridico", "financeiro"]} moduleKey="tickets">
      <Suporte />
    </ProtectedRoute>
  ),
});

const PRIORIDADES = ["baixa", "media", "alta", "urgente"];
const STATUSES = ["aberto", "em_atendimento", "encaminhado", "resolvido", "fechado"];
const ENCAMINHAR = ["juridico", "financeiro", "admin_master"];

function Suporte() {
  const [rows, setRows] = useState<any[]>([]);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");

  const carregar = async () => {
    const { data } = await supabase.from("support_tickets" as any).select("*").order("created_at", { ascending: false });
    setRows((data as any[]) ?? []);
  };
  useEffect(() => { carregar(); }, []);

  const criar = async () => {
    if (!subject.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("support_tickets" as any).insert({
      subject, description, user_id: user?.id, status: "aberto", priority: "media",
    });
    if (error) toast.error(error.message); else { toast.success("Chamado criado"); setSubject(""); setDescription(""); carregar(); }
  };

  const atualizar = async (id: string, patch: any) => {
    await supabase.from("support_tickets" as any).update(patch).eq("id", id);
    carregar();
  };

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle>Novo chamado</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Input placeholder="Assunto" value={subject} onChange={(e) => setSubject(e.target.value)} />
            <Textarea placeholder="Descrição" value={description} onChange={(e) => setDescription(e.target.value)} />
            <Button onClick={criar}>Abrir chamado</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Chamados</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {rows.length === 0 && <p className="text-sm text-muted-foreground">Nenhum chamado.</p>}
            {rows.map((t) => (
              <div key={t.id} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{t.subject}</h3>
                  <Badge>{t.status}</Badge>
                </div>
                {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}
                <div className="flex gap-2 flex-wrap">
                  <Select value={t.status} onValueChange={(v) => atualizar(t.id, { status: v })}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={t.priority} onValueChange={(v) => atualizar(t.id, { priority: v })}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>{PRIORIDADES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={t.forwarded_to ?? ""} onValueChange={(v) => atualizar(t.id, { forwarded_to: v || null, status: v ? "encaminhado" : t.status })}>
                    <SelectTrigger className="w-44"><SelectValue placeholder="Encaminhar para..." /></SelectTrigger>
                    <SelectContent>{ENCAMINHAR.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
