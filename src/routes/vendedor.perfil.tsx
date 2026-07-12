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
import { AlertCircle, RefreshCw, UserCircle } from "lucide-react";
import { META_PADRAO_VENDEDOR } from "@/lib/comissao-vendedor";
import { getSellerContext } from "@/lib/vendedor-portal";

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState("");

  async function carregar() {
    setLoading(true);
    setErro("");

    try {
      const context = await getSellerContext();
      const [profileRes, internalRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", context.authUserId).maybeSingle(),
        supabase.from("internal_users" as any).select("*").eq("auth_user_id", context.authUserId).maybeSingle(),
      ]);

      if (profileRes.error) throw profileRes.error;
      if (internalRes.error) throw internalRes.error;

      setProfile(profileRes.data);
      setTelefone((profileRes.data as any)?.telefone ?? (internalRes.data as any)?.phone ?? "");
      setInternal(internalRes.data);
    } catch (e: any) {
      setErro(e.message || "Não foi possível carregar seu perfil.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { carregar(); }, []);

  async function salvarTelefone() {
    if (!profile) return;
    setSaving(true);

    const [profileUpdate, internalUpdate] = await Promise.all([
      supabase.from("profiles").update({ telefone }).eq("id", profile.id),
      internal?.id
        ? supabase.from("internal_users" as any).update({ phone: telefone }).eq("id", internal.id)
        : Promise.resolve({ error: null } as any),
    ]);

    setSaving(false);
    if (profileUpdate.error || internalUpdate.error) {
      toast.error(profileUpdate.error?.message || internalUpdate.error?.message || "Não foi possível salvar.");
      return;
    }

    toast.success("Telefone atualizado.");
    carregar();
  }

  async function trocarSenha() {
    if (novaSenha.length < 6) return toast.error("A nova senha precisa ter no mínimo 6 caracteres.");
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: novaSenha });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Senha alterada.");
    setNovaSenha("");
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-yellow-100 p-2 text-yellow-700">
              <UserCircle className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight text-neutral-950">Meu Perfil</h1>
              <p className="text-sm font-medium text-neutral-500">Suas informações de vendedor NOX.</p>
            </div>
          </div>
          <Button variant="outline" className="gap-2" onClick={carregar} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>

        {erro && <Estado titulo="Não foi possível carregar seu perfil" descricao={erro} erro />}
        {loading ? (
          <Estado titulo="Carregando perfil..." descricao="Buscando seus dados de usuário." />
        ) : !erro && !profile ? (
          <Estado titulo="Nenhum perfil encontrado" descricao="Não encontramos dados de perfil para o usuário logado." />
        ) : !erro && (
          <>
            <Card>
              <CardHeader><CardTitle>Dados</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div><Label>Nome</Label><Input value={profile?.nome ?? internal?.full_name ?? ""} disabled /></div>
                  <div><Label>E-mail</Label><Input value={profile?.email ?? internal?.email ?? ""} disabled /></div>
                  <div><Label>Cargo</Label><Input value={internal?.role ?? "vendedor"} disabled /></div>
                  <div><Label>Status</Label><div className="mt-2"><Badge>{internal?.status ?? profile?.status ?? "ativo"}</Badge></div></div>
                  <div><Label>Cadastrado em</Label><Input value={profile?.created_at ? new Date(profile.created_at).toLocaleDateString("pt-BR") : ""} disabled /></div>
                  <div><Label>Meta padrão operacional</Label><Input value={`${META_PADRAO_VENDEDOR} contratos/mês`} disabled /></div>
                </div>
                <div className="flex flex-col gap-2 md:flex-row md:items-end">
                  <div className="flex-1"><Label>Telefone</Label><Input value={telefone} onChange={(e) => setTelefone(e.target.value)} /></div>
                  <Button onClick={salvarTelefone} disabled={saving}>Salvar telefone</Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Alterar senha</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-2 md:flex-row md:items-end">
                <div className="flex-1"><Label>Nova senha</Label><Input type="password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} /></div>
                <Button onClick={trocarSenha} disabled={saving}>Alterar senha</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Regra de comissão</CardTitle></CardHeader>
              <CardContent className="text-sm text-neutral-500">
                Modelo oficial NOX Fiança: comissão escalonada retroativa, bônus por marcos, reserva técnica de 15% por 60 dias e clawback em 90 dias.
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function Estado({ titulo, descricao, erro = false }: { titulo: string; descricao: string; erro?: boolean }) {
  return (
    <div className={`rounded-2xl border p-8 text-center ${erro ? "border-red-200 bg-red-50 text-red-800" : "border-dashed border-neutral-200 bg-white text-neutral-500"}`}>
      <AlertCircle className={`mx-auto mb-2 h-4 w-4 ${erro ? "text-red-600" : "text-neutral-400"}`} />
      <p className="font-bold">{titulo}</p>
      <p className="mt-1 text-sm">{descricao}</p>
    </div>
  );
}
