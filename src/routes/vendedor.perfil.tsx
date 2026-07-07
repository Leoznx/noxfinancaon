import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { UserCircle } from "lucide-react";
import { META_PADRAO_VENDEDOR } from "@/lib/comissao-vendedor";

export const Route = createFileRoute("/vendedor/perfil")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin"]}>
      <Perfil />
    </ProtectedRoute>
  ),
});

function Perfil() {
  const [profile, setProfile] = useState<any>(null);
  const [internal, setInternal] = useState<any>(null);
  const [telefone, setTelefone] = useState("");
  const [novaSenha, setNovaSenha] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      setProfile(p); setTelefone((p as any)?.telefone ?? "");
      const { data: iu } = await supabase.from("internal_users" as any)
        .select("*").eq("auth_user_id", user.id).maybeSingle();
      setInternal(iu);
    })();
  }, []);

  async function salvarTelefone() {
    if (!profile) return;
    const { error } = await supabase.from("profiles").update({ telefone }).eq("id", profile.id);
    if (error) return toast.error(error.message);
    toast.success("Telefone atualizado");
  }
  async function trocarSenha() {
    if (novaSenha.length < 6) return toast.error("Mínimo 6 caracteres");
    const { error } = await supabase.auth.updateUser({ password: novaSenha });
    if (error) return toast.error(error.message);
    toast.success("Senha alterada"); setNovaSenha("");
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center gap-3">
          <UserCircle className="w-7 h-7 text-yellow-600" />
          <div>
            <h1 className="text-2xl font-bold">Meu Perfil</h1>
            <p className="text-sm text-muted-foreground">Suas informações de vendedor NOX.</p>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle>Dados</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Nome</Label><Input value={profile?.nome ?? ""} disabled /></div>
              <div><Label>E-mail</Label><Input value={profile?.email ?? ""} disabled /></div>
              <div><Label>Cargo</Label><Input value={internal?.role ?? "vendedor"} disabled /></div>
              <div><Label>Status</Label>
                <div><Badge>{internal?.status ?? profile?.status ?? "ativo"}</Badge></div>
              </div>
              <div><Label>Cadastrado em</Label><Input value={profile?.created_at ? new Date(profile.created_at).toLocaleDateString("pt-BR") : ""} disabled /></div>
              <div><Label>Meta padrão</Label><Input value={`${META_PADRAO_VENDEDOR} contratos/mês`} disabled /></div>
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1"><Label>Telefone</Label><Input value={telefone} onChange={(e) => setTelefone(e.target.value)} /></div>
              <Button onClick={salvarTelefone}>Salvar</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Alterar senha</CardTitle></CardHeader>
          <CardContent className="flex items-end gap-2">
            <div className="flex-1"><Label>Nova senha</Label><Input type="password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} /></div>
            <Button onClick={trocarSenha}>Alterar</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Regra de comissão</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Modelo oficial NOX Fiança · Comissão escalonada retroativa + bônus por marcos. Reserva técnica de 15% por 60 dias, clawback em 90 dias.
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
