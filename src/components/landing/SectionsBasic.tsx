import React from 'react';
import { Check } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';

export const InstitutionalHero = () => (
  <section className="relative w-full overflow-hidden bg-white lg:min-h-[620px] xl:min-h-[650px]">
    {/* Fundo: foto + degradês em camadas */}
    <div className="absolute inset-0">
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-amber-100/40 blur-3xl" />
      <img
        src="/assets/nox-hero-casa-chaves-banner.png"
        alt="Chaveiro NOX em frente a um imóvel moderno"
        loading="eager"
        decoding="async"
        fetchPriority="high"
        className="h-full w-full object-cover object-center lg:object-contain lg:object-right-bottom"
      />
      {/* Degradê branco -> transparente, da esquerda para a direita */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(to right, #ffffff 0%, #ffffff 30%, rgba(255,255,255,0.96) 42%, rgba(255,255,255,0.56) 55%, rgba(255,255,255,0.12) 66%, rgba(255,255,255,0) 74%)',
        }}
      />
      {/* Reforço de legibilidade só no mobile, onde não há coluna dedicada ao texto */}
      <div className="absolute inset-0 bg-white/80 sm:hidden" />
    </div>

    <div className="relative px-5 pb-16 pt-28 sm:px-10 sm:pb-24 sm:pt-40 lg:flex lg:min-h-[620px] lg:items-center lg:pb-14 lg:pl-[11vw] lg:pr-16 lg:pt-24 xl:min-h-[650px] xl:pl-[12vw] xl:pr-24 xl:pt-28 2xl:pl-[13vw] 2xl:pr-28">
      <div className="max-w-[590px] xl:max-w-[620px]">
        <span className="inline-block px-3 py-1 bg-neutral-100 text-neutral-700 text-sm font-bold tracking-wider rounded-full mb-6">
          SEGURO FIANÇA LOCATÍCIA
        </span>
        <h1 className="text-3xl sm:text-4xl md:text-[2.7rem] lg:text-[3.35rem] xl:text-[3.65rem] font-bold text-neutral-900 leading-[1.08] tracking-tight mb-6 sm:mb-7">
          Aluguel sem fiador, sem caução, com aprovação em até <span className="relative inline-block">
            <span className="text-[#FACC15]">1 minuto.</span>
            <svg className="absolute -bottom-2 sm:-bottom-2 lg:-bottom-3 left-0 w-full pointer-events-none" style={{ transform: 'translateY(6px)' }} height="10" viewBox="0 0 100 10" preserveAspectRatio="none">
              <path d="M0,6 Q50,1 100,6" stroke="#FACC15" strokeWidth="3" fill="none" />
            </svg>
          </span>
        </h1>
        <p className="text-base sm:text-lg md:text-xl text-neutral-600 mb-8 sm:mb-8 max-w-[520px] leading-relaxed">
          A NOX FIANÇA é a plataforma de seguro fiança 100% digital que elimina a burocracia do aluguel e oferece segurança total ao proprietário.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-10 sm:mb-9">
          <Link to="/simular" className="w-full sm:w-auto">
            <Button className="w-full sm:w-auto min-h-[44px] h-12 px-6 sm:px-7 bg-neutral-900 text-white hover:bg-neutral-800 text-sm sm:text-base font-bold rounded-lg shadow-xl shadow-neutral-100 transition-all active:scale-95">
              Solicitar análise gratuita
            </Button>
          </Link>
          <Link to="/cadastro" className="w-full sm:w-auto">
            <Button variant="outline" className="w-full sm:w-auto min-h-[44px] h-12 px-6 sm:px-7 border-neutral-300 text-neutral-900 hover:bg-neutral-50 text-sm sm:text-base font-medium rounded-lg">
              Sou imobiliária ou corretor
            </Button>
          </Link>
        </div>
        <div className="flex flex-wrap gap-4 sm:gap-8">
          {['Sem fiador', 'Sem caução', 'Aprovação em 1 minuto', '100% digital'].map(item => (
            <div key={item} className="flex items-center gap-2 text-sm text-neutral-500 font-medium">
              <Check size={18} className="text-[#FACC15]" strokeWidth={2.5} />
              {item}
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>
);

const PartnerLogo = ({ name, style, icon: Icon }: { name: string, style: string, icon?: any }) => {
  return (
    <div className="flex items-center gap-3 px-6 sm:px-8 group transition-all duration-300">
      {Icon && <Icon size={24} className="text-neutral-400 group-hover:text-neutral-900 transition-colors" strokeWidth={1.5} />}
      <span className={`text-lg sm:text-xl font-bold text-neutral-400 group-hover:text-neutral-900 transition-colors whitespace-nowrap ${style}`}>
        {name}
      </span>
    </div>
  );
};

export const SocialProofLogos = () => {
  const partners = [
    { name: "Cordeiro Imóveis", style: "font-sans font-bold", icon: () => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    )},
    { name: "Vértice Imobiliária", style: "font-serif font-semibold italic", icon: () => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m3 21 9-18 9 18H3z"/></svg>
    )},
    { name: "Castelo & Cia.", style: "font-serif tracking-tight", icon: () => (
      <span className="text-[10px] font-serif border border-neutral-300 px-1 rounded">1987</span>
    )},
    { name: "Atlas Real Estate", style: "font-sans uppercase tracking-widest", icon: () => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
    )},
    { name: "Boreal Imóveis", style: "font-sans lowercase font-light", icon: () => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>
    )},
    { name: "Premier Imobiliária", style: "font-serif italic", icon: () => (
      <span className="text-xl font-serif italic text-neutral-300">P</span>
    )},
    { name: "Prime House", style: "font-sans font-black uppercase", icon: () => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 21v-8a3 3 0 0 0-6 0v8"/><rect width="18" height="18" x="3" y="3" rx="2"/></svg>
    )},
    { name: "Norte Sul Imóveis", style: "font-sans font-medium tracking-tighter", icon: () => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>
    )},
    { name: "Conexão Imobiliária", style: "font-sans", icon: () => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
    )},
    { name: "Verde Imóveis", style: "font-serif font-medium", icon: () => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C10.9 14.4 12 13.8 14 11.3"/></svg>
    )},
    { name: "Lar & Estilo", style: "font-serif italic tracking-widest", icon: () => (
       <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z"/><path d="m3 9 2.45-4.9A2 2 0 0 1 7.24 3h9.52a2 2 0 0 1 1.8 1.1L21 9"/></svg>
    )},
    { name: "Reserva Imobiliária", style: "font-sans uppercase font-bold tracking-[0.2em]", icon: () => (
      <div className="w-6 h-6 border-2 border-neutral-300 rounded-full flex items-center justify-center text-[10px] font-bold">R</div>
    )},
  ];

  return (
    <section className="py-12 sm:py-16 bg-white border-y border-neutral-100 relative overflow-hidden group/section">
      <div className="absolute inset-y-0 left-0 w-16 sm:w-32 bg-gradient-to-r from-white to-transparent z-10 pointer-events-none" />
      <div className="absolute inset-y-0 right-0 w-16 sm:w-32 bg-gradient-to-l from-white to-transparent z-10 pointer-events-none" />
      
      <div className="container mx-auto px-4 sm:px-6 mb-10 sm:mb-12 text-center">
        <p className="text-neutral-400 font-bold uppercase tracking-[0.2em] text-[10px]">
          MAIS DE 500 IMOBILIÁRIAS CONFIAM NA NOX FIANÇA
        </p>
      </div>

      <div className="flex overflow-hidden">
        <div className="flex animate-marquee hover:[animation-play-state:paused] gap-10 sm:gap-16 items-center whitespace-nowrap">
          {partners.map((partner, index) => (
            <PartnerLogo 
              key={`${partner.name}-${index}`} 
              name={partner.name} 
              style={partner.style} 
              icon={partner.icon} 
            />
          ))}
          {partners.map((partner, index) => (
            <PartnerLogo 
              key={`${partner.name}-dup-${index}`} 
              name={partner.name} 
              style={partner.style} 
              icon={partner.icon} 
            />
          ))}
        </div>
      </div>
    </section>
  );
};

export const SolutionPresentation = () => (
  <section className="py-16 sm:py-24 px-4 sm:px-6 bg-white">
    <div className="container mx-auto max-w-7xl grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
      <div className="rounded-2xl overflow-hidden shadow-sm border border-neutral-100">
        <img 
          src="https://images.unsplash.com/photo-1556911220-e15b29be8c8f?ixlib=rb-4.0.3&auto=format&fit=crop&w=1000&q=80" 
          alt="Família feliz" 
          loading="lazy"
          decoding="async"
          width={1000}
          height={500}
          className="w-full h-64 sm:h-96 lg:h-[500px] object-cover"
        />
      </div>
      <div>
        <span className="inline-block px-3 py-1 bg-neutral-100 text-neutral-700 text-xs font-bold tracking-widest rounded-full mb-6">
          SOBRE A NOX FIANÇA
        </span>
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-neutral-900 mb-6 sm:mb-8 leading-tight tracking-tight">
          Uma nova forma de garantir o aluguel.
        </h2>
        <div className="space-y-5 sm:space-y-6 text-neutral-600 text-base sm:text-lg leading-relaxed">
          <p>
            O seguro fiança da NOX foi desenvolvido para simplificar a jornada de locação, eliminando a necessidade de garantias tradicionais e burocráticas que travam o mercado imobiliário.
          </p>
          <p>
            Nossa plataforma utiliza tecnologia proprietária para realizar análises de crédito precisas e instantâneas, proporcionando agilidade para o inquilino e segurança inabalável para o proprietário do imóvel.
          </p>
        </div>
        <Link to="/corretor">
          <Button variant="outline" className="mt-8 sm:mt-10 min-h-[44px] h-12 px-6 sm:px-8 border-neutral-300 text-neutral-900 hover:bg-neutral-50 rounded-lg font-medium">
            Conhecer a plataforma
          </Button>
        </Link>
      </div>
    </div>
  </section>
);
