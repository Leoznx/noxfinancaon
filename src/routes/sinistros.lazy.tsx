import { createLazyFileRoute, Link } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { AlertCircle, PlusCircle, Clock, AlertTriangle, MapPin as MapPinIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

export const Route = createLazyFileRoute("/sinistros")({
  component: () => (
    <ProtectedRoute>
      <Sinistros />
    </ProtectedRoute>
  ),
});

function Sinistros() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "analista";
  const [sinistros, setSinistros] = useState<any[]>([]);
  const [apolices, setApolices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selectedApoliceId, setSelectedApoliceId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchData();
  }, [user]);

  const fetchData = async () => {
    try {
      setLoading(true);
      // Fetch sinistros
      const { data: sinistrosData, error: sinistrosError } = await supabase
        .from('sinistros')
        .select(`
          *,
          apolices (
            numero,
            consultas_credito (
              inquilinos (nome),
              imoveis (logradouro, numero, bairro)
            )
          )
        `)
        .order('created_at', { ascending: false });

      if (sinistrosError) throw sinistrosError;
      setSinistros(sinistrosData || []);

      // Fetch active apolices to allow opening new sinistro
      const { data: apolicesData, error: apolicesError } = await supabase
        .from('apolices')
        .select(`
          id,
          numero,
          consultas_credito (
            inquilinos (nome),
            imoveis (valor_aluguel)
          )
        `)
        .eq('status', 'ativa');

      if (apolicesError) throw apolicesError;
      setApolices(apolicesData || []);
    } catch (error: any) {
      toast.error("Erro ao carregar dados: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenSinistro = async () => {
    if (!selectedApoliceId) {
      toast.error("Selecione um contrato");
      return;
    }
    setConfirmOpen(true);
  };

  const confirmSinistro = async () => {
    setIsSubmitting(true);
    try {
      const { data: { user: supabaseUser } } = await supabase.auth.getUser();
      if (!supabaseUser) throw new Error("Não autenticado");

      const { error } = await supabase
        .from('sinistros')
        .insert({
          apolice_id: selectedApoliceId,
          profile_id: supabaseUser.id,
          status: 'pendente',
          motivo: 'Inadimplência reportada'
        });

      if (error) throw error;

      toast.success("Sinistro aberto com sucesso. Nossa equipe jurídica iniciará a análise.");
      setOpen(false);
      setConfirmOpen(false);
      setSelectedApoliceId("");
      fetchData();
    } catch (error: any) {
      toast.error("Erro ao abrir sinistro: " + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pendente': return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">Pendente</Badge>;
      case 'em_analise': return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Em Análise</Badge>;
      case 'aprovado': return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Aprovado</Badge>;
      case 'reprovado': return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">Reprovado</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const selectedApolice = apolices.find(a => a.id === selectedApoliceId);
  const aluguelValor = selectedApolice?.consultas_credito?.imoveis?.valor_aluguel || 0;
  const multaValor = aluguelValor * 0.05;

  return (
    <DashboardLayout>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">Sinistros</h1>
          <p className="text-neutral-500 mt-1">
            {isAdmin
              ? "Acompanhe e gerencie os sinistros solicitados pelos usuários do sistema."
              : "Acompanhe e solicite o acionamento jurídico da garantia."}
          </p>
        </div>

        {!isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-red-600 hover:bg-red-700 text-white font-bold h-12 px-6 rounded-xl shadow-lg shadow-red-100 flex items-center gap-2">
                <PlusCircle size={20} />
                ABRIR SINISTRO
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <div className="p-2">
                <DialogHeader>
                  <DialogTitle className="text-2xl font-bold text-neutral-900 mb-2">Novo Acionamento</DialogTitle>
                  <DialogDescription className="text-neutral-500 mb-6">
                    Selecione o contrato que apresenta inadimplência ou problemas para iniciar o processo jurídico.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-6">
                  <div className="space-y-2">
                    <Label className="text-xs font-black uppercase tracking-widest text-neutral-400">Selecionar Contrato (Apólice)</Label>
                    <Select onValueChange={setSelectedApoliceId} value={selectedApoliceId}>
                      <SelectTrigger className="h-14 rounded-xl border-neutral-200 focus:ring-red-500">
                        <SelectValue placeholder="Escolha um contrato ativo..." />
                      </SelectTrigger>
                      <SelectContent>
                        {apolices.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.numero} - {a.consultas_credito?.inquilinos?.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex gap-4">
                    <AlertCircle className="text-red-600 shrink-0 mt-1" size={20} />
                    <div className="text-xs text-red-900 leading-relaxed font-medium">
                      <p className="font-bold mb-1">Atenção ao regulamento:</p>
                      O acionamento indevido ou desnecessário gera custos operacionais. Certifique-se da real necessidade antes de prosseguir.
                    </div>
                  </div>

                  <Button
                    onClick={handleOpenSinistro}
                    disabled={!selectedApoliceId}
                    className="w-full h-14 bg-red-600 hover:bg-red-700 text-white font-black text-lg rounded-xl shadow-xl shadow-red-50 transition-all active:scale-95"
                  >
                    Abrir Solicitação
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card className="border-neutral-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-neutral-50">
            <TableRow>
              <TableHead className="text-[10px] font-black uppercase tracking-widest py-5 px-8">Data</TableHead>
              <TableHead className="text-[10px] font-black uppercase tracking-widest py-5">Contrato / Inquilino</TableHead>
              <TableHead className="text-[10px] font-black uppercase tracking-widest py-5">Localização</TableHead>
              <TableHead className="text-[10px] font-black uppercase tracking-widest py-5 text-center">Status</TableHead>
              <TableHead className="text-[10px] font-black uppercase tracking-widest py-5 text-right px-8">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-neutral-400">Carregando sinistros...</TableCell>
              </TableRow>
            ) : sinistros.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-64 text-center">
                  <div className="flex flex-col items-center justify-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-neutral-50 flex items-center justify-center text-neutral-300">
                      <Clock size={32} />
                    </div>
                    <div className="max-w-xs mx-auto">
                      <p className="text-neutral-900 font-bold">Nenhum sinistro solicitado</p>
                      <p className="text-neutral-500 text-sm mt-1">{isAdmin ? "Os sinistros abertos pelos usuários aparecerão aqui automaticamente." : "Sua lista de acionamentos aparecerá aqui quando você abrir uma nova solicitação."}</p>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            ) : sinistros.map((s) => (
              <TableRow key={s.id} className="hover:bg-neutral-50/50 transition-colors">
                <TableCell className="px-8 py-6 text-sm text-neutral-500 font-medium">
                  {new Date(s.created_at).toLocaleDateString('pt-BR')}
                </TableCell>
                <TableCell className="py-6">
                  <div className="flex flex-col">
                    <span className="font-bold text-neutral-900">{s.apolices?.numero}</span>
                    <span className="text-xs text-neutral-500 font-medium">{s.apolices?.consultas_credito?.inquilinos?.nome}</span>
                  </div>
                </TableCell>
                <TableCell className="py-6">
                  <div className="flex items-center gap-1.5 text-xs text-neutral-500 font-medium">
                    <MapPinIcon size={12} className="text-neutral-400" />
                    {s.apolices?.consultas_credito?.imoveis?.logradouro}, {s.apolices?.consultas_credito?.imoveis?.numero}
                  </div>
                </TableCell>
                <TableCell className="py-6 text-center">
                  {getStatusBadge(s.status)}
                </TableCell>
                <TableCell className="px-8 py-6 text-right">
                  <Button variant="ghost" size="sm" className="font-bold text-xs text-neutral-500 hover:text-neutral-900">Ver detalhes</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Confirmação Crítica */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-[450px] border-2 border-red-500">
          <div className="p-2">
            <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center text-red-600 mb-6 mx-auto">
              <AlertTriangle size={32} />
            </div>
            <DialogTitle className="text-2xl font-black text-neutral-900 text-center mb-4">Confirmação Importante</DialogTitle>
            
            <div className="space-y-6 text-center">
              <p className="text-sm text-neutral-600 font-medium leading-relaxed">
                Você tem certeza que deseja abrir o sinistro para o contrato <span className="font-black text-neutral-900">{selectedApolice?.numero}</span>?
              </p>

              <div className="bg-red-50 border-2 border-red-100 rounded-2xl p-6 text-left">
                <p className="text-red-900 text-sm font-bold flex items-center gap-2 mb-3">
                  <AlertCircle size={18} /> AVISO LEGAL:
                </p>
                <p className="text-red-800 text-xs leading-relaxed">
                  Caso o acionamento seja identificado como <span className="font-black">ENGANO</span> ou <span className="font-black">DESNECESSÁRIO</span>, será cobrada uma taxa de <span className="font-black">5% sobre o valor do aluguel</span> (R$ {multaValor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}) por acionamento jurídico sem necessidade.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-4">
                <Button 
                  variant="outline" 
                  onClick={() => setConfirmOpen(false)}
                  className="h-14 rounded-xl font-bold"
                >
                  Cancelar
                </Button>
                <Button 
                  disabled={isSubmitting}
                  onClick={confirmSinistro}
                  className="h-14 bg-red-600 hover:bg-red-700 text-white font-black rounded-xl shadow-xl shadow-red-100"
                >
                  {isSubmitting ? "Processando..." : "Sim, confirmar"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
