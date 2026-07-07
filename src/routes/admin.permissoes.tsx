import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ShieldCheck, KeyRound } from "lucide-react";

export const Route = createFileRoute("/admin/permissoes")({
  component: () => (
    <ProtectedRoute roles={["admin", "analista"]}>
      <PermissoesPage />
    </ProtectedRoute>
  ),
});

type Cargo = { id: string; chave: string; nome: string; descricao: string | null; is_sistema: boolean; ativo: boolean };
type Perm = { id: string; chave: string; modulo: string; acao: string; descricao: string | null };

function PermissoesPage() {
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [perms, setPerms] = useState<Perm[]>([]);
  const [vinculos, setVinculos] = useState<Set<string>>(new Set()); // cargo_id::perm_id
  const [loading, setLoading] = useState(true);
  const [cargoAtivo, setCargoAtivo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [c, p, cp] = await Promise.all([
      supabase.from("cargos_admin").select("*").order("chave"),
      supabase.from("permissoes").select("*").order("modulo, acao"),
      supabase.from("cargo_permissoes").select("cargo_id, permissao_id"),
    ]);
    setCargos((c.data ?? []) as any);
    setPerms((p.data ?? []) as any);
    setVinculos(new Set((cp.data ?? []).map((v: any) => `${v.cargo_id}::${v.permissao_id}`)));
    setCargoAtivo(prev => prev ?? (c.data?.[0]?.id ?? null));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const modulos = useMemo(() => {
    const map = new Map<string, Perm[]>();
    perms.forEach(p => {
      const arr = map.get(p.modulo) ?? [];
      arr.push(p);
      map.set(p.modulo, arr);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [perms]);

  const toggle = (permId: string, on: boolean) => {
    if (!cargoAtivo) return;
    const key = `${cargoAtivo}::${permId}`;
    setVinculos(prev => {
      const n = new Set(prev);
      if (on) n.add(key); else n.delete(key);
      return n;
    });
  };

  const salvar = async () => {
    if (!cargoAtivo) return;
    setSaving(true);
    const novos = Array.from(vinculos).filter(v => v.startsWith(cargoAtivo + "::")).map(v => v.split("::")[1]);
    // wipe + reinsert for this cargo
    const del = await supabase.from("cargo_permissoes").delete().eq("cargo_id", cargoAtivo);
    if (del.error) { toast.error("Erro ao salvar (delete)"); setSaving(false); return; }
    if (novos.length) {
      const ins = await supabase.from("cargo_permissoes").insert(novos.map(pid => ({ cargo_id: cargoAtivo, permissao_id: pid })));
      if (ins.error) { toast.error("Erro ao salvar (insert)"); setSaving(false); return; }
    }
    toast.success("Permissões atualizadas");
    setSaving(false);
  };

  const cargo = cargos.find(c => c.id === cargoAtivo);

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Cargos e Permissões</h1>
            <p className="text-neutral-500 mt-2">Defina o que cada cargo interno pode acessar.</p>
          </div>
          <Button onClick={salvar} disabled={saving || !cargoAtivo} className="bg-neutral-900">{saving ? "Salvando..." : "Salvar alterações"}</Button>
        </div>

        {loading ? <div className="text-neutral-400">Carregando...</div> : (
          <Tabs value={cargoAtivo ?? ""} onValueChange={setCargoAtivo}>
            <TabsList className="flex-wrap h-auto">
              {cargos.map(c => (
                <TabsTrigger key={c.id} value={c.id} className="gap-2">
                  <ShieldCheck size={14} /> {c.nome}
                  {c.is_sistema && <Badge variant="secondary" className="text-[10px]">sistema</Badge>}
                </TabsTrigger>
              ))}
            </TabsList>

            {cargos.map(c => (
              <TabsContent key={c.id} value={c.id} className="mt-6 space-y-6">
                <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-4">
                  <p className="text-sm font-semibold">{c.nome}</p>
                  <p className="text-xs text-neutral-500">{c.descricao ?? "—"}</p>
                </div>

                {modulos.map(([modulo, lista]) => (
                  <div key={modulo} className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
                    <div className="bg-neutral-50 px-5 py-3 border-b border-neutral-200 flex items-center gap-2">
                      <KeyRound size={14} className="text-neutral-400" />
                      <span className="text-xs font-bold uppercase tracking-widest text-neutral-700">{modulo}</span>
                    </div>
                    <div className="divide-y divide-neutral-100">
                      {lista.map(p => {
                        const checked = vinculos.has(`${c.id}::${p.id}`);
                        return (
                          <label key={p.id} className="flex items-center justify-between px-5 py-3 hover:bg-neutral-50 cursor-pointer">
                            <div className="flex items-center gap-3">
                              <Checkbox checked={checked} onCheckedChange={(v) => toggle(p.id, !!v)} />
                              <div>
                                <p className="text-sm font-semibold">{p.descricao ?? p.chave}</p>
                                <p className="text-xs text-neutral-400 font-mono">{p.chave}</p>
                              </div>
                            </div>
                            <Badge variant="outline" className="text-[10px] uppercase">{p.acao}</Badge>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
    </DashboardLayout>
  );
}
