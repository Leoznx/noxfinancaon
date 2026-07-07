import { createLazyFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Clock, 
  CheckCircle, 
  Wallet, 
  TrendingUp, 
  Copy, 
  Upload,
  FileText,
  User,
  ArrowUpRight,
  MoreVertical,
  Download
} from "lucide-react";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription, 
  DialogFooter 
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createLazyFileRoute("/admin/saques")({
  component: () => (
    <ProtectedRoute roles={["admin", "analista", "financeiro"]}>
      <AdminSaquesPage />
    </ProtectedRoute>
  ),
});

function AdminSaquesPage() {
  const [saques, setSaques] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSaque, setSelectedSaque] = useState<any>(null);
  const [modalPagamentoAberto, setModalPagamentoAberto] = useState(false);
  const [comprovante, setComprovante] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchSaques = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('solicitacoes_saque')
      .select('*, profile:profiles(nome, email)')
      .order('created_at', { ascending: false });

    if (error) {
      toast.error("Erro ao carregar saques");
    } else {
      setSaques(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchSaques();
  }, []);

  const handleApprove = async (id: string) => {
    const { error } = await supabase
      .from('solicitacoes_saque')
      .update({ 
        status: 'aprovada', 
        aprovado_em: new Date().toISOString(),
        aprovado_por: (await supabase.auth.getUser()).data.user?.id
      })
      .eq('id', id);

    if (error) toast.error("Erro ao aprovar");
    else {
      toast.success("Solicitação aprovada!");
      fetchSaques();
    }
  };

  const handleConfirmarPagamento = async () => {
    if (!comprovante || !selectedSaque) return;
    setIsSubmitting(true);

    try {
      // 1. Upload do comprovante
      const fileExt = comprovante.name.split('.').pop();
      const fileName = `${selectedSaque.id}.${fileExt}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('comprovantes-saque')
        .upload(fileName, comprovante);

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from('comprovantes-saque')
        .getPublicUrl(fileName);

      // 2. Atualiza solicitação
      const { error: updateError } = await supabase
        .from('solicitacoes_saque')
        .update({
          status: 'paga',
          pago_em: new Date().toISOString(),
          pago_por: (await supabase.auth.getUser()).data.user?.id,
          comprovante_url: publicUrlData.publicUrl,
        })
        .eq('id', selectedSaque.id);

      if (updateError) throw updateError;

      // 3. Marca comissões como sacadas
      // This logic is simplified; in production, you'd link individual commissions to the withdrawal
      await supabase.from('comissoes')
        .update({ 
          status: 'sacada', 
          sacada_em: new Date().toISOString(), 
          solicitacao_saque_id: selectedSaque.id 
        })
        .eq('beneficiario_id', selectedSaque.profile_id)
        .eq('status', 'disponivel');

      toast.success("Pagamento confirmado!");
      setModalPagamentoAberto(false);
      fetchSaques();
    } catch (err: any) {
      toast.error("Erro ao confirmar pagamento: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatarBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const saquesPorStatus = (status: string) => saques.filter(s => s.status === status);

  const stats = {
    pendentes: saquesPorStatus('pendente').length,
    aprovadas: saquesPorStatus('aprovada').length,
    totalPagar: saquesPorStatus('aprovada').reduce((acc, s) => acc + Number(s.valor_liquido), 0),
    pagasMes: saquesPorStatus('paga').filter(s => new Date(s.pago_em).getMonth() === new Date().getMonth()).length,
  };

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">Solicitações de Saque</h1>
          <p className="text-neutral-500 mt-2 font-medium">Gerencie os pagamentos de comissões para parceiros.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-6 border rounded-xl shadow-sm">
            <div className="flex items-center gap-3 text-amber-600 mb-2 font-bold text-xs uppercase tracking-wider">
              <Clock size={16} /> Pendentes
            </div>
            <p className="text-3xl font-black">{stats.pendentes}</p>
          </div>
          <div className="bg-white p-6 border rounded-xl shadow-sm">
            <div className="flex items-center gap-3 text-green-600 mb-2 font-bold text-xs uppercase tracking-wider">
              <CheckCircle size={16} /> Aprovadas
            </div>
            <p className="text-3xl font-black">{stats.aprovadas}</p>
          </div>
          <div className="bg-white p-6 border rounded-xl shadow-sm">
            <div className="flex items-center gap-3 text-blue-600 mb-2 font-bold text-xs uppercase tracking-wider">
              <Wallet size={16} /> Total a Pagar
            </div>
            <p className="text-3xl font-black">{formatarBRL(stats.totalPagar)}</p>
          </div>
          <div className="bg-white p-6 border rounded-xl shadow-sm">
            <div className="flex items-center gap-3 text-neutral-600 mb-2 font-bold text-xs uppercase tracking-wider">
              <TrendingUp size={16} /> Pagas no Mês
            </div>
            <p className="text-3xl font-black">{stats.pagasMes}</p>
          </div>
        </div>

        <Tabs defaultValue="pendentes" className="w-full">
          <TabsList className="bg-neutral-100 p-1 mb-6">
            <TabsTrigger value="pendentes" className="px-6">
              Pendentes {stats.pendentes > 0 && <Badge className="ml-2 bg-amber-500">{stats.pendentes}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="aprovadas" className="px-6">Aguardando Pagamento</TabsTrigger>
            <TabsTrigger value="pagas" className="px-6">Pagas</TabsTrigger>
          </TabsList>

          <TabsContent value="pendentes">
            <TabelaSaques 
              data={saquesPorStatus('pendente')} 
              onApprove={handleApprove}
              loading={loading}
            />
          </TabsContent>
          
          <TabsContent value="aprovadas">
            <TabelaSaques 
              data={saquesPorStatus('aprovada')} 
              onPay={(s: any) => {
                setSelectedSaque(s);
                setModalPagamentoAberto(true);
              }}
              loading={loading}
            />
          </TabsContent>

          <TabsContent value="pagas">
            <TabelaSaques data={saquesPorStatus('paga')} loading={loading} />
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={modalPagamentoAberto} onOpenChange={setModalPagamentoAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar Pagamento</DialogTitle>
            <DialogDescription>Anexe o comprovante do PIX para finalizar o saque.</DialogDescription>
          </DialogHeader>
          
          {selectedSaque && (
            <div className="space-y-6 py-4">
              <div className="bg-neutral-50 p-4 rounded-lg space-y-2 text-sm border">
                <div className="flex justify-between text-neutral-500 uppercase text-[10px] font-bold">
                  <span>Solicitante</span>
                  <span>Valor Líquido</span>
                </div>
                <div className="flex justify-between items-end">
                  <span className="font-bold text-neutral-900">{selectedSaque.profile?.nome}</span>
                  <span className="text-xl font-black text-green-700">{formatarBRL(selectedSaque.valor_liquido)}</span>
                </div>
                <div className="pt-4 border-t mt-4">
                  <p className="text-[10px] font-bold text-neutral-500 uppercase mb-1">Chave PIX ({selectedSaque.pix_tipo})</p>
                  <div className="flex items-center justify-between gap-2 bg-white border p-2 rounded-md">
                    <code className="text-sm font-mono">{selectedSaque.pix_chave}</code>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => {
                      navigator.clipboard.writeText(selectedSaque.pix_chave);
                      toast.success("Copiado!");
                    }}>
                      <Copy size={14} />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Comprovante (Imagem ou PDF)</Label>
                <div className="border-2 border-dashed rounded-xl p-8 text-center hover:bg-neutral-50 transition-colors cursor-pointer relative">
                  <input 
                    type="file" 
                    className="absolute inset-0 opacity-0 cursor-pointer" 
                    onChange={(e) => setComprovante(e.target.files?.[0] || null)}
                    accept="image/*,application/pdf"
                  />
                  <Upload className="mx-auto mb-2 text-neutral-400" />
                  <p className="text-sm font-medium">{comprovante ? comprovante.name : "Clique para selecionar arquivo"}</p>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalPagamentoAberto(false)}>Cancelar</Button>
            <Button className="bg-neutral-900" disabled={!comprovante || isSubmitting} onClick={handleConfirmarPagamento}>
              {isSubmitting ? "Processando..." : "Confirmar Pagamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

function TabelaSaques({ data, onApprove, onPay, loading }: any) {
  const formatarBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  if (loading) return <div className="text-center py-20 text-neutral-400">Carregando solicitações...</div>;
  if (data.length === 0) return <div className="text-center py-20 text-neutral-400">Nenhuma solicitação encontrada.</div>;

  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      <Table>
        <TableHeader className="bg-neutral-50">
          <TableRow>
            <TableHead>Solicitante</TableHead>
            <TableHead>Perfil</TableHead>
            <TableHead className="text-right">Bruto</TableHead>
            <TableHead className="text-right">Taxa</TableHead>
            <TableHead className="text-right">Líquido</TableHead>
            <TableHead>PIX</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((s: any) => (
            <TableRow key={s.id}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-neutral-100 flex items-center justify-center font-bold text-xs">
                    {s.profile?.nome?.charAt(0)}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-bold">{s.profile?.nome}</span>
                    <span className="text-[10px] text-neutral-400">{s.profile?.email}</span>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="text-[10px] uppercase font-bold">{s.perfil_tipo}</Badge>
              </TableCell>
              <TableCell className="text-right font-medium">{formatarBRL(Number(s.valor_bruto))}</TableCell>
              <TableCell className="text-right text-red-500 text-xs">-{formatarBRL(Number(s.taxa_saque))}</TableCell>
              <TableCell className="text-right font-black text-green-700">{formatarBRL(Number(s.valor_liquido))}</TableCell>
              <TableCell>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-neutral-400 uppercase">{s.pix_tipo}</span>
                  <span className="text-xs font-mono">{s.pix_chave}</span>
                </div>
              </TableCell>
              <TableCell className="text-right">
                {s.status === 'pendente' && (
                  <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => onApprove(s.id)}>Aprovar</Button>
                )}
                {s.status === 'aprovada' && (
                  <Button size="sm" className="bg-amber-500 hover:bg-amber-600" onClick={() => onPay(s)}>Pagar</Button>
                )}
                {s.status === 'paga' && (
                  <Button size="sm" variant="ghost" asChild>
                    <a href={s.comprovante_url} target="_blank" rel="noreferrer">
                      <Download size={14} className="mr-2" /> Comprovante
                    </a>
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
