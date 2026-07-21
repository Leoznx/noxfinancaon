import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useState, useEffect, useCallback } from "react";
import { 
  Bell, 
  Search, 
  Filter, 
  CheckCircle, 
  Clock, 
  Trash2, 
  ExternalLink,
  DollarSign,
  Wallet,
  Trophy,
  FileCheck,
  FileX,
  Megaphone,
  Sparkles,
  MoreVertical,
  ChevronRight
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/painel/notificacoes")({
  component: () => (
    <ProtectedRoute>
      <NotificacoesPage />
    </ProtectedRoute>
  ),
});

const ICONES_NOTIFICACAO: Record<string, any> = {
  comissao_nova: DollarSign,
  comissao_liberada: CheckCircle,
  saque_aprovado: Wallet,
  saque_pago: CheckCircle,
  nivel_subiu: Trophy,
  contrato_aprovado: FileCheck,
  contrato_reprovado: FileX,
  sistema: Megaphone,
  atualizacao: Sparkles,
};

const CORES_NOTIFICACAO: Record<string, { fundo: string; icone: string; badge: string }> = {
  verde: { fundo: 'bg-green-100', icone: 'text-green-700', badge: 'bg-green-100 text-green-700' },
  amarelo: { fundo: 'bg-yellow-100', icone: 'text-yellow-700', badge: 'bg-yellow-100 text-yellow-700' },
  azul: { fundo: 'bg-blue-100', icone: 'text-blue-700', badge: 'bg-blue-100 text-blue-700' },
  vermelho: { fundo: 'bg-red-100', icone: 'text-red-700', badge: 'bg-red-100 text-red-700' },
  cinza: { fundo: 'bg-neutral-100', icone: 'text-neutral-700', badge: 'bg-neutral-100 text-neutral-700' },
};

function NotificacoesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notificacoes, setNotificacoes] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState('todas'); // 'todas', 'nao_lidas'
  const [busca, setBusca] = useState('');

  const carregarNotificacoes = useCallback(async () => {
    if (!user) {
      setCarregando(false);
      return;
    }
    setCarregando(true);
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) return;

      let query = supabase
        .from('notificacoes')
        .select('*')
        .eq('user_id', authUser.id)
        .order('created_at', { ascending: false });

      if (filtro === 'nao_lidas') {
        query = query.eq('lida', false);
      }

      const { data } = await query;
      setNotificacoes(data || []);
    } finally {
      setCarregando(false);
    }
  }, [filtro, user]);

  useEffect(() => {
    carregarNotificacoes();
  }, [carregarNotificacoes]);

  async function marcarLida(id: string) {
    await supabase
      .from('notificacoes')
      .update({ lida: true, lida_em: new Date().toISOString() })
      .eq('id', id);
    
    setNotificacoes(prev => prev.map(n => n.id === id ? { ...n, lida: true } : n));
  }

  async function excluirNotificacao(id: string) {
    await supabase.from('notificacoes').delete().eq('id', id);
    setNotificacoes(prev => prev.filter(n => n.id !== id));
  }

  const notificacoesFiltradas = notificacoes.filter(n => 
    n.titulo.toLowerCase().includes(busca.toLowerCase()) || 
    n.mensagem.toLowerCase().includes(busca.toLowerCase())
  );

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-700">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <h1 className="text-3xl font-black text-neutral-900 tracking-tight">Notificações</h1>
            <p className="text-sm text-neutral-500 font-medium mt-1">Gerencie todos os seus alertas e avisos da plataforma.</p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" className="rounded-xl font-bold text-xs uppercase tracking-widest h-11 border-neutral-200">
              Marcar todas como lidas
            </Button>
          </div>
        </header>

        <div className="flex flex-col md:flex-row items-center gap-4 bg-white p-4 rounded-2xl border border-neutral-100 shadow-sm">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400 w-4 h-4" />
            <Input 
              placeholder="Buscar nas notificações..." 
              className="pl-11 h-12 bg-neutral-50 border-transparent rounded-xl focus:bg-white focus:border-neutral-200" 
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 bg-neutral-50 p-1.5 rounded-xl border border-neutral-100">
            <button 
              onClick={() => setFiltro('todas')}
              className={`px-6 py-2.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${filtro === 'todas' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-400 hover:text-neutral-600'}`}
            >
              Todas
            </button>
            <button 
              onClick={() => setFiltro('nao_lidas')}
              className={`px-6 py-2.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${filtro === 'nao_lidas' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-400 hover:text-neutral-600'}`}
            >
              Não lidas
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {carregando ? (
            <div className="p-20 text-center">
              <div className="w-10 h-10 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-neutral-400 mt-6">Carregando seus alertas...</p>
            </div>
          ) : notificacoesFiltradas.length === 0 ? (
            <div className="bg-white border-2 border-dashed border-neutral-100 rounded-3xl p-20 text-center">
              <div className="w-20 h-20 bg-neutral-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
                <Bell className="w-10 h-10 text-neutral-200" strokeWidth={1.5} />
              </div>
              <h3 className="text-lg font-black text-neutral-900">Nenhuma notificação encontrada</h3>
              <p className="text-sm text-neutral-500 mt-2 max-w-xs mx-auto">Você está em dia com todos os seus alertas ou o filtro aplicado não retornou resultados.</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {notificacoesFiltradas.map((notif) => {
                const cor = CORES_NOTIFICACAO[notif.cor_destaque || 'cinza'];
                const Icone = ICONES_NOTIFICACAO[notif.tipo] || Bell;
                
                return (
                  <div 
                    key={notif.id}
                    className={`bg-white border rounded-2xl p-6 transition-all hover:border-neutral-200 group flex items-start gap-6 ${
                      !notif.lida ? 'border-yellow-100 bg-yellow-50/20 shadow-sm' : 'border-neutral-100'
                    }`}
                  >
                    <div className={`${cor.fundo} rounded-2xl p-4 text-neutral-900 shadow-sm`}>
                      <Icone className={`w-6 h-6 ${cor.icone}`} strokeWidth={2.5} />
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-3">
                            <h4 className="text-lg font-black text-neutral-900 tracking-tight">{notif.titulo}</h4>
                            {!notif.lida && (
                              <Badge className="bg-yellow-400 text-neutral-900 hover:bg-yellow-400 border-none font-black text-[9px] uppercase tracking-widest px-2 py-0.5">Nova</Badge>
                            )}
                          </div>
                          <p className="text-sm text-neutral-600 leading-relaxed font-medium">
                            {notif.mensagem}
                          </p>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl hover:bg-neutral-50 text-neutral-400">
                                <MoreVertical size={18} />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56 rounded-xl p-2">
                              {!notif.lida && (
                                <DropdownMenuItem onClick={() => marcarLida(notif.id)} className="rounded-lg gap-2 cursor-pointer font-bold text-xs py-2.5">
                                  <CheckCircle size={16} className="text-green-600" />
                                  Marcar como lida
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => excluirNotificacao(notif.id)} className="rounded-lg gap-2 cursor-pointer font-bold text-xs py-2.5 text-red-600 focus:text-red-600">
                                <Trash2 size={16} />
                                Excluir alerta
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                      
                      <div className="mt-6 pt-4 border-t border-neutral-50 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-1.5 text-neutral-400">
                            <Clock size={14} />
                            <span className="text-[10px] font-black uppercase tracking-widest">
                              {format(new Date(notif.created_at), "dd 'de' MMMM 'às' HH:mm", { locale: ptBR })}
                            </span>
                          </div>
                          <Badge className={`${cor.badge} border-none font-black text-[9px] uppercase tracking-widest`}>
                            {notif.tipo.replace('_', ' ')}
                          </Badge>
                        </div>
                        
                        {notif.link && (
                          <Button
                            variant="ghost"
                            className="text-xs font-black text-neutral-900 hover:bg-neutral-50 h-9 px-4 rounded-xl gap-2 group/btn"
                            onClick={() => {
                              if (!notif.lida) marcarLida(notif.id);
                              navigate({ to: notif.link as any });
                            }}
                          >
                            Acessar detalhes
                            <ChevronRight size={14} className="transition-transform group-hover/btn:translate-x-1" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
