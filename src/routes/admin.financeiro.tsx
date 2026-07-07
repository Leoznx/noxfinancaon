import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Banknote, Wallet, History } from "lucide-react";

export const Route = createFileRoute("/admin/financeiro")({
  component: () => (
    <ProtectedRoute roles={["admin", "analista", "financeiro"]}>
      <FinanceiroAdminPage />
    </ProtectedRoute>
  ),
});

const brl = (n: number) => `R$ ${Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

function FinanceiroAdminPage() {
  const [adminId, setAdminId] = useState<string | null>(null);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setAdminId(data.user?.id ?? null)); }, []);


  const [saques, setSaques] = useState<any[]>([]);
  const [comissoes, setComissoes] = useState<any[]>([]);
  const [pagamentos, setPagamentos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [s, c, p] = await Promise.all([
      supabase.from("solicitacoes_saque").select("*, profile:profiles!solicitacoes_saque_profile_id_fkey(nome,email)").order("created_at", { ascending: false }).limit(200),
      supabase.from("comissoes").select("id, valor, status, tipo_comissao, nivel_aplicado, beneficiario_tipo, created_at, beneficiario:profiles!comissoes_beneficiario_id_fkey(nome,email)").in("status", ["pendente", "disponivel"]).order("created_at", { ascending: false }).limit(200),
      supabase.from("solicitacoes_saque").select("*, profile:profiles!solicitacoes_saque_profile_id_fkey(nome,email)").eq("status", "pago").order("pago_em", { ascending: false }).limit(200),
    ]);
    setSaques(s.data ?? []);
    setComissoes(c.data ?? []);
    setPagamentos(p.data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const atualizarSaque = async (id: string, status: "aprovado" | "rejeitado" | "pago") => {
    const patch: any = { status };
    if (status === "aprovado") { patch.aprovado_por = adminId; patch.aprovado_em = new Date().toISOString(); }
    if (status === "pago") { patch.pago_por = adminId; patch.pago_em = new Date().toISOString(); }
    const { error } = await supabase.from("solicitacoes_saque").update(patch).eq("id", id);
    if (error) toast.error("Erro ao atualizar saque");
    else { toast.success("Saque atualizado"); load(); }
  };

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Financeiro</h1>
          <p className="text-neutral-500 mt-2">Saques, comissões e histórico de pagamentos.</p>
        </div>

        <Tabs defaultValue="saques">
          <TabsList>
            <TabsTrigger value="saques" className="gap-2"><Banknote size={16} /> Saques <Badge variant="secondary" className="ml-1">{saques.filter(s => s.status === "pendente").length}</Badge></TabsTrigger>
            <TabsTrigger value="comissoes" className="gap-2"><Wallet size={16} /> Comissões <Badge variant="secondary" className="ml-1">{comissoes.length}</Badge></TabsTrigger>
            <TabsTrigger value="pagamentos" className="gap-2"><History size={16} /> Pagamentos</TabsTrigger>
          </TabsList>

          <TabsContent value="saques" className="mt-6">
            <Tabela cols={["Solicitante", "Valor", "Líquido", "PIX", "Status", "Ações"]}>
              {loading ? <Vazio cols={6}>Carregando...</Vazio> :
                !saques.length ? <Vazio cols={6}>Nenhuma solicitação.</Vazio> :
                saques.map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="px-6">
                      <p className="font-semibold">{s.profile?.nome ?? "—"}</p>
                      <p className="text-xs text-neutral-500">{s.profile?.email}</p>
                    </TableCell>
                    <TableCell>{brl(s.valor_bruto)}</TableCell>
                    <TableCell className="font-semibold">{brl(s.valor_liquido)}</TableCell>
                    <TableCell className="text-xs"><span className="uppercase text-neutral-400">{s.pix_tipo}</span> · {s.pix_chave}</TableCell>
                    <TableCell><Status status={s.status} /></TableCell>
                    <TableCell className="pr-6 text-right space-x-2">
                      {s.status === "pendente" && <>
                        <Button size="sm" variant="outline" onClick={() => atualizarSaque(s.id, "aprovado")}>Aprovar</Button>
                        <Button size="sm" variant="ghost" className="text-red-600" onClick={() => atualizarSaque(s.id, "rejeitado")}>Rejeitar</Button>
                      </>}
                      {s.status === "aprovado" && <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => atualizarSaque(s.id, "pago")}>Marcar pago</Button>}
                    </TableCell>
                  </TableRow>
                ))
              }
            </Tabela>
          </TabsContent>

          <TabsContent value="comissoes" className="mt-6">
            <Tabela cols={["Beneficiário", "Tipo", "Nível", "Valor", "Status", "Data"]}>
              {loading ? <Vazio cols={6}>Carregando...</Vazio> :
                !comissoes.length ? <Vazio cols={6}>Nenhuma comissão a pagar.</Vazio> :
                comissoes.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="px-6">
                      <p className="font-semibold">{c.beneficiario?.nome ?? "—"}</p>
                      <p className="text-xs text-neutral-500 uppercase">{c.beneficiario_tipo}</p>
                    </TableCell>
                    <TableCell className="text-xs uppercase">{c.tipo_comissao}</TableCell>
                    <TableCell><Badge variant="outline">{c.nivel_aplicado}</Badge></TableCell>
                    <TableCell className="font-semibold">{brl(c.valor)}</TableCell>
                    <TableCell><Status status={c.status} /></TableCell>
                    <TableCell className="text-xs text-neutral-400 pr-6">{new Date(c.created_at).toLocaleDateString("pt-BR")}</TableCell>
                  </TableRow>
                ))
              }
            </Tabela>
          </TabsContent>

          <TabsContent value="pagamentos" className="mt-6">
            <Tabela cols={["Beneficiário", "Valor pago", "PIX", "Pago em"]}>
              {loading ? <Vazio cols={4}>Carregando...</Vazio> :
                !pagamentos.length ? <Vazio cols={4}>Nenhum pagamento ainda.</Vazio> :
                pagamentos.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="px-6 font-semibold">{p.profile?.nome ?? "—"}</TableCell>
                    <TableCell>{brl(p.valor_liquido)}</TableCell>
                    <TableCell className="text-xs">{p.pix_chave}</TableCell>
                    <TableCell className="text-xs text-neutral-400 pr-6">{p.pago_em ? new Date(p.pago_em).toLocaleString("pt-BR") : "—"}</TableCell>
                  </TableRow>
                ))
              }
            </Tabela>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function Tabela({ cols, children }: { cols: string[]; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-sm">
      <Table>
        <TableHeader className="bg-neutral-50"><TableRow>{cols.map((c, i) => <TableHead key={c} className={i === 0 ? "px-6" : i === cols.length - 1 ? "pr-6 text-right" : ""}>{c}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </div>
  );
}
function Vazio({ cols, children }: { cols: number; children: React.ReactNode }) {
  return <TableRow><TableCell colSpan={cols} className="text-center py-16 text-neutral-400">{children}</TableCell></TableRow>;
}
function Status({ status }: { status: string }) {
  const map: Record<string, string> = {
    pendente: "bg-amber-100 text-amber-700 border-amber-200",
    aprovado: "bg-blue-100 text-blue-700 border-blue-200",
    pago: "bg-emerald-100 text-emerald-700 border-emerald-200",
    rejeitado: "bg-red-100 text-red-700 border-red-200",
    disponivel: "bg-emerald-100 text-emerald-700 border-emerald-200",
    sacada: "bg-neutral-100 text-neutral-700 border-neutral-200",
    cancelada: "bg-red-100 text-red-700 border-red-200",
  };
  return <Badge className={map[status] ?? "bg-neutral-100 text-neutral-700"}>{status}</Badge>;
}
