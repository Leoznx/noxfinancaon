import React, { useEffect, useState } from 'react';
import { Check, Medal, Award, Trophy, Gem, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from '@tanstack/react-router';

const levelStyles: Record<string, { bg: string, text: string, iconBg: string, iconText: string, accent: string, badgeBg: string, badgeText: string, border: string, hoverBorder: string, chevron: string }> = {
  bronze: { bg: 'bg-gradient-to-br from-white to-[#fdf4ec]', text: 'text-neutral-900', iconBg: 'bg-gradient-to-br from-[#cd7f32] to-[#8c5a24]', iconText: 'text-white', accent: '#cd7f32', badgeBg: 'bg-[#cd7f32]', badgeText: 'text-white', border: 'border-[#e8d5bc]', hoverBorder: 'hover:border-[#cd7f32]', chevron: 'text-[#cd7f32]' },
  prata: { bg: 'bg-gradient-to-br from-white to-[#f4f5f7]', text: 'text-neutral-900', iconBg: 'bg-gradient-to-br from-[#d8d8d8] to-[#9ca3af]', iconText: 'text-neutral-900', accent: '#9ca3af', badgeBg: 'bg-[#9ca3af]', badgeText: 'text-white', border: 'border-[#dcdfe4]', hoverBorder: 'hover:border-[#6b7280]', chevron: 'text-[#6b7280]' },
  ouro: { bg: 'bg-gradient-to-br from-white to-[#fdf6dc]', text: 'text-neutral-900', iconBg: 'bg-gradient-to-br from-[#ffd700] to-[#c9a227]', iconText: 'text-neutral-900', accent: '#c9a227', badgeBg: 'bg-[#ffd700]', badgeText: 'text-neutral-900', border: 'border-[#f0e0a8]', hoverBorder: 'hover:border-[#c9a227]', chevron: 'text-[#c9a227]' },
  diamante: { bg: 'bg-gradient-to-br from-white via-[#eef7fb] to-[#dff1f8]', text: 'text-neutral-900', iconBg: 'bg-gradient-to-br from-[#b9f2ff] via-[#7dd3fc] to-[#0ea5e9]', iconText: 'text-neutral-900', accent: '#0ea5e9', badgeBg: 'bg-gradient-to-r from-[#7dd3fc] to-[#0ea5e9]', badgeText: 'text-white', border: 'border-[#0ea5e9]', hoverBorder: 'hover:border-[#0ea5e9]', chevron: 'text-[#0ea5e9]' },
};

export const CareerProgramSection = () => {
  const [niveis, setNiveis] = useState<any[]>([
    { id: 'bronze', nome_nivel: 'Bronze', min_contratos: 1, max_contratos: 9 },
    { id: 'prata', nome_nivel: 'Prata', min_contratos: 10, max_contratos: 19 },
    { id: 'ouro', nome_nivel: 'Ouro', min_contratos: 20, max_contratos: 39 },
    { id: 'diamante', nome_nivel: 'Diamante', min_contratos: 40, max_contratos: null },
  ]);

  useEffect(() => {
    const run = window.requestIdleCallback ?? ((cb: IdleRequestCallback) => window.setTimeout(cb, 800));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const idleId = run(() => {
    const fetchNiveis = async () => {
      const { supabase } = await import('@/integrations/supabase/client');
      const { data } = await supabase
        .from('niveis_perfil')
        .select('*')
        .eq('tipo_perfil', 'corretor')
        .order('ordem', { ascending: true });
      if (data) setNiveis(data);
    };
    fetchNiveis();
    });
    return () => cancel(idleId as any);
  }, []);

  return (
    <section className="py-16 sm:py-24 px-4 sm:px-6 bg-white overflow-hidden">
      <div className="container mx-auto max-w-7xl grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
        <div className="space-y-4 order-2 lg:order-1 lg:pr-8">
          {niveis.length > 0 ? niveis.map((nivel) => {
            const levelKey = (nivel.nome_nivel || '').toLowerCase();
            const iconByLevel: Record<string, any> = { bronze: Medal, prata: Award, ouro: Trophy, diamante: Gem };
            const imageByLevel: Record<string, string> = {
              bronze: '/assets/nox-icon-nivel-bronze.png',
              prata: '/assets/nox-icon-nivel-prata.png',
              ouro: '/assets/nox-icon-nivel-ouro.png',
              diamante: '/assets/nox-icon-nivel-diamante.png',
            };
            const Icon = iconByLevel[levelKey] || Medal;
            const imageIcon = imageByLevel[levelKey];
            const styles = levelStyles[levelKey] || levelStyles.bronze;
            const isDiamante = levelKey === 'diamante';
            
            return (
              <div
                key={nivel.id}
                className={`group relative flex items-center justify-between gap-4 sm:gap-6 p-5 sm:p-7 min-h-[100px] sm:min-h-[120px] rounded-2xl border transition-all duration-300 cursor-default ${styles.bg} ${
                  isDiamante ? `border-2 ${styles.border} shadow-md` : `${styles.border} ${styles.hoverBorder} hover:shadow-md`
                }`}
              >
                {isDiamante && (
                  <span className={`absolute -top-3 right-6 sm:right-8 px-3 py-1 ${styles.badgeBg} ${styles.badgeText} text-[10px] font-bold rounded-full uppercase tracking-[0.15em] shadow-sm`}>
                    TOPO
                  </span>
                )}

                <div className="flex items-center gap-4 sm:gap-6 flex-1 min-w-0">
                  <div className={`shrink-0 w-12 h-12 sm:w-16 sm:h-16 flex items-center justify-center transition-transform duration-300 group-hover:scale-105 ${imageIcon ? 'overflow-visible' : `rounded-xl ${styles.iconBg} ${styles.iconText} shadow-sm`}`}>
                    {imageIcon ? (
                      <img
                        src={imageIcon}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-contain drop-shadow-sm"
                      />
                    ) : (
                      <Icon className="w-6 h-6 sm:w-8 sm:h-8" strokeWidth={2} />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className={`text-lg sm:text-xl font-bold uppercase tracking-[0.05em] ${styles.text}`} style={{ color: styles.accent }}>
                      {nivel.nome_nivel}
                    </h3>
                    <p className="text-xs sm:text-sm text-neutral-600 font-medium mt-1">
                      {nivel.max_contratos
                        ? `${nivel.min_contratos} a ${nivel.max_contratos} contratos ativos`
                        : `Acima de ${nivel.min_contratos} contratos ativos`
                      }
                    </p>
                  </div>
                </div>

                <ChevronRight
                  size={20}
                  className={`shrink-0 transition-all duration-300 ${isDiamante ? `${styles.chevron} opacity-100` : `${styles.chevron} opacity-0 group-hover:opacity-100 group-hover:translate-x-1`}`}
                />
              </div>
            );
          }) : (
            <div className="animate-pulse space-y-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-24 bg-neutral-50 rounded-xl border border-neutral-100"></div>
              ))}
            </div>
          )}
        </div>

        <div className="order-1 lg:order-2">
          <span className="inline-block px-3 py-1 bg-neutral-100 text-neutral-700 text-xs font-bold tracking-widest rounded-full mb-6 uppercase">
            PARA CORRETORES
          </span>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-neutral-900 mb-6 sm:mb-8 leading-tight tracking-tight">
            Programa Carreira NOX: quanto mais você produz, mais você ganha.
          </h2>
          <p className="text-base sm:text-lg lg:text-xl text-neutral-600 mb-8 sm:mb-10 leading-relaxed">
            Corretores parceiros da NOX FIANÇA evoluem em uma trilha de carreira com comissões progressivas. A cada nova faixa de contratos ativos, sua remuneração sobe automaticamente. Sem metas trimestrais, sem letras miúdas, sem reset. Reconhecimento contínuo pela sua produção.
          </p>
          
          <div className="space-y-5 sm:space-y-6 mb-10 sm:mb-12">
            {[
              'Comissão recalculada automaticamente ao subir de nível',
              'Histórico de comissões preservado em cada faixa',
              'Acompanhamento em tempo real no painel do corretor'
            ].map(item => (
              <div key={item} className="flex items-start gap-4 text-neutral-800 font-medium text-sm sm:text-base">
                <div className="w-6 h-6 shrink-0 rounded-full bg-[#FFD60A] flex items-center justify-center mt-0.5">
                  <Check size={14} className="text-neutral-900" strokeWidth={3} />
                </div>
                {item}
              </div>
            ))}
          </div>

          <Link to="/corretor">
            <Button className="w-full sm:w-auto min-h-[44px] h-14 sm:h-16 px-8 sm:px-12 bg-neutral-900 text-white hover:bg-neutral-800 rounded-lg font-bold text-base sm:text-lg transition-all shadow-xl shadow-neutral-100">
              Quero ser corretor parceiro
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
};
