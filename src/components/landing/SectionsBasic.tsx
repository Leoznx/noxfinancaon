import { Link } from '@tanstack/react-router';
import { Check } from 'lucide-react';

import noxAboutHome from '@/assets/nox-about-home.png';
import { AboutNoxSection } from './AboutNoxSection';
import { Button } from '@/components/ui/button';

export const InstitutionalHero = () => (
  <section className="relative w-full overflow-hidden bg-white pt-28 sm:pt-32 lg:pt-[126px]">
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="absolute -left-24 top-40 h-72 w-72 rounded-full bg-[#FEF9C3]/45 blur-3xl" />
      <div className="absolute bottom-10 left-[6%] h-36 w-36 rounded-full bg-[#FDE68A]/20 blur-3xl" />
      <div className="absolute bottom-12 left-[8%] h-px w-[30%] bg-gradient-to-r from-transparent via-[#FACC15]/35 to-transparent" />
    </div>
    <div className="relative z-10 mx-auto grid w-full max-w-none items-center gap-12 px-5 pb-10 sm:px-8 sm:pb-14 lg:min-h-[700px] lg:grid-cols-[minmax(0,0.45fr)_minmax(0,0.55fr)] lg:gap-6 lg:pb-16 lg:pl-16 lg:pr-0 xl:grid-cols-[minmax(0,0.44fr)_minmax(0,0.56fr)] xl:gap-8 xl:pl-24 2xl:pl-28">
      <div className="max-w-[600px] lg:py-10 xl:max-w-[620px]">
        <span className="mb-6 inline-block rounded-full bg-white px-3 py-1 text-sm font-bold tracking-wider text-neutral-700 shadow-[0_8px_24px_rgba(17,17,17,0.06)] ring-1 ring-black/[0.04]">
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
        <div className="mb-8 mt-2 flex flex-col gap-3 sm:flex-row sm:gap-4">
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

      <div className="flex w-full items-center justify-center lg:h-full lg:justify-end">
        <div className="flex aspect-[3/2] w-full shrink-0 items-center justify-center lg:max-w-[1040px] lg:justify-end">
          <img
            src={noxAboutHome}
            alt="Casa moderna da NOX Fiança com aprovação em 1 minuto, imóveis protegidos e avaliação máxima"
            width={1536}
            height={1024}
            loading="eager"
            decoding="async"
            fetchPriority="high"
            className="h-full w-full object-cover object-center lg:rounded-l-[32px] lg:object-right"
          />
        </div>
      </div>
    </div>
  </section>
);

export const SolutionPresentation = AboutNoxSection;
