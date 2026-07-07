import { createLazyFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { 
  TrendingUp, 
  Clock, 
  CheckCircle, 
  Wallet, 
  ArrowRight, 
  FileText,
  Send,
  Loader2,
  AlertCircle
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

export const Route = createLazyFileRoute("/minhas-comissoes")({
  component: () => (
    <ProtectedRoute roles={["corretor", "imobiliaria", "proprietario"]}>
      <ErrorBoundary nome="comissões">
        <ComissoesPage />
      </ErrorBoundary>
    </ProtectedRoute>
  ),
});

function SkeletonFinanceiro() {
  return (
    <div className="space-y-6 animate-pulse p-4">
      {/* Skeleton do card hero */}
      <div className="h-48 bg-neutral-100 rounded-3xl"></div>
      
      {/* Skeleton dos 3 KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="h-28 bg-neutral-100 rounded-2xl"></div>
        <div className="h-28 bg-neutral-100 rounded-2xl"></div>
        <div className="h-28 bg-neutral-100 rounded-2xl"></div>
      </div>
      
      {/* Skeleton da tabela */}
      <div className="h-64 bg-neutral-100 rounded-2xl"></div>
    </div>
  );
}

function ComissoesPage() {
  const { user } = useAuth();
  const [saldo, setSaldo] = useState<any>(null);
  const [comissoes, setComissoes] = useState<any[]>([]);
  const [saques, setSaques] = useState<any[]>([]);
  const [contratos, setContratos] = useState<any[]>([]);
  const [nivel, setNivel] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [modalSaqueAberto, setModalSaqueAberto] = useState(false);

  const [profileId, setProfileId] = useState<string | null>(null);


  const fetchDados = async () => {
    if (!user?.email) return;
    setLoading(true);
    setErro(null);

    try {
      // Resolver profile_id pelo email do painel (compatível com mock login)
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('id, role')
        .eq('email', user.email)
        .maybeSingle();
      if (profileErr) console.warn('[INFO] Erro ao buscar profile:', profileErr.message);

      const pid = profile?.id ?? null;
      setProfileId(pid);

      if (!pid) {
        setSaldo({ saldo_disponivel: 0, saldo_pendente: 0, total_sacado: 0, total_acumulado: 0 });
        setComissoes([]);
        setSaques([]);
        return;
      }

      // 1. Saldo
      const { data: saldoData, error: saldoError } = await supabase
        .from('saldos_comissao')
        .select('*')
        .eq('profile_id', pid)
        .maybeSingle();
      if (saldoError) console.warn('[INFO] Erro ao buscar saldo:', saldoError.message);
      setSaldo(saldoData || { saldo_disponivel: 0, saldo_pendente: 0, total_sacado: 0, total_acumulado: 0 });

      // 2. Comissões
      const { data: comissoesData, error: comissoesError } = await supabase
        .from('comissoes')
        .select('*, apolice:apolices(numero, valor_aluguel, inquilino:inquilinos(nome))')
        .eq('beneficiario_id', pid)
        .order('created_at', { ascending: false });
      if (comissoesError) console.warn('[INFO] Erro ao buscar comissões:', comissoesError.message);
      setComissoes(Array.isArray(comissoesData) ? comissoesData : []);

      // 3. Saques
      const { data: saquesData, error: saquesError } = await supabase
        .from('solicitacoes_saque')
        .select('*')
        .eq('profile_id', pid)
        .order('created_at', { ascending: false });
      if (saquesError) console.warn('[INFO] Erro ao buscar saques:', saquesError.message);
      setSaques(Array.isArray(saquesData) ? saquesData : []);

      // 4. Nível + Contratos Ativos
      const role = user.role;
      const colunaPerfil =
        role === 'corretor'    ? 'corretor_profile_id' :
        role === 'imobiliaria' ? 'imobiliaria_profile_id' :
                                 'proprietario_profile_id';

      const { data: contratosData, error: contratosErr } = await supabase
        .from('apolices')
        .select('id, numero, status, vigencia_inicio, vigencia_fim, valor_premio, consulta:consultas_credito(inquilino:inquilinos(nome))')
        .eq(colunaPerfil, pid)
        .order('vigencia_inicio', { ascending: false });
      if (contratosErr) console.warn('[INFO] Erro ao buscar contratos:', contratosErr.message);
      setContratos(Array.isArray(contratosData) ? contratosData : []);

      const count = (contratosData || []).filter((c: any) => c.status === 'ativa').length;


      const { data: niveisData, error: niveisError } = await supabase
        .from('niveis_perfil')
        .select('*')
        .eq('tipo_perfil', role || '')
        .eq('ativo', true)
        .order('ordem', { ascending: true });
      if (niveisError) console.warn('[INFO] Erro ao buscar níveis:', niveisError.message);

      if (niveisData && niveisData.length > 0) {
        const sortedNiveis = [...niveisData].reverse();
        const current = sortedNiveis.find((n: any) => (count || 0) >= n.min_contratos);
        const nextIndex = current ? niveisData.findIndex((n: any) => n.id === current.id) + 1 : 0;
        const next = niveisData[nextIndex];
        setNivel({
          current: current || niveisData[0],
          next: next || null,
          contratos: count || 0,
          metaContratos: next ? next.min_contratos : current?.max_contratos || 0,
        });
      }
    } catch (err: any) {
      console.error('[ERRO] Falha ao carregar comissões:', err);
      setErro('Não foi possível carregar seus dados financeiros. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDados();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);


  const formatarBRL = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  if (loading) {
    return (
      <DashboardLayout>
        <SkeletonFinanceiro />
      </DashboardLayout>
    );
  }

  if (erro) {
    return (
      <DashboardLayout>
        <div className="bg-red-50 border border-red-200 rounded-xl p-8 max-w-2xl mx-auto my-12 text-center">
          <AlertCircle className="w-12 h-12 text-red-600 mx-auto mb-4" strokeWidth={1.5} />
          <h2 className="text-xl font-bold text-red-900 mb-2">Ops! Algo deu errado</h2>
          <p className="text-red-700 mb-6">{erro}</p>
          <Button 
            onClick={() => window.location.reload()} 
            className="bg-red-600 hover:bg-red-700 text-white font-bold"
          >
            Tentar novamente
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-8 animate-fade-in">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">Gestão Financeira</h1>
            <p className="text-neutral-500 mt-2 font-medium">Acompanhe suas comissões e solicite saques.</p>
          </div>
        </div>

        {/* HERO CARD */}
        <CardSaldoPrincipal 
          saldo={saldo} 
          nivel={nivel} 
          onSacar={() => setModalSaqueAberto(true)} 
        />

        {/* KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 border rounded-2xl shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
              <Clock size={48} className="text-amber-500" />
            </div>
            <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-1">Saldo Pendente</p>
            <p className="text-2xl font-black text-neutral-900">{formatarBRL(saldo.saldo_pendente)}</p>
            <p className="text-xs text-neutral-500 mt-2">Aguardando 1ª mensalidade</p>
          </div>
          <div className="bg-white p-6 border rounded-2xl shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
              <TrendingUp size={48} className="text-green-500" />
            </div>
            <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-1">Total Acumulado</p>
            <p className="text-2xl font-black text-neutral-900">{formatarBRL(saldo.total_acumulado)}</p>
            <p className="text-xs text-neutral-500 mt-2">Histórico total na NOX</p>
          </div>
          <div className="bg-white p-6 border rounded-2xl shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
              <CheckCircle size={48} className="text-neutral-400" />
            </div>
            <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-1">Já Sacado</p>
            <p className="text-2xl font-black text-neutral-900">{formatarBRL(saldo.total_sacado)}</p>
            <p className="text-xs text-neutral-500 mt-2">Valores pagos via PIX</p>
          </div>
        </div>

        {/* HISTORICO */}
        <Tabs defaultValue="contratos" className="w-full">
          <TabsList className="bg-neutral-100 p-1 mb-6">
            <TabsTrigger value="contratos" className="px-6">Contratos Ativos</TabsTrigger>
            <TabsTrigger value="historico" className="px-6">Histórico de Comissões</TabsTrigger>
            <TabsTrigger value="saques" className="px-6">Meus Saques</TabsTrigger>
          </TabsList>

          <TabsContent value="contratos">
            <div className="bg-white border rounded-2xl overflow-hidden shadow-sm">
              <div className="divide-y">
                {contratos.length === 0 ? (
                  <div className="text-center py-20 text-neutral-400">Nenhum contrato vinculado.</div>
                ) : contratos.map((c) => {
                  const inicio = new Date(c.vigencia_inicio).getTime();
                  const fim = new Date(c.vigencia_fim).getTime();
                  const agora = Date.now();
                  const total = Math.max(1, fim - inicio);
                  const decorrido = Math.min(total, Math.max(0, agora - inicio));
                  const progresso = Math.round((decorrido / total) * 100);
                  const diasRestantes = Math.max(0, Math.ceil((fim - agora) / (1000 * 60 * 60 * 24)));
                  const mesesTotais = Math.max(1, Math.round((fim - inicio) / (1000 * 60 * 60 * 24 * 30)));
                  const mesesDecorridos = Math.min(mesesTotais, Math.round(decorrido / (1000 * 60 * 60 * 24 * 30)));
                  return (
                    <div key={c.id} className="p-6 hover:bg-neutral-50/50 transition-colors">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-xl bg-yellow-50 border border-yellow-200 flex items-center justify-center">
                            <FileText className="w-5 h-5 text-yellow-700" />
                          </div>
                          <div>
                            <p className="font-black text-neutral-900">Apólice #{c.numero}</p>
                            <p className="text-xs text-neutral-500 font-medium">
                              {c.consulta?.inquilino?.nome || 'Inquilino'} · Vigência {new Date(c.vigencia_inicio).toLocaleDateString('pt-BR')} → {new Date(c.vigencia_fim).toLocaleDateString('pt-BR')}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Prêmio</p>
                            <p className="text-sm font-black text-neutral-900">{formatarBRL(Number(c.valor_premio))}</p>
                          </div>
                          <BadgeStatus status={c.status === 'ativa' ? 'disponivel' : c.status} />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-neutral-500">
                          <span>Progresso do contrato</span>
                          <span className="text-neutral-900">{mesesDecorridos} / {mesesTotais} meses · {progresso}%</span>
                        </div>
                        <div className="h-2.5 bg-neutral-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-yellow-400 to-yellow-500 rounded-full transition-all duration-700"
                            style={{ width: `${progresso}%` }}
                          />
                        </div>
                        <p className="text-xs text-neutral-500 font-medium">
                          {progresso >= 100
                            ? 'Contrato encerrado.'
                            : `Faltam ${diasRestantes} dias para o fim da vigência.`}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </TabsContent>


          <TabsContent value="historico">
            <div className="bg-white border rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left min-w-[600px]">
                  <thead className="bg-neutral-50 text-neutral-500 text-[10px] font-bold uppercase tracking-wider">
                    <tr>
                      <th className="px-6 py-4">Apólice / Inquilino</th>
                      <th className="px-6 py-4">Nível</th>
                      <th className="px-6 py-4 text-right">Valor</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4">Data</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y border-t">
                    {comissoes.length === 0 ? (
                      <tr><td colSpan={5} className="text-center py-20 text-neutral-400">Nenhuma comissão registrada.</td></tr>
                    ) : comissoes.map((c) => (
                      <tr key={c.id} className="hover:bg-neutral-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <p className="font-bold text-neutral-900 text-sm">#{c.apolice?.numero || 'S/N'}</p>
                          <p className="text-xs text-neutral-500">{c.apolice?.inquilino?.nome || 'Inquilino'}</p>
                        </td>
                        <td className="px-6 py-4">
                          <div className="w-8 h-8 rounded-full bg-neutral-100 flex items-center justify-center font-bold text-xs text-neutral-600 border border-neutral-200 uppercase">
                            {(c.nivel_aplicado || 'B').charAt(0)}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="text-sm font-black text-green-700">{formatarBRL(Number(c.valor))}</span>
                        </td>
                        <td className="px-6 py-4">
                          <BadgeStatus status={c.status} />
                        </td>
                        <td className="px-6 py-4 text-xs text-neutral-400 font-medium">
                          {new Date(c.created_at).toLocaleDateString('pt-BR')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="saques">
            <div className="bg-white border rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left min-w-[600px]">
                  <thead className="bg-neutral-50 text-neutral-500 text-[10px] font-bold uppercase tracking-wider">
                    <tr>
                      <th className="px-6 py-4">ID Saque</th>
                      <th className="px-6 py-4">Valor Bruto</th>
                      <th className="px-6 py-4 text-right">Líquido</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4">PIX</th>
                      <th className="px-6 py-4">Data</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y border-t">
                    {saques.length === 0 ? (
                      <tr><td colSpan={6} className="text-center py-20 text-neutral-400">Nenhum saque solicitado.</td></tr>
                    ) : saques.map((s) => (
                      <tr key={s.id} className="hover:bg-neutral-50/50 transition-colors">
                        <td className="px-6 py-4 text-xs font-mono text-neutral-400">#{s.id.substring(0, 8)}</td>
                        <td className="px-6 py-4 text-sm text-neutral-600">{formatarBRL(Number(s.valor_bruto))}</td>
                        <td className="px-6 py-4 text-right font-bold text-neutral-900">{formatarBRL(Number(s.valor_liquido))}</td>
                        <td className="px-6 py-4">
                          <BadgeStatusSaque status={s.status} />
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-[10px] font-bold text-neutral-400 uppercase">{s.pix_tipo}</p>
                          <p className="text-xs font-mono">{s.pix_chave}</p>
                        </td>
                        <td className="px-6 py-4 text-xs text-neutral-400 font-medium">
                          {new Date(s.created_at).toLocaleDateString('pt-BR')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {modalSaqueAberto && (
        <ModalSaque
          saldoDisponivel={saldo.saldo_disponivel}
          profileId={profileId}
          onClose={() => setModalSaqueAberto(false)}
          onSuccess={() => {
            setModalSaqueAberto(false);
            fetchDados();
          }}
        />
      )}
    </DashboardLayout>
  );
}

function CardSaldoPrincipal({ saldo, nivel, onSacar }: any) {
  const [animaSaldo, setAnimaSaldo] = useState(false);
  const saldoAnterior = useRef(saldo.saldo_disponivel);
  
  useEffect(() => {
    if (saldo.saldo_disponivel > saldoAnterior.current) {
      setAnimaSaldo(true);
      setTimeout(() => setAnimaSaldo(false), 2000);
    }
    saldoAnterior.current = saldo.saldo_disponivel;
  }, [saldo.saldo_disponivel]);

  const formatarBRL = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  
  return (
    <div className="relative bg-gradient-to-br from-neutral-900 via-neutral-900 to-neutral-800 rounded-2xl p-6 overflow-hidden shadow-lg shadow-neutral-200">
      <div className="absolute top-0 right-0 w-48 h-48 bg-yellow-400 opacity-[0.03] rounded-full blur-[80px] -mr-24 -mt-24"></div>
      
      <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <p className="text-[9px] uppercase tracking-[0.25em] text-yellow-400 font-black">
            Saldo Disponível para Saque
          </p>
          
          <div className={`text-3xl font-black text-white tracking-tight tabular-nums transition-all ${animaSaldo ? 'scale-105 text-yellow-400' : ''}`}>
            {formatarBRL(saldo.saldo_disponivel)}
          </div>
          
          {nivel && nivel.current && (
            <p className="text-xs text-neutral-400 font-medium max-w-md leading-snug">
              Nível <span className="text-yellow-400 font-black uppercase tracking-wider">{nivel.current.nome_nivel}</span>
              {' '}· <span className="font-black text-white">{nivel.current.percentual_comissao}%</span> de comissão por contrato.
            </p>
          )}
        </div>
        
        <Button
          onClick={onSacar}
          disabled={saldo.saldo_disponivel <= 3.5}
          className="bg-yellow-400 hover:bg-yellow-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-neutral-900 h-11 px-5 rounded-xl font-black text-sm transition-all active:scale-95 shadow-lg shadow-yellow-400/20 gap-2"
        >
          <Wallet className="w-4 h-4" />
          Solicitar Saque
        </Button>
      </div>

      
      {nivel && nivel.next && (
        <div className="relative mt-5 pt-4 border-t border-white/5">
          <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-widest text-neutral-500 mb-2">
            <span>Progresso para {nivel.next.nome_nivel}</span>
            <span className="text-white">{nivel.contratos} / {nivel.metaContratos} contratos</span>
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/5">
            <div 
              className="h-full bg-yellow-400 rounded-full transition-all duration-1000"
              style={{ width: `${Math.min(100, (nivel.contratos / nivel.metaContratos) * 100)}%` }}
            ></div>
          </div>
          <p className="text-[11px] text-neutral-500 mt-2 font-medium italic">
            Faltam <span className="text-yellow-400 font-black">{nivel.metaContratos - nivel.contratos} contratos</span> para ganhar <span className="text-white font-black">{nivel.next.percentual_comissao}%</span>
          </p>
        </div>
      )}

    </div>
  );
}

function ModalSaque({ saldoDisponivel, profileId, onClose, onSuccess }: any) {
  const { user } = useAuth();
  const [valor, setValor] = useState('');
  const [pixTipo, setPixTipo] = useState('cpf');
  const [pixChave, setPixChave] = useState('');
  const [enviando, setEnviando] = useState(false);

  const TAXA = 3.50;

  const valorNumerico = Number(valor.replace(/[^0-9.]/g, '').replace(',', '.')) || 0;
  const valorLiquido = Math.max(0, valorNumerico - TAXA);
  const podeSacar = valorNumerico > TAXA && valorNumerico <= saldoDisponivel && pixChave.length > 0;

  const handleSolicitar = async () => {
    setEnviando(true);

    try {
      if (!profileId) throw new Error('Perfil não localizado para solicitação de saque.');

      const { error } = await supabase.from('solicitacoes_saque').insert({
        profile_id: profileId,
        perfil_tipo: user?.role || 'corretor',
        valor_bruto: valorNumerico,
        taxa_saque: TAXA,
        valor_liquido: valorLiquido,
        pix_chave: pixChave,
        pix_tipo: pixTipo,
        status: 'pendente',
      });

      if (error) throw error;

      toast.success('Saque solicitado! Aprovação em até 24h úteis.');
      onSuccess();
    } catch (error: any) {
      console.error('Erro ao solicitar saque:', error);
      toast.error(error.message || 'Erro ao solicitar saque');
    } finally {
      setEnviando(false);
    }
  };

  const formatarBRL = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md rounded-3xl p-8">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black tracking-tight">Solicitar Saque</DialogTitle>
          <DialogDescription className="text-neutral-500 font-medium">
            O valor será transferido via PIX em até 2 dias úteis.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
          <div className="bg-yellow-50 border border-yellow-100 rounded-2xl p-5 flex justify-between items-center">
            <div>
              <p className="text-[10px] font-black text-yellow-700 uppercase tracking-widest mb-1">Saldo Disponível</p>
              <p className="text-2xl font-black text-neutral-900">{formatarBRL(saldoDisponivel)}</p>
            </div>
            <Wallet className="text-yellow-600 opacity-20" size={32} />
          </div>
          
          <div className="space-y-2">
            <Label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Valor a sacar (taxa {formatarBRL(TAXA)})</Label>
            <div className="flex gap-2">
              <Input
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="0.00"
                type="number"
                className="h-12 rounded-xl border-neutral-200 font-bold"
              />
              <Button 
                variant="outline" 
                onClick={() => setValor(saldoDisponivel.toFixed(2))}
                className="h-12 px-4 rounded-xl font-bold border-neutral-200"
              >
                Tudo
              </Button>
            </div>
          </div>
          
          <div className="bg-neutral-50 rounded-2xl p-5 space-y-3 text-sm border border-neutral-100">
            <div className="flex justify-between items-center text-neutral-500">
              <span>Valor solicitado:</span>
              <span className="font-bold text-neutral-900">{formatarBRL(valorNumerico)}</span>
            </div>
            <div className="flex justify-between items-center text-neutral-500">
              <span>Taxa de saque:</span>
              <span className="font-bold text-red-500">-{formatarBRL(TAXA)}</span>
            </div>
            <div className="border-t pt-3 flex justify-between items-center">
              <span className="font-black text-neutral-900 uppercase text-xs">Você receberá:</span>
              <span className="text-xl font-black text-green-700">
                {formatarBRL(valorLiquido)}
              </span>
            </div>
          </div>
          
          <div className="space-y-3">
            <Label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Chave PIX</Label>
            <div className="flex flex-wrap gap-1.5">
              {['cpf', 'cnpj', 'email', 'telefone', 'aleatoria'].map(tipo => (
                <button
                  key={tipo}
                  type="button"
                  onClick={() => setPixTipo(tipo)}
                  className={`text-[9px] font-black uppercase tracking-wider px-3 py-2 rounded-lg border transition-all ${
                    pixTipo === tipo 
                      ? 'bg-neutral-900 text-white border-neutral-900' 
                      : 'bg-white text-neutral-500 border-neutral-200 hover:border-neutral-400'
                  }`}
                >
                  {tipo}
                </button>
              ))}
            </div>
            <Input
              value={pixChave}
              onChange={(e) => setPixChave(e.target.value)}
              placeholder="Digite sua chave aqui"
              className="h-12 rounded-xl border-neutral-200 font-medium"
            />
          </div>
        </div>
        
        <DialogFooter className="gap-3 sm:gap-0">
          <Button variant="ghost" onClick={onClose} className="font-bold">Cancelar</Button>
          <Button
            onClick={handleSolicitar}
            disabled={!podeSacar || enviando}
            className="bg-neutral-900 text-white h-12 px-8 rounded-xl font-black shadow-lg shadow-neutral-200 gap-2"
          >
            {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Confirmar Solicitação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BadgeStatus({ status }: { status: string }) {
  const configs: any = {
    pendente:   { label: 'Pendente',   class: 'bg-neutral-100 text-neutral-500 border-neutral-200' },
    disponivel: { label: 'Disponível', class: 'bg-green-100 text-green-700 border-green-200' },
    sacada:     { label: 'Sacada',     class: 'bg-blue-100 text-blue-700 border-blue-200' },
    cancelada:  { label: 'Cancelada',  class: 'bg-red-100 text-red-700 border-red-200' }
  };
  const config = configs[status] || configs.pendente;
  return <Badge className={`${config.class} border text-[9px] uppercase font-black px-2 py-0.5`}>{config.label}</Badge>;
}

function BadgeStatusSaque({ status }: { status: string }) {
  const configs: any = {
    pendente:  { label: 'Aguardando',  class: 'bg-amber-100 text-amber-700 border-amber-200' },
    aprovada:  { label: 'Aprovada',   class: 'bg-blue-100 text-blue-700 border-blue-200' },
    paga:      { label: 'Pago via PIX', class: 'bg-green-100 text-green-700 border-green-200' },
    rejeitada: { label: 'Rejeitada',  class: 'bg-red-100 text-red-700 border-red-200' },
    cancelada: { label: 'Cancelada',  class: 'bg-neutral-100 text-neutral-500 border-neutral-200' }
  };
  const config = configs[status] || configs.pendente;
  return <Badge className={`${config.class} border text-[9px] uppercase font-black px-2 py-0.5`}>{config.label}</Badge>;
}
