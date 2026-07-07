import { createFileRoute, Link } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { NivelCorretorCard } from "@/components/NivelCorretorCard";
import { JuridicoDashboard } from "@/components/JuridicoDashboard";
import { FinanceiroDashboard } from "@/components/FinanceiroDashboard";
import { MarketingDashboard } from "@/components/MarketingDashboard";
import { Trophy, Search, FileText, Users, DollarSign, ArrowUpRight, TrendingUp, Home, AlertCircle, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { Card } from "@/components/ui/card";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";


export const Route = createFileRoute("/dashboard")({
  component: () => (
    <ProtectedRoute>
      <Dashboard />
    </ProtectedRoute>
  ),
});

function Dashboard() {
  const { user } = useAuth();
  const isJuridico = user?.internalRole === "juridico" || user?.role === "juridico";
  const isFinanceiro = user?.internalRole === "financeiro" || user?.role === "financeiro";
  const isMarketing = user?.internalRole === "marketing" || user?.role === "marketing";
  const isCorretor = user?.role === "corretor" && !isJuridico && !isFinanceiro && !isMarketing;
  const isImobiliaria = user?.role === "imobiliaria";
  const isProprietario = user?.role === "proprietario";
  const isAdmin = (user?.role === "admin" || user?.role === "analista") && !isJuridico && !isFinanceiro && !isMarketing;

  if (isJuridico) {
    return (
      <DashboardLayout>
        <JuridicoDashboard />
      </DashboardLayout>
    );
  }

  if (isFinanceiro) {
    return (
      <DashboardLayout>
        <FinanceiroDashboard />
      </DashboardLayout>
    );
  }

  if (isMarketing) {
    return (
      <DashboardLayout>
        <MarketingDashboard />
      </DashboardLayout>
    );
  }



  const [consultasRecentes, setConsultasRecentes] = useState<any[]>([]);
  const [loadingConsultas, setLoadingConsultas] = useState(true);

  useEffect(() => {
    (async () => {
      if (!user?.email) { setLoadingConsultas(false); return; }
      try {
        const { data: meuProfile } = await supabase
          .from('profiles')
          .select('id, role')
          .eq('email', user.email)
          .maybeSingle();

        let q = supabase
          .from('consultas_credito')
          .select(`id, status, created_at, inquilinos (nome, cpf, cnpj), imoveis (valor_aluguel)`)
          .order('created_at', { ascending: false })
          .limit(5);

        if (!isAdmin && meuProfile) {
          if (isImobiliaria) {
            const { data: imob } = await supabase
              .from('imobiliarias').select('id').eq('contato_email', user.email).maybeSingle();
            let ids = [meuProfile.id];
            if (imob?.id) {
              const { data: corretoresData } = await supabase
                .from('corretores').select('profile_id').eq('imobiliaria_id', imob.id);
              ids = [...ids, ...(corretoresData || []).map((c: any) => c.profile_id).filter(Boolean)];
            }
            q = q.in('profile_id_solicitante', ids);
          } else {
            q = q.eq('profile_id_solicitante', meuProfile.id);
          }
        } else if (!isAdmin) {
          setConsultasRecentes([]); setLoadingConsultas(false); return;
        }

        const { data } = await q;
        setConsultasRecentes(data || []);
      } finally {
        setLoadingConsultas(false);
      }
    })();
  }, [user?.email, isAdmin, isImobiliaria]);

  const demoNivel = {
    nome: isCorretor ? "Prata" : "Ouro",
    percentual: isCorretor ? 7 : 9,
    cor: "#FACC15",
    icone: Trophy,
    contratos: isCorretor ? 15 : 24,
    proximoNivel: isCorretor ? "Ouro" : "Diamante",
    metaProximo: isCorretor ? 21 : 31
  };


  return (
    <DashboardLayout>
      <div className="space-y-4 sm:space-y-8 lg:space-y-10">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-6">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-neutral-900 tracking-tight truncate">
              {isAdmin ? "Painel Administrativo" : isImobiliaria ? "Painel Imobiliária" : isProprietario ? "Painel Proprietário" : "Painel do Corretor"}
            </h1>
            <p className="text-neutral-500 mt-1 sm:mt-2 font-medium text-xs sm:text-sm lg:text-base">Acompanhe o desempenho e as operações da sua conta.</p>
          </div>
          {(isCorretor || isImobiliaria) && (
            <div className="flex items-center gap-3 sm:gap-4 bg-white border border-neutral-200 p-2 sm:p-3 pr-4 sm:pr-6 rounded-lg shadow-sm shrink-0">
              <div className="w-9 h-9 sm:w-12 sm:h-12 rounded-lg bg-[#FACC15] flex items-center justify-center border border-neutral-200 shrink-0">
                <Trophy className="text-neutral-900 w-5 h-5 sm:w-6 sm:h-6" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-[9px] sm:text-[10px] text-neutral-400 font-bold uppercase tracking-widest">Nível de Parceria</p>
                <p className="text-sm sm:text-lg font-bold text-neutral-900 leading-tight">
                  {isCorretor ? "PRATA" : "OURO"}
                </p>
              </div>
            </div>
          )}
        </div>

        {(isCorretor || isImobiliaria) && <NivelCorretorCard info={demoNivel} />}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
          <CardStats title={isProprietario ? "Imóveis Cadastrados" : "Consultas Pendentes"} value={isAdmin ? "42" : isImobiliaria ? "18" : isProprietario ? "3" : "7"} icon={isAdmin || isImobiliaria || isCorretor ? Search : Home} trend="+2 hoje" trendUp={true} />
          <CardStats title={isProprietario ? "Renda Mensal Total" : "Apólices Ativas"} value={isAdmin ? "1.240" : isImobiliaria ? "42" : isProprietario ? "R$ 14.500" : "15"} icon={FileText} />
          <CardStats title={isProprietario ? "Recebimentos no Mês" : "Inquilinos sob Gestão"} value={isAdmin ? "850" : isImobiliaria ? "38" : isProprietario ? "R$ 12.850" : "12"} icon={Users} />
          <CardStats title={isProprietario ? "Sinistros Ativos" : "Comissões Acumuladas"} value={isAdmin ? "R$ 142.500" : isImobiliaria ? "R$ 8.420" : isProprietario ? "0" : "R$ 2.850"} icon={isProprietario ? AlertCircle : DollarSign} isCurrency={true} />
        </div>

        {isProprietario && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 sm:p-6">
            <h3 className="font-bold text-yellow-900 text-base sm:text-lg mb-1 sm:mb-2">Tranquilidade NOX</h3>
            <p className="text-xs sm:text-sm text-yellow-800">Seus imóveis estão protegidos pela NOX FIANÇA. Em caso de inadimplência, o aluguel é garantido pela cobertura contratada.</p>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}

function CardStats({ title, value, icon: Icon, trend, trendUp }: { title: string; value: string; icon: any; trend?: string; trendUp?: boolean; isCurrency?: boolean }) {
  return (
    <div className="p-3 sm:p-5 lg:p-8 bg-white border border-neutral-200 rounded-xl hover:shadow-lg hover:border-neutral-300 transition-all group relative overflow-hidden">
      <div className="flex items-start justify-between mb-3 sm:mb-6 lg:mb-8 gap-2">
        <div className="p-2 sm:p-3 bg-neutral-50 rounded-lg border border-neutral-100 group-hover:bg-neutral-900 group-hover:text-white transition-all shrink-0">
          <Icon className="w-4 h-4 sm:w-5 sm:h-5 lg:w-[22px] lg:h-[22px]" strokeWidth={1.5} />
        </div>
        {trend && (
          <div className={`flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-full text-[9px] sm:text-[10px] font-bold whitespace-nowrap ${trendUp ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-neutral-50 text-neutral-500 border border-neutral-100'}`}>
            <TrendingUp size={10} className="sm:w-3 sm:h-3" />
            {trend}
          </div>
        )}
      </div>
      <p className="text-[10px] sm:text-xs text-neutral-400 font-bold uppercase tracking-wider sm:tracking-widest mb-1 truncate">{title}</p>
      <h3 className="text-lg sm:text-2xl lg:text-3xl font-bold text-neutral-900 tracking-tight tabular-nums">{value}</h3>
    </div>
  );
}
