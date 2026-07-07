import React from 'react';
import { Check, FileText, MapPin, Building2, Clock } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';

export const PlansSection = () => {
  const plans = [
    { name: "NOX Essencial", coverage: "25x", exit: "3x", benefits: ['Análise em 1 minuto', 'Contratação Digital', 'Suporte Jurídico', 'Assistência 24h ao imóvel'] },
    { name: "NOX Plus", coverage: "30x", exit: "3x", featured: true, benefits: ['Análise em 1 minuto', 'Contratação Digital', 'Suporte Jurídico', 'Assistência 24h ao imóvel'] },
    { name: "NOX Premium", coverage: "35x", exit: "5x", benefits: ['Análise em 1 minuto', 'Contratação Digital', 'Suporte Jurídico', 'Assistência 24h ao imóvel', 'Cobertura de IPTU e Condomínio'] },
    { name: "NOX Top", coverage: "40x", exit: "5x", benefits: ['Análise em 1 minuto', 'Contratação Digital', 'Suporte Jurídico', 'Assistência 24h ao imóvel', 'Cobertura de IPTU e Condomínio', 'Gerente de relacionamento dedicado'] },
  ];

  return (
    <section id="planos" className="py-16 sm:py-24 px-4 sm:px-6 bg-neutral-50 border-y border-neutral-100">
      <div className="container mx-auto max-w-7xl text-center">
        <span className="inline-block px-3 py-1 bg-neutral-100 text-neutral-700 text-xs font-bold tracking-widest rounded-full mb-6">
          PLANOS E COBERTURAS
        </span>
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-neutral-900 mb-4 sm:mb-6 tracking-tight">
          Planos NOX FIANÇA com as melhores taxas do mercado
        </h2>
        <p className="text-neutral-500 mb-12 sm:mb-16 font-medium max-w-2xl mx-auto text-sm sm:text-base">
          Planos transparentes que atendem locações residenciais e comerciais, para pessoas físicas e jurídicas.
        </p>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6 text-left max-w-7xl mx-auto">
          {plans.map((plan, i) => (
            <div
              key={i}
              className={`p-4 sm:p-6 lg:p-8 rounded-xl bg-white border ${plan.featured ? 'border-neutral-900 shadow-xl lg:scale-[1.02] lg:z-10' : 'border-neutral-200 shadow-sm'} flex flex-col relative`}
            >
              {plan.featured && <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-2 sm:px-3 py-1 bg-[#FFD60A] text-neutral-900 text-[9px] sm:text-[10px] font-bold rounded-full whitespace-nowrap">RECOMENDADO</span>}
              <div className="mb-4 sm:mb-6">
                <h3 className="text-base sm:text-xl font-bold text-neutral-900">{plan.name}</h3>
              </div>
              <div className="space-y-4 sm:space-y-6 flex-1 mb-4 sm:mb-8">
                <div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl sm:text-4xl font-bold text-neutral-900 tracking-tighter">{plan.coverage}</span>
                    <span className="text-neutral-500 font-medium text-xs sm:text-sm">aluguel</span>
                  </div>
                  <p className="text-[9px] sm:text-[10px] text-neutral-400 font-bold uppercase mt-1 sm:mt-2 tracking-widest">Cobertura Principal</p>
                </div>
                <div className="h-px bg-neutral-100"></div>
                <div>
                  <p className="text-sm sm:text-lg font-bold text-neutral-900">Custo de saída: {plan.exit}</p>
                </div>
                <div className="h-px bg-neutral-100"></div>
                <div className="space-y-2 sm:space-y-3">
                  {plan.benefits.map(item => (
                    <div key={item} className="flex items-start gap-2 sm:gap-3 text-xs sm:text-sm text-neutral-600 font-medium">
                      <Check size={14} className="text-[#FFD60A] shrink-0 mt-0.5 sm:w-4 sm:h-4" strokeWidth={2.5} />
                      <span className="leading-snug">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
              <Link to="/simular">
                <Button className={`w-full min-h-[44px] h-11 sm:h-12 rounded-lg font-bold text-xs sm:text-sm bg-neutral-900 text-white hover:bg-neutral-800 transition-all px-2`}>
                  <span className="sm:hidden">Contratar</span>
                  <span className="hidden sm:inline">Contratar este plano</span>
                </Button>
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const AnimatedNumber = ({ value }: { value: string }) => {
  return <span>{value}</span>;
};

const StatCard = ({ icon: Icon, value, label }: { icon: any, value: string, label: string }) => (
  <div className="h-full min-h-[200px] sm:min-h-[260px] bg-white border border-neutral-200 rounded-xl p-5 sm:p-8 shadow-sm hover:border-neutral-900 group transition-all duration-300 flex flex-col items-start text-left">
    <div className="inline-flex items-center justify-center p-2.5 rounded-lg bg-yellow-400 group-hover:bg-yellow-500 text-neutral-900 transition-colors mb-4 sm:mb-6">
      <Icon size={24} strokeWidth={2} />
    </div>
    <div className="text-3xl sm:text-4xl md:text-5xl font-bold text-neutral-900 tabular-nums mb-2 tracking-tight">
      <AnimatedNumber value={value} />
    </div>
    <p className="text-xs sm:text-sm text-neutral-600 font-medium leading-relaxed mt-auto">{label}</p>
  </div>
);

export const InstitutionalNumbers = () => (
  <section className="py-16 sm:py-24 px-4 sm:px-6 bg-neutral-50">
    <div className="container mx-auto max-w-7xl">
      <div className="text-center mb-12 sm:mb-16">
        <span className="inline-block px-3 py-1 bg-neutral-100 text-neutral-700 text-sm font-bold uppercase tracking-wider rounded-full mb-6">
          RESULTADOS
        </span>
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-neutral-900 tracking-tight mb-4">A NOX FIANÇA em números.</h2>
        <p className="text-neutral-600 font-medium text-sm sm:text-base">Resultados que comprovam a confiança do mercado.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 items-stretch">
        <Link to="/corretor" className="block h-full"><StatCard icon={FileText} value="20 mil+" label="contratos sob gestão no Brasil" /></Link>
        <Link to="/imobiliaria" className="block h-full"><StatCard icon={MapPin} value="500+" label="cidades atendidas em território nacional" /></Link>
        <Link to="/imobiliaria" className="block h-full"><StatCard icon={Building2} value="800+" label="imobiliárias parceiras" /></Link>
        <Link to="/corretor" className="block h-full"><StatCard icon={Clock} value="1 minuto" label="tempo médio de aprovação de crédito" /></Link>
      </div>
    </div>
  </section>
);
