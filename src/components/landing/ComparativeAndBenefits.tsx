import React, { useState } from 'react';
import { Check, X } from 'lucide-react';

export const ComparativeSection = () => {
  const [activeTab, setActiveTab] = useState<'imobiliaria' | 'inquilino' | 'proprietario' | 'corretor'>('imobiliaria');
  
  const content = {
    imobiliaria: {
      sem: ['Papelada e processos manuais', 'Alto risco de inadimplÃªncia', 'Custos jurÃ­dicos elevados'],
      com: ['AnÃ¡lise em atÃ© 1 minuto', 'Aluguel garantido todo mÃªs', 'Suporte jurÃ­dico especializado']
    },
    inquilino: {
      sem: ['Necessidade de fiador ou cauÃ§Ã£o', 'AprovaÃ§Ã£o demorada e burocrÃ¡tica', 'Idas ao cartÃ³rio para assinaturas'],
      com: ['Zero fiador, zero cauÃ§Ã£o', 'AprovaÃ§Ã£o 100% digital', 'ContrataÃ§Ã£o via assinatura eletrÃ´nica']
    },
    proprietario: {
      sem: ['Risco direto de falta de pagamento', 'Processos de despejo complexos', 'Incerteza no fluxo de caixa'],
      com: ['Aluguel garantido mesmo em atraso', 'Assessoria completa em sinistros', 'AnÃ¡lise de crÃ©dito rigorosa']
    },
    corretor: {
      sem: ['NegÃ³cios travados em busca de fiador', 'ComissÃ£o atrasada quando inquilino some', 'Cliente perdido por anÃ¡lise demorada'],
      com: ['Mais contratos fechados, comissÃ£o garantida', 'AprovaÃ§Ã£o na hora, sem perder cliente quente', 'Material de venda e treinamento gratuitos']
    }
  };

  const tabLabels = {
    imobiliaria: 'ImobiliÃ¡ria',
    inquilino: 'Inquilino',
    proprietario: 'ProprietÃ¡rio',
    corretor: 'Corretor',
  } as const;

  return (
    <section id="comparativo" className="py-16 sm:py-24 px-4 sm:px-6 bg-neutral-50 border-y border-neutral-100">
      <div className="container mx-auto max-w-7xl text-center">
        <span className="inline-block px-3 py-1 bg-neutral-100 text-neutral-700 text-xs font-bold tracking-widest rounded-full mb-6">
          COMPARATIVO
        </span>
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-neutral-900 mb-10 sm:mb-12 tracking-tight">
          A diferenÃ§a entre operar com e sem a NOX FIANÃ‡A.
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
              Sem NOX FIANÃ‡A
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
              Com NOX FIANÃ‡A
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
    { imageIcon: "/assets/nox-icon-garantia-inadimplencia.webp", title: "Garantia contra inadimplÃªncia", desc: "Cobertura de atÃ© 40 vezes o valor do aluguel, com as melhores taxas do mercado nacional." },
    { imageIcon: "/assets/nox-icon-aprovacao-1-minuto.webp", title: "AprovaÃ§Ã£o em atÃ© 1 minuto", desc: "AnÃ¡lise de crÃ©dito automatizada com inteligÃªncia artificial e cruzamento de bases." },
    { imageIcon: "/assets/nox-icon-suporte-juridico.webp", title: "Suporte jurÃ­dico especializado", desc: "Parceria com escritÃ³rios de advocacia homologados para gestÃ£o completa de despejos." },
    { imageIcon: "/assets/nox-icon-plataforma-digital.webp", title: "Plataforma 100% digital", desc: "Assinatura eletrÃ´nica com validade jurÃ­dica e gestÃ£o automatizada de contratos." },
    { imageIcon: "/assets/nox-icon-atendimento-dedicado.webp", title: "Atendimento dedicado", desc: "Equipe especializada de suporte a imobiliÃ¡rias durante toda a jornada do contrato." },
    { imageIcon: "/assets/nox-icon-pagamento-flexivel.webp", title: "Pagamento flexÃ­vel", desc: "Inquilino paga via PIX, boleto ou cartÃ£o em atÃ© 12 vezes, combinando opÃ§Ãµes." }
  ];

  return (
    <section className="py-16 sm:py-24 px-4 sm:px-6 bg-white">
      <div className="container mx-auto max-w-7xl text-center">
        <span className="inline-block px-3 py-1 bg-neutral-100 text-neutral-700 text-xs font-bold tracking-widest rounded-full mb-6">
          BENEFÃCIOS
        </span>
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-neutral-900 mb-12 sm:mb-16 tracking-tight">
          Tudo o que sua operaÃ§Ã£o precisa em um Ãºnico lugar.
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
