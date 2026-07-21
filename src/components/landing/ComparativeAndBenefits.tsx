import React, { useState } from 'react';
import { Check, X } from 'lucide-react';

export const ComparativeSection = () => {
  const [activeTab, setActiveTab] = useState<'imobiliaria' | 'inquilino' | 'proprietario' | 'corretor'>('imobiliaria');
  
  const content = {
    imobiliaria: {
      sem: ['Papelada e processos manuais', 'Alto risco de inadimplência', 'Custos jurídicos elevados'],
      com: ['Análise em até 1 minuto', 'Aluguel garantido todo mês', 'Suporte jurídico especializado']
    },
    inquilino: {
      sem: ['Necessidade de fiador ou caução', 'Aprovação demorada e burocrática', 'Idas ao cartório para assinaturas'],
      com: ['Zero fiador, zero caução', 'Aprovação 100% digital', 'Contratação via assinatura eletrônica']
    },
    proprietario: {
      sem: ['Risco direto de falta de pagamento', 'Processos de despejo complexos', 'Incerteza no fluxo de caixa'],
      com: ['Aluguel garantido mesmo em atraso', 'Assessoria completa em sinistros', 'Análise de crédito rigorosa']
    },
    corretor: {
      sem: ['Negócios travados em busca de fiador', 'Comissão atrasada quando inquilino some', 'Cliente perdido por análise demorada'],
      com: ['Mais contratos fechados, comissão garantida', 'Aprovação na hora, sem perder cliente quente', 'Material de venda e treinamento gratuitos']
    }
  };

  const tabLabels = {
    imobiliaria: 'Imobiliária',
    inquilino: 'Inquilino',
    proprietario: 'Proprietário',
    corretor: 'Corretor',
  } as const;

  return (
    <section id="comparativo" className="py-16 sm:py-24 px-4 sm:px-6 bg-neutral-50 border-y border-neutral-100">
      <div className="container mx-auto max-w-7xl text-center">
        <span className="inline-block px-3 py-1 bg-neutral-100 text-neutral-700 text-xs font-bold tracking-widest rounded-full mb-6">
          COMPARATIVO
        </span>
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-neutral-900 mb-10 sm:mb-12 tracking-tight">
          A diferença entre operar com e sem a NOX FIANÇA.
        </h2>

        <div className="flex justify-center mb-12 sm:mb-16">
          <div className="bg-white p-1 rounded-lg grid grid-cols-2 gap-2 md:gap-1 border border-neutral-200 shadow-sm w-full max-w-md md:max-w-none md:w-auto md:flex">
            {(['imobiliaria', 'inquilino', 'proprietario', 'corretor'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`min-h-[48px] md:min-h-0 px-3 md:px-5 py-2.5 rounded-md text-sm font-semibold transition-all leading-tight whitespace-nowrap ${
                  activeTab === tab ? 'bg-neutral-900 text-white shadow-md' : 'bg-neutral-100 md:bg-transparent text-neutral-900 md:text-neutral-500 hover:text-neutral-900'
                }`}
              >
                {tabLabels[tab]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6 sm:gap-8 max-w-5xl mx-auto text-left">
          <div 
            key={`${activeTab}-sem`}
            className="p-6 sm:p-10 rounded-xl bg-white border border-neutral-200 shadow-sm"
          >
            <h3 className="text-lg sm:text-xl font-bold text-neutral-400 mb-6 sm:mb-8 flex items-center gap-3">
              <X size={24} strokeWidth={2} />
              Sem NOX FIANÇA
            </h3>
            <ul className="space-y-5 sm:space-y-6">
              {content[activeTab].sem.map((item, i) => (
                <li key={i} className="flex items-center gap-4 text-neutral-500">
                  <X size={20} className="text-neutral-300 shrink-0" strokeWidth={1.5} />
                  <span className="font-medium">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div 
            key={`${activeTab}-com`}
            className="p-6 sm:p-10 rounded-xl bg-white border border-neutral-900 shadow-lg relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 w-full h-1 bg-[#FACC15]"></div>
            <h3 className="text-lg sm:text-xl font-bold text-neutral-900 mb-6 sm:mb-8 flex items-center gap-3">
              <Check size={24} className="text-[#FACC15]" strokeWidth={2.5} />
              Com NOX FIANÇA
            </h3>
            <ul className="space-y-5 sm:space-y-6">
              {content[activeTab].com.map((item, i) => (
                <li key={i} className="flex items-center gap-4 text-neutral-900">
                  <Check size={20} className="text-[#FACC15] shrink-0" strokeWidth={2.5} />
                  <span className="font-semibold">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
};

export const BenefitsGrid = () => {
  const benefits = [
    { imageIcon: "/assets/nox-icon-garantia-inadimplencia.png", title: "Garantia contra inadimplência", desc: "Cobertura de até 40 vezes o valor do aluguel, com as melhores taxas do mercado nacional." },
    { imageIcon: "/assets/nox-icon-aprovacao-1-minuto.png", title: "Aprovação em até 1 minuto", desc: "Análise de crédito automatizada com inteligência artificial e cruzamento de bases." },
    { imageIcon: "/assets/nox-icon-suporte-juridico.png", title: "Suporte jurídico especializado", desc: "Parceria com escritórios de advocacia homologados para gestão completa de despejos." },
    { imageIcon: "/assets/nox-icon-plataforma-digital.png", title: "Plataforma 100% digital", desc: "Assinatura eletrônica com validade jurídica e gestão automatizada de contratos." },
    { imageIcon: "/assets/nox-icon-atendimento-dedicado.png", title: "Atendimento dedicado", desc: "Equipe especializada de suporte a imobiliárias durante toda a jornada do contrato." },
    { imageIcon: "/assets/nox-icon-pagamento-flexivel.png", title: "Pagamento flexível", desc: "Inquilino paga via PIX, boleto ou cartão em até 12 vezes, combinando opções." }
  ];

  return (
    <section className="py-16 sm:py-24 px-4 sm:px-6 bg-white">
      <div className="container mx-auto max-w-7xl text-center">
        <span className="inline-block px-3 py-1 bg-neutral-100 text-neutral-700 text-xs font-bold tracking-widest rounded-full mb-6">
          BENEFÍCIOS
        </span>
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-neutral-900 mb-12 sm:mb-16 tracking-tight">
          Tudo o que sua operação precisa em um único lugar.
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8 text-left">
          {benefits.map((benefit, i) => (
            <div
              key={i}
              className="p-6 sm:p-8 rounded-xl bg-white border border-neutral-200 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="mb-6 flex h-16 w-16 items-center justify-center">
                <img
                  src={benefit.imageIcon}
                  alt=""
                  loading="lazy"
                  className="h-16 w-16 object-contain drop-shadow-sm"
                />
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-neutral-900 mb-3 sm:mb-4">{benefit.title}</h3>
              <p className="text-neutral-500 leading-relaxed text-sm">{benefit.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
