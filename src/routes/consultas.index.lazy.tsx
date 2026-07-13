import { createLazyFileRoute, Link } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { RouteErrorFallback } from "@/components/RouteErrorFallback";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { Search, Filter, Plus, FileText, ChevronRight, User, MapPin, DollarSign, Calendar } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { toast } from "sonner";
import { formatDocumento, isNomeValido } from "@/lib/consultasCredito";

export const Route = createLazyFileRoute("/consultas/")({
  component: () => (
    <ProtectedRoute>
      <Consultas />
    </ProtectedRoute>
  ),
  errorComponent: ({ error, reset }) => (
    <RouteErrorFallback error={error} reset={reset} message="Não foi possível carregar as consultas. Tente novamente ou verifique suas permissões." />
  ),
});

function Consultas() {
  const { user } = useAuth();
  const [consultas, setConsultas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("todos");

  useEffect(() => {
    fetchConsultas();
  }, [user]);

  const fetchConsultas = async () => {
    try {
      setLoading(true);

      if (!user?.email) {
        setConsultas([]);
        return;
      }

      const { data: meuProfile, error: profileError } = await supabase
        .from('profiles')
        .select('id, role')
        .eq('email', user.email)
        .maybeSingle();

      if (profileError) throw profileError;

      let query = supabase
        .from('consultas_credito')
        .select(`
          *,
          inquilinos (nome, cpf, cnpj),
          imoveis (logradouro, numero, bairro, cidade, estado, cep, valor_aluguel),
          planos (nome),
          solicitante:profiles!profile_id_solicitante (nome, email, role)
        `);

      const role = user?.role;
      if (role === 'admin' || role === 'analista') {
        // vê tudo
      } else if (role === 'imobiliaria' && meuProfile) {
        const { data: imobData } = await supabase
          .from('imobiliarias')
          .select('id')
          .eq('contato_email', user?.email || '')
          .maybeSingle();

        let allowedProfileIds: string[] = [meuProfile.id];
        if (imobData?.id) {
          const { data: corretoresData } = await supabase
            .from('corretores')
            .select('profile_id')
            .eq('imobiliaria_id', imobData.id);
          if (corretoresData) {
            allowedProfileIds = [
              ...allowedProfileIds,
              ...corretoresData.map((c: any) => c.profile_id).filter(Boolean),
            ];
          }
        }
        query = query.in('profile_id_solicitante', allowedProfileIds);
      } else if (meuProfile) {
        query = query.or(`profile_id_solicitante.eq.${meuProfile.id},and(profile_id_solicitante.is.null,role_solicitante.eq.${role})`);
      } else {
        query = query.eq('role_solicitante', role || '');
      }

      const { data, error } = await query.order('updated_at', { ascending: false });

      if (error) throw error;
      setConsultas(data || []);
    } catch (error: any) {
      toast.error("Erro ao carregar consultas: " + error.message);
    } finally {
      setLoading(false);
    }
  };



  // `resultado` guarda o veredito da consulta de crédito de forma permanente — a
  // automação só grava aprovado/recusado/em_analise/erro ali e nunca mais mexe depois.
  // Já `status` é o ponteiro de etapa da proposta inteira (pendente, processando,
  // pendente_documentacao, aguardando_ativacao, ativo, etc.) e muda conforme o corretor
  // avança (ex.: escolhe um plano). Preferir `resultado` aqui garante que "Minhas
  // Consultas" sempre mostre o resultado real da análise, mesmo depois de a proposta
  // avançar para as próximas etapas.
  const getStatusConsulta = (c: any) => {
    const resultadosFinais = ['aprovado', 'recusado', 'reprovado', 'em_analise'];
    const status = resultadosFinais.includes(c.resultado) ? c.resultado : c.status;

    if (status === 'aprovado') return 'aprovado';
    if (status === 'recusado' || status === 'reprovado') return 'recusado';
    if (status === 'em_analise') return 'em_analise';
    if (status === 'erro') return 'erro';
    if (status === 'processando') return 'processando';
    if (status === 'pendente' || !status) return 'pendente';
    // Qualquer outro status (pendente_documentacao, aguardando_ativacao, ativo...) só foi
    // alcançado porque a consulta já passou pela análise de crédito com aprovação — nunca
    // deve cair em "Pendente" por falta do campo `resultado` (dados legados/manuais que
    // avançaram a proposta sem nunca ter passado pela automação de verdade).
    return 'aprovado';
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      aprovado: 'Aprovado',
      recusado: 'Recusado',
      em_analise: 'Em análise',
      erro: 'Erro',
      processando: 'Consultando...',
      pendente: 'Pendente',
    };
    return labels[status] ?? status;
  };

  const getStatusBadge = (c: any) => {
    const status = getStatusConsulta(c);
    switch (status) {
      case 'aprovado':
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 font-bold px-3">Aprovado</Badge>;
      case 'recusado':
      case 'reprovado':
        return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 font-bold px-3">Recusado</Badge>;
      case 'em_analise':
        return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 font-bold px-3">Em análise</Badge>;
      case 'erro':
        return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 font-bold px-3">Erro</Badge>;
      case 'processando':
        return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 font-bold px-3">Consultando...</Badge>;
      case 'pendente':
      default:
        return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 font-bold px-3">Pendente</Badge>;
    }
  };

  const formatarEnderecoConsulta = (c: any): string => {
    if (c.property_address && c.property_address.replace(/[,\s]/g, '').length > 0) return c.property_address;
    const im = c.imoveis;
    if (im) {
      const partes = [im.logradouro, im.numero, im.bairro, im.cidade, im.estado]
        .map((p: any) => (typeof p === 'string' ? p.trim() : ''))
        .filter(Boolean);
      if (partes.length > 0) return partes.join(', ');
      if (im.cep) return `CEP ${im.cep}`;
    }
    return 'Endereço não informado';
  };

  const getDoc = (c: any) => c.documento || c.tenant_document || c.inquilinos?.cpf || c.inquilinos?.cnpj || '—';

  // `documento`/`tenant_name` são a fonte mais confiável para consultas passadas pela
  // automação (a CredPago confirma nome/documento do cliente) — o join com `inquilinos`
  // só entra como fallback para consultas que nunca passaram pela automação. Em telas de
  // recusado a CredPago frequentemente não retorna nome nenhum (ver isNomeValido) — nesse
  // caso mostra só os 3 primeiros dígitos do CPF/CNPJ em vez de "Nome não informado", pra
  // ainda dar alguma referência de qual cliente foi recusado.
  const getNome = (c: any) => {
    if (isNomeValido(c.tenant_name)) return c.tenant_name;
    if (isNomeValido(c.inquilinos?.nome)) return c.inquilinos.nome;
    if (getStatusConsulta(c) === 'recusado') {
      const digits = getDoc(c).replace(/\D/g, '');
      if (digits.length >= 3) return `CPF ${digits.slice(0, 3)}...`;
    }
    return 'Nome não informado';
  };
  const getAluguel = (c: any) => Number(c.rent_value ?? c.imoveis?.valor_aluguel ?? 0);

  const q = searchQuery.toLowerCase();
  const qDigits = searchQuery.replace(/\D/g, '');
  const filteredConsultas = consultas.filter(c => {
    const status = getStatusConsulta(c);
    if (statusFilter !== 'todos' && status !== statusFilter) return false;

    return (
      getNome(c).toLowerCase().includes(q) ||
      (qDigits && getDoc(c).includes(qDigits)) ||
      formatarEnderecoConsulta(c).toLowerCase().includes(q) ||
      getStatusLabel(status).toLowerCase().includes(q) ||
      c.planos?.nome?.toLowerCase().includes(q)
    );
  });


  return (
    <DashboardLayout>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
        <div>
          <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">Consultas de Crédito</h1>
          <p className="text-neutral-500 mt-2 font-medium">Acompanhe todas as simulações e análises em tempo real.</p>
        </div>
      </div>


      <div className="flex flex-col md:flex-row gap-4 mb-8">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
          <Input 
            placeholder="Buscar por nome, CPF/CNPJ, endereço, status ou plano..."
            className="pl-12 h-14 bg-white border-neutral-200 rounded-xl shadow-sm focus:ring-yellow-400"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-14 w-full justify-center rounded-xl border-neutral-200 bg-white px-4 text-xs font-normal text-neutral-700 shadow-sm hover:bg-neutral-50 md:w-44 [&>svg]:hidden">
            <div className="flex items-center justify-center gap-2">
              <Filter size={15} strokeWidth={1.8} className="text-neutral-500 shrink-0" />
              <span className="tracking-wide">FILTRAR</span>
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            <SelectItem value="aprovado">Aprovados</SelectItem>
            <SelectItem value="recusado">Recusados</SelectItem>
            <SelectItem value="em_analise">Em análise</SelectItem>
            <SelectItem value="pendente">Pendentes</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="border-neutral-200 shadow-sm overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-neutral-50/50 border-b border-neutral-100">
                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-neutral-400">Inquilino / CPF</th>
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-neutral-400">Imóvel / Valor</th>
                {user?.role === 'imobiliaria' && (
                  <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-neutral-400">Corretor</th>
                )}
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-neutral-400">Plano</th>
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-neutral-400 text-center">Status</th>
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-neutral-400 text-center">Data</th>
                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-neutral-400 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {loading ? (
                <tr>
                  <td colSpan={7} className="h-64 text-center">
                    <div className="flex flex-col items-center justify-center space-y-3">
                      <div className="w-8 h-8 border-4 border-neutral-200 border-t-yellow-400 rounded-full animate-spin" />
                      <p className="text-sm font-bold text-neutral-500 uppercase tracking-widest">Carregando consultas...</p>
                    </div>
                  </td>
                </tr>
              ) : filteredConsultas.length === 0 ? (
                <tr>
                  <td colSpan={7} className="h-64 text-center">
                    <div className="flex flex-col items-center justify-center space-y-4">
                      <div className="w-16 h-16 rounded-full bg-neutral-50 flex items-center justify-center text-neutral-300">
                        <FileText size={32} />
                      </div>
                      <div className="max-w-xs mx-auto">
                        <p className="text-neutral-900 font-bold">Nenhuma consulta encontrada</p>
                        <p className="text-neutral-500 text-sm mt-1">Use a aba “Nova Consulta” no menu lateral para iniciar uma simulação.</p>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : filteredConsultas.map((c) => {
                const nome = getNome(c);
                const doc = getDoc(c);
                const endereco = formatarEnderecoConsulta(c);
                const aluguel = getAluguel(c);
                return (
                <tr key={c.id} className="hover:bg-neutral-50/50 transition-colors group">
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-yellow-400 flex items-center justify-center font-black text-neutral-900 text-xs">
                        {nome.substring(0, 1).toUpperCase()}
                      </div>
                      <div className="flex flex-col">
                        <span className="font-bold text-neutral-900 group-hover:text-neutral-900 transition-colors">{nome}</span>
                        <span className="text-xs text-neutral-500 font-medium">{doc === '—' ? doc : formatDocumento(doc)}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-6">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5 text-xs text-neutral-600 font-bold">
                        <MapPin size={12} className="text-neutral-400" />
                        {endereco}
                      </div>
                      <div className="flex items-center gap-1.5 text-sm text-neutral-900 font-black mt-1">
                        <DollarSign size={14} className="text-green-600" />
                        {aluguel.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </div>
                    </div>
                  </td>
                  {user?.role === 'imobiliaria' && (
                    <td className="px-6 py-6">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-neutral-100 flex items-center justify-center text-[10px] font-bold text-neutral-500">
                          {c.solicitante?.nome?.charAt(0) || '?'}
                        </div>
                        <span className="text-xs font-bold text-neutral-700">{c.solicitante?.nome || '—'}</span>
                      </div>
                    </td>
                  )}
                  <td className="px-6 py-6">
                    {/* Plano só aparece depois que o pagamento é confirmado — antes disso,
                        escolher um plano na tela de resultado não significa que foi comprado. */}
                    <span className="text-xs font-black text-neutral-500 uppercase tracking-wider">
                      {c.payment_status === 'aprovado' ? (c.planos?.nome || 'N/D') : 'NENHUM'}
                    </span>
                  </td>
                  <td className="px-6 py-6 text-center">
                    {getStatusBadge(c)}
                  </td>
                  <td className="px-6 py-6 text-center">
                    <div className="flex flex-col items-center">
                      <span className="text-xs font-bold text-neutral-900">{new Date(c.updated_at || c.created_at).toLocaleDateString('pt-BR')}</span>
                      <span className="text-[10px] text-neutral-400 font-medium uppercase">{new Date(c.updated_at || c.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </td>
                  <td className="px-8 py-6 text-right">
                    <Link to={`/consultas/${c.id}/resultado` as any}>
                      <Button variant="ghost" size="sm" className="h-10 px-4 rounded-xl font-black text-xs text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 gap-2">
                        DETALHES
                        <ChevronRight size={14} />
                      </Button>
                    </Link>
                  </td>
                </tr>
                );
              })}

            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-6 bg-blue-50 border border-blue-100 rounded-2xl flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shrink-0">
            <Calendar size={20} />
          </div>
          <div>
            <h4 className="font-bold text-blue-900 text-sm">Atualizações em Tempo Real</h4>
            <p className="text-xs text-blue-700 mt-1 leading-relaxed">As análises de crédito são processadas automaticamente. Fique atento às notificações para ver quando o status mudar.</p>
          </div>
        </div>
        
        <div className="p-6 bg-yellow-50 border border-yellow-100 rounded-2xl flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-yellow-400 flex items-center justify-center text-neutral-900 shrink-0">
            <User size={20} />
          </div>
          <div>
            <h4 className="font-bold text-yellow-900 text-sm">Suporte Especializado</h4>
            <p className="text-xs text-yellow-700 mt-1 leading-relaxed">Dúvidas sobre uma reprovação ou análise pendente? Fale com nosso time de analistas via chat direto.</p>
          </div>
        </div>

        <div className="p-6 bg-green-50 border border-green-100 rounded-2xl flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-green-600 flex items-center justify-center text-white shrink-0">
            <Check size={20} />
          </div>
          <div>
            <h4 className="font-bold text-green-900 text-sm">Conversão Facilitada</h4>
            <p className="text-xs text-green-700 mt-1 leading-relaxed">Consultas aprovadas podem ser transformadas em apólices ativas com apenas um clique nos detalhes.</p>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Check(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
