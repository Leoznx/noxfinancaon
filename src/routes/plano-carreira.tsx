import { createFileRoute, Link } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useState, useEffect } from 'react';
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { Medal, Award, Trophy, Gem, AlertCircle, Check, RefreshCw, ChevronRight } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/plano-carreira")({
  component: () => (
    <ProtectedRoute roles={["corretor", "imobiliaria", "proprietario"]}>
      <PlanoCarreiraPage />
    </ProtectedRoute>
  ),
});

// Configuração estática dos níveis por perfil
const NIVEIS_UNIFICADOS = [
  { nome: 'BRONZE',   min: 0,   max: 10,   percentual: 1.0, bonusRenovacao: 0 },
  { nome: 'PRATA',    min: 11,  max: 20,   percentual: 1.5, bonusRenovacao: 0 },
  { nome: 'OURO',     min: 21,  max: 30,   percentual: 2.0, bonusRenovacao: 0 },
  { nome: 'DIAMANTE', min: 31,  max: null, percentual: 2.5, bonusRenovacao: 0 },
];

const NIVEIS_FALLBACK = {
  corretor: NIVEIS_UNIFICADOS,
  imobiliaria: NIVEIS_UNIFICADOS,
  proprietario: NIVEIS_UNIFICADOS,
};

const CORES_NIVEL = {
  BRONZE: { 
    fundo: 'bg-gradient-to-br from-amber-50 to-amber-100', 
    borda: 'border-amber-300',
    icone: 'bg-amber-100 text-amber-700',
    texto: 'text-amber-900',
    percentual: 'text-amber-700',
    Icone: Medal,
  },
  PRATA: { 
    fundo: 'bg-gradient-to-br from-slate-50 to-slate-200', 
    borda: 'border-slate-300',
    icone: 'bg-slate-200 text-slate-700',
    texto: 'text-slate-900',
    percentual: 'text-slate-700',
    Icone: Award,
  },
  OURO: { 
    fundo: 'bg-gradient-to-br from-yellow-50 to-yellow-200', 
    borda: 'border-yellow-400',
    icone: 'bg-yellow-400 text-neutral-900',
    texto: 'text-yellow-900',
    percentual: 'text-yellow-700',
    Icone: Trophy,
  },
  DIAMANTE: { 
    fundo: 'bg-gradient-to-br from-cyan-50 to-blue-100', 
    borda: 'border-cyan-400',
    icone: 'bg-cyan-100 text-cyan-700',
    texto: 'text-cyan-900',
    percentual: 'text-cyan-700',
    Icone: Gem,
  },
};

const IMAGENS_CARD_NIVEL = {
  BRONZE: '/assets/nox-icon-fidelidade-bronze.png',
  PRATA: '/assets/nox-icon-fidelidade-prata.png',
  OURO: '/assets/nox-icon-fidelidade-ouro.png',
  DIAMANTE: '/assets/nox-icon-fidelidade-diamante.png',
};

const textosPorPerfil = {
  corretor: {
    titulo: 'Plano de Carreira',
    subtitulo: 'Sua jornada na NOX FIANÇA. Quanto mais contratos ativos, maior sua comissão.',
    unidadeContagem: 'contratos ativos',
    comoFunciona: 'Seu nível é recalculado diariamente com base nos seus contratos ATIVOS vinculados ao seu CRECI. Mantenha sua carteira saudável para conservar ou subir de nível.',
    metricaPrincipal: '% sobre o aluguel',
  },
  imobiliaria: {
    titulo: 'Plano de Parceria',
    subtitulo: 'Sua imobiliária ganha mais quanto maior for o volume de contratos sob gestão.',
    unidadeContagem: 'contratos ativos sob gestão',
    comoFunciona: 'O nível da imobiliária é recalculado diariamente com base em todos os contratos ativos administrados pela sua equipe. Conforme a operação cresce, a comissão aumenta automaticamente.',
    metricaPrincipal: '% sobre o aluguel',
  },
  proprietario: {
    titulo: 'Plano de Fidelidade',
    subtitulo: 'Quanto mais imóveis seus na plataforma, mais bônus e cashback você recebe.',
    unidadeContagem: 'imóveis cadastrados',
    comoFunciona: 'Seu nível é definido pelo número de imóveis ativos cadastrados no seu nome. A cada nova locação garantida, você ganha cashback proporcional e um bônus fixo na renovação anual.',
    metricaPrincipal: 'cashback + bônus',
  },
};

const beneficiosPorPerfilENivel = {
  corretor: {
    BRONZE:   ['Comissão sobre cada contrato', 'Painel de carteira'],
    PRATA:    ['Comissão sobre cada contrato', 'Painel de carteira', 'Suporte prioritário WhatsApp', 'Selo Prata no perfil'],
    OURO:     ['Comissão sobre cada contrato', 'Painel de carteira', 'Suporte prioritário WhatsApp', 'Selo Ouro no perfil', 'Materiais de marketing exclusivos'],
    DIAMANTE: ['Comissão sobre cada contrato', 'Painel de carteira', 'Suporte VIP 24h', 'Selo Diamante', 'Materiais exclusivos', 'Eventos NOX', 'Bônus anual de performance'],
  },
  imobiliaria: {
    BRONZE:   ['Comissão sobre cada contrato', 'Dashboard de equipe'],
    PRATA:    ['Comissão sobre cada contrato', 'Dashboard de equipe', 'Selo Parceira Prata', 'Suporte dedicado'],
    OURO:     ['Comissão sobre cada contrato', 'Dashboard de equipe', 'Selo Parceira Ouro', 'Suporte dedicado', 'Co-branding em materiais'],
    DIAMANTE: ['Comissão sobre cada contrato', 'Dashboard de equipe', 'Selo Diamante', 'Gerente de conta exclusivo', 'Co-branding', 'Eventos exclusivos NOX', 'Programa de incentivos anual'],
  },
  proprietario: {
    BRONZE:   ['Cashback por contrato fechado', 'Painel de imóveis'],
    PRATA:    ['Cashback aumentado', 'Bônus de R$ 80 por renovação', 'Painel completo', 'Suporte preferencial'],
    OURO:     ['Cashback de 2% sobre prêmio', 'Bônus de R$ 150 por renovação', 'Suporte VIP', 'Vistoria gratuita anual'],
    DIAMANTE: ['Cashback de 3% sobre prêmio', 'Bônus de R$ 250 por renovação', 'Concierge dedicado', 'Vistoria semestral gratuita', 'Acesso a investimentos imobiliários NOX'],
  },
};

function BadgeNivelAtual({ nivel, contratos }: { nivel: string; contratos: number }) {
  return (
    <div className="flex items-center gap-2 bg-neutral-100 px-3 py-1.5 rounded-full border border-neutral-200 shadow-sm">
      <div className={`w-2 h-2 rounded-full ${nivel === 'BRONZE' ? 'bg-amber-400' : nivel === 'PRATA' ? 'bg-slate-400' : nivel === 'OURO' ? 'bg-yellow-400' : 'bg-cyan-400'} animate-pulse`} />
      <span className="text-xs font-bold text-neutral-700">{nivel} • {contratos} contratos</span>
    </div>
  );
}

function CardProgresso({ nivelAtual, proximoNivel, contratosAtivos, faltam, tipoPerfil }: any) {
  const meta = proximoNivel ? proximoNivel.min : (nivelAtual.max || contratosAtivos);
  const currentMin = nivelAtual.min;
  const progresso = proximoNivel 
    ? Math.min(100, ((contratosAtivos - currentMin) / (meta - currentMin)) * 100)
    : 100;
  const imagemProximoNivel = proximoNivel ? IMAGENS_CARD_NIVEL[proximoNivel.nome as keyof typeof IMAGENS_CARD_NIVEL] : null;

  return (
    <div className="bg-gradient-to-r from-neutral-900 to-neutral-800 rounded-2xl p-6 text-white shadow-xl shadow-neutral-200 border border-white/5">
      <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-6">
        <div className="flex-1 space-y-1">
          <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-400 font-bold">Progresso Atual</p>
          <div className="flex items-baseline gap-2">
            <h3 className="text-3xl font-black text-white">{contratosAtivos}</h3>
            <p className="text-sm text-neutral-400 font-medium">contratos ativos no seu {tipoPerfil === 'corretor' ? 'CRECI' : 'perfil'}</p>
          </div>
        </div>
        
        {proximoNivel && (
          <div className="bg-white/5 rounded-2xl p-4 border border-white/10 flex items-center gap-4">
            <div className={`flex items-center justify-center ${imagemProximoNivel ? 'h-14 w-14' : `w-12 h-12 rounded-xl ${CORES_NIVEL[proximoNivel.nome as keyof typeof CORES_NIVEL].icone}`}`}>
              <IconePorNivel nivel={proximoNivel.nome} size={imagemProximoNivel ? 56 : 24} />
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-widest text-neutral-500 font-black mb-1">Próximo Nível</p>
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold">{proximoNivel.nome}</span>
                <Badge className="bg-yellow-400 text-neutral-900 font-bold">+{proximoNivel.percentual}%</Badge>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="relative h-4 bg-white/5 rounded-full overflow-hidden p-0.5 border border-white/5">
          <div 
            className="h-full bg-gradient-to-r from-yellow-500 to-yellow-300 rounded-full transition-all duration-1000 shadow-[0_0_20px_rgba(250,214,10,0.4)]"
            style={{ width: `${progresso}%` }}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer"></div>
          </div>
        </div>
        <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
          <span className="text-neutral-500">{nivelAtual.nome} ({nivelAtual.percentual}%)</span>
          {proximoNivel ? (
            <span className="text-yellow-400">Faltam {faltam} contratos para {proximoNivel.nome}</span>
          ) : (
            <span className="text-yellow-400">Parabéns! Você alcançou o nível máximo.</span>
          )}
        </div>
      </div>
    </div>
  );
}

function IconePorNivel({ nivel, size = 24 }: { nivel: string; size?: number }) {
  const imagemIcone = IMAGENS_CARD_NIVEL[nivel as keyof typeof IMAGENS_CARD_NIVEL];
  if (imagemIcone) {
    return (
      <img
        src={imagemIcone}
        alt={`Icone ${nivel}`}
        className="object-contain drop-shadow-sm"
        style={{ width: size, height: size }}
        draggable={false}
      />
    );
  }

  const config = CORES_NIVEL[nivel as keyof typeof CORES_NIVEL] || CORES_NIVEL.BRONZE;
  const Icone = config.Icone;
  return <Icone size={size} strokeWidth={2.5} />;
}

function CardNivel({ nivel, atual, tipoPerfil }: { nivel: any; atual: boolean; tipoPerfil: string }) {
  const config = CORES_NIVEL[nivel.nome as keyof typeof CORES_NIVEL] || CORES_NIVEL.BRONZE;
  const Icone = config.Icone;
  const imagemIcone = IMAGENS_CARD_NIVEL[nivel.nome as keyof typeof IMAGENS_CARD_NIVEL];
  const beneficios = beneficiosPorPerfilENivel[tipoPerfil as keyof typeof beneficiosPorPerfilENivel]?.[nivel.nome as keyof typeof CORES_NIVEL] || [];

  return (
    <div className={`relative rounded-2xl border-2 p-5 transition-all duration-500 ${config.fundo} ${
      atual 
        ? `${config.borda} scale-105 shadow-2xl z-10` 
        : `border-transparent opacity-60 hover:opacity-100 hover:scale-[1.02] hover:bg-white`
    }`}>
      {atual && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-neutral-900 text-yellow-400 text-[9px] font-black uppercase tracking-[0.2em] px-4 py-1.5 rounded-full shadow-xl whitespace-nowrap">
          Você está aqui
        </div>
      )}

      {imagemIcone ? (
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center">
          <img
            src={imagemIcone}
            alt={`Icone ${nivel.nome}`}
            className="h-16 w-16 object-contain drop-shadow-sm"
            draggable={false}
          />
        </div>
      ) : (
        <div className={`w-14 h-14 mx-auto mb-4 rounded-2xl ${config.icone} flex items-center justify-center shadow-sm`}>
          <Icone size={28} strokeWidth={2.5} />
        </div>
      )}

      <h3 className={`text-center text-xl font-black tracking-tight ${config.texto} mb-1`}>
        {nivel.nome}
      </h3>
      <p className="text-center text-[10px] text-neutral-500 font-bold uppercase tracking-widest mb-4">
        {nivel.max ? `${nivel.min} a ${nivel.max} contratos` : `${nivel.min}+ contratos`}
      </p>

      <div className="bg-white/50 backdrop-blur-sm rounded-xl p-3 mb-5 border border-white/50 text-center">
        <p className="text-[9px] uppercase tracking-widest text-neutral-500 font-black mb-1">
          {tipoPerfil === 'proprietario' ? 'Cashback + Bônus' : 'Comissão'}
        </p>
        <p className={`text-2xl font-black ${config.percentual}`}>
          {tipoPerfil === 'proprietario' ? (nivel.bonusRenovacao ? `R$ ${nivel.bonusRenovacao}` : `${nivel.percentual}%`) : `${nivel.percentual}%`}
        </p>
      </div>

      <ul className="space-y-2">
        {beneficios.map((b: string, i: number) => (
          <li key={i} className="flex items-start gap-2 text-xs font-medium text-neutral-700">
            <Check className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${atual ? 'text-green-600' : 'text-neutral-400'}`} strokeWidth={3} />
            <span className="leading-tight">{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BannerComoSubir({ tipoPerfil }: { tipoPerfil: string }) {
  const textos = textosPorPerfil[tipoPerfil as keyof typeof textosPorPerfil] || textosPorPerfil.corretor;
  return (
    <div className="bg-neutral-900 border border-white/5 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-6 overflow-hidden relative">
      <div className="absolute top-0 right-0 w-64 h-64 bg-yellow-400 opacity-[0.03] rounded-full blur-[80px] -mr-32 -mt-32"></div>
      <div className="flex items-start gap-5 relative z-10">
        <div className="bg-yellow-400 rounded-xl p-3 flex-shrink-0 shadow-lg shadow-yellow-400/20">
          <RefreshCw className="w-5 h-5 text-neutral-900" strokeWidth={2.5} />
        </div>
        <div className="space-y-1">
          <p className="text-lg font-black text-white">
            Como funciona a evolução
          </p>
          <p className="text-sm text-neutral-400 leading-relaxed max-w-2xl">
            {textos.comoFunciona}
          </p>
        </div>
      </div>
      
      <Link 
        to="/dicas-performance"
        className="bg-white hover:bg-neutral-100 text-neutral-900 h-12 px-6 rounded-xl font-black transition-all active:scale-95 flex items-center gap-2 group whitespace-nowrap relative z-10"
      >
        Ver Dicas de Performance
        <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" strokeWidth={2.5} />
      </Link>
    </div>
  );
}

function PlanoCarreiraSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex justify-between items-end">
        <div className="space-y-3">
          <div className="h-8 w-64 bg-neutral-200 rounded-lg"></div>
          <div className="h-4 w-96 bg-neutral-100 rounded-lg"></div>
        </div>
        <div className="h-10 w-40 bg-neutral-100 rounded-full"></div>
      </div>
      <div className="h-48 bg-neutral-200 rounded-2xl"></div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-80 bg-neutral-100 rounded-2xl"></div>
        ))}
      </div>
      <div className="h-24 bg-neutral-200 rounded-2xl"></div>
    </div>
  );
}

function PlanoCarreiraPage() {
  const { user } = useAuth();
  const tipoPerfil = (user?.role || 'corretor') as 'corretor' | 'imobiliaria' | 'proprietario';
  const textos = textosPorPerfil[tipoPerfil] || textosPorPerfil.corretor;
  
  const [carregando, setCarregando] = useState(true);
  const [contratosAtivos, setContratosAtivos] = useState(0);
  
  useEffect(() => {
    let cancelado = false;
    
    async function carregar() {
      if (!user) {
        setCarregando(false);
        return;
      }

      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (!authUser) {
          setCarregando(false);
          return;
        }

        const campoVinculo = {
          corretor: 'corretor_profile_id',
          imobiliaria: 'imobiliaria_profile_id',
          proprietario: 'proprietario_profile_id',
        }[tipoPerfil];
        
        const { count, error } = await supabase
          .from('apolices')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'ativa')
          .eq(campoVinculo as any, authUser.id);
        
        if (cancelado) return;
        
        if (error) {
          console.warn('[INFO] Erro ao buscar contratos:', error.message);
          setContratosAtivos(0);
        } else {
          setContratosAtivos(count || 0);
        }
      } catch (err: any) {
        console.error('[ERRO]', err);
      } finally {
        if (!cancelado) {
          setCarregando(false);
        }
      }
    }
    
    carregar();
    const intervalo = window.setInterval(carregar, 15000);

    return () => {
      cancelado = true;
      window.clearInterval(intervalo);
    };
  }, [user, tipoPerfil]);
  
  if (carregando) {
    return (
      <DashboardLayout>
        <PlanoCarreiraSkeleton />
      </DashboardLayout>
    );
  }
  
  const niveis = NIVEIS_FALLBACK[tipoPerfil] || NIVEIS_FALLBACK.corretor;
  const nivelAtual = niveis.find(n => 
    contratosAtivos >= n.min && (n.max === null || contratosAtivos <= n.max)
  ) || niveis[0];
  
  const proximoNivel = niveis.find(n => n.min > contratosAtivos);
  const faltam = proximoNivel ? proximoNivel.min - contratosAtivos : 0;
  
  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-8 py-2 animate-fade-in">
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-neutral-900 tracking-tight">{textos.titulo}</h1>
            <p className="text-neutral-500 mt-2 font-medium">
              {textos.subtitulo}
            </p>
          </div>
          <BadgeNivelAtual nivel={nivelAtual.nome} contratos={contratosAtivos} />
        </header>
        
        <CardProgresso 
          nivelAtual={nivelAtual}
          proximoNivel={proximoNivel}
          contratosAtivos={contratosAtivos}
          faltam={faltam}
          tipoPerfil={tipoPerfil}
        />
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {niveis.map(nivel => (
            <CardNivel
              key={nivel.nome}
              nivel={nivel}
              atual={nivel.nome === nivelAtual.nome}
              tipoPerfil={tipoPerfil}
            />
          ))}
        </div>
        
        <BannerComoSubir tipoPerfil={tipoPerfil} />
      </div>
    </DashboardLayout>
  );
}
