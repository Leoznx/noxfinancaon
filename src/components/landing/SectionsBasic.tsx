import { Link } from '@tanstack/react-router';
import { Check } from 'lucide-react';

import noxAboutHome from '@/assets/nox-about-home.png';
import noxHomeHeroBanner from '@/assets/nox-home-hero-banner.png';
import { Button } from '@/components/ui/button';

export const InstitutionalHero = () => (
  <section className="w-full overflow-hidden bg-white pt-28 sm:pt-32 lg:pt-[126px]">
    <div className="mx-auto grid w-full max-w-[1536px] items-center gap-12 px-5 pb-16 sm:px-8 sm:pb-20 lg:min-h-[600px] lg:grid-cols-[minmax(0,0.49fr)_minmax(0,0.51fr)] lg:gap-8 lg:px-12 lg:pb-16 xl:grid-cols-[minmax(0,0.46fr)_minmax(0,0.54fr)] xl:gap-12 xl:px-16 2xl:px-20">
      <div className="max-w-[600px] lg:py-10 xl:max-w-[620px]">
        <span className="mb-6 inline-block rounded-full bg-neutral-100 px-3 py-1 text-sm font-bold tracking-wider text-neutral-700">
          SEGURO FIANÇA LOCATÍCIA
        </span>
        <h1 className="mb-6 text-3xl font-bold leading-[1.08] tracking-tight text-neutral-900 sm:mb-7 sm:text-4xl md:text-[2.7rem] lg:text-[3.35rem] xl:text-[3.65rem]">
          Aluguel sem fiador, sem caução, com aprovação em até{' '}
          <span className="relative inline-block">
            <span className="text-[#FACC15]">1 minuto.</span>
            <svg
              className="pointer-events-none absolute -bottom-2 left-0 w-full sm:-bottom-2 lg:-bottom-3"
              style={{ transform: 'translateY(6px)' }}
              height="10"
              viewBox="0 0 100 10"
              preserveAspectRatio="none"
            >
              <path d="M0,6 Q50,1 100,6" stroke="#FACC15" strokeWidth="3" fill="none" />
            </svg>
          </span>
        </h1>
        <p className="mb-8 max-w-[520px] text-base leading-relaxed text-neutral-600 sm:mb-8 sm:text-lg md:text-xl">
          A NOX FIANÇA é a plataforma de seguro fiança 100% digital que elimina a burocracia do aluguel e oferece segurança total ao proprietário.
        </p>
        <div className="mb-10 flex flex-col gap-3 sm:mb-9 sm:flex-row sm:gap-4">
          <Link to="/consultas/nova" className="w-full sm:w-auto">
            <Button className="h-12 min-h-[44px] w-full rounded-lg bg-neutral-900 px-6 text-sm font-bold text-white shadow-xl shadow-neutral-100 transition-all hover:bg-neutral-800 active:scale-95 sm:w-auto sm:px-7 sm:text-base">
              Solicitar análise gratuita
            </Button>
          </Link>
          <Link to="/cadastro" className="w-full sm:w-auto">
            <Button variant="outline" className="h-12 min-h-[44px] w-full rounded-lg border-neutral-300 px-6 text-sm font-medium text-neutral-900 hover:bg-neutral-50 sm:w-auto sm:px-7 sm:text-base">
              Sou imobiliária ou corretor
            </Button>
          </Link>
        </div>
        <div className="flex flex-wrap gap-4 sm:gap-8">
          {['Sem fiador', 'Sem caução', 'Aprovação em 1 minuto', '100% digital'].map((item) => (
            <div key={item} className="flex items-center gap-2 text-sm font-medium text-neutral-500">
              <Check size={18} className="text-[#FACC15]" strokeWidth={2.5} />
              {item}
            </div>
          ))}
        </div>
      </div>

      <div className="hidden w-full items-center justify-center sm:flex lg:justify-start">
        <div className="flex aspect-[3/2] w-full shrink-0 items-center justify-end lg:w-[calc(100%_+_3rem)] xl:w-[calc(100%_+_4rem)] 2xl:w-[calc(100%_+_max(0px,50vw_-_768px)_+_5rem)]">
          <img
            src={noxHomeHeroBanner}
            alt="Casa moderna com aprovação digital em até 1 minuto, mais de 15 mil imóveis protegidos e avaliação cinco estrelas"
            width={1536}
            height={1024}
            loading="eager"
            decoding="async"
            fetchPriority="high"
            className="h-full w-full object-contain object-right"
          />
        </div>
      </div>
    </div>
  </section>
);

export const SolutionPresentation = () => (
  <section className="bg-white px-4 py-16 sm:px-6 sm:py-24">
    <div className="container mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className="aspect-[3/2] overflow-hidden rounded-2xl border border-neutral-100 shadow-sm lg:-translate-x-4">
        <img
          src={noxAboutHome}
          alt="Casa moderna com destaques sobre análise instantânea, processo digital, agilidade e segurança"
          loading="lazy"
          decoding="async"
          width={1536}
          height={1024}
          className="h-full w-full object-cover"
        />
      </div>
      <div>
        <span className="mb-6 inline-block rounded-full bg-neutral-100 px-3 py-1 text-xs font-bold tracking-widest text-neutral-700">
          SOBRE A NOX FIANÇA
        </span>
        <h2 className="mb-6 text-3xl font-bold leading-tight tracking-tight text-neutral-900 sm:mb-8 sm:text-4xl lg:text-5xl">
          Uma nova forma de garantir o aluguel.
        </h2>
        <div className="space-y-5 text-base leading-relaxed text-neutral-600 sm:space-y-6 sm:text-lg">
          <p>
            O seguro fiança da NOX foi desenvolvido para simplificar a jornada de locação, eliminando a necessidade de garantias tradicionais e burocráticas que travam o mercado imobiliário.
          </p>
          <p>
            Nossa plataforma utiliza tecnologia proprietária para realizar análises de crédito precisas e instantâneas, proporcionando agilidade para o inquilino e segurança para o proprietário do imóvel.
          </p>
        </div>
        <Link to="/seguro-fianca">
          <Button variant="outline" className="mt-8 h-12 min-h-[44px] rounded-lg border-neutral-300 px-6 font-medium text-neutral-900 hover:bg-neutral-50 sm:mt-10 sm:px-8">
            Conhecer o seguro fiança
          </Button>
        </Link>
      </div>
    </div>
  </section>
);
