import { createFileRoute } from '@tanstack/react-router';

import { BenefitsGrid } from '@/components/landing/ComparativeAndBenefits';
import { InstitutionalFooter } from '@/components/landing/FaqAndFooterInstitutional';
import { InstitutionalHeader } from '@/components/landing/InstitutionalHeader';
import {
  InsuranceFinalCta,
  InsuranceForEveryone,
  InsuranceHero,
  InsuranceJourney,
} from '@/components/landing/InsuranceOverview';

export const Route = createFileRoute('/seguro-fianca')({
  head: () => ({
    meta: [
      { title: 'Seguro Fiança | NOX Fiança' },
      {
        name: 'description',
        content: 'Entenda como funciona o seguro fiança da NOX, compare a locação com e sem a garantia e conheça os benefícios para inquilinos, proprietários, corretores e imobiliárias.',
      },
      { property: 'og:title', content: 'Seguro Fiança Digital | NOX Fiança' },
      { property: 'og:description', content: 'Alugue sem fiador e sem caução, com análise rápida e contratação digital.' },
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: 'https://www.noxfianca.com/seguro-fianca' },
    ],
    links: [{ rel: 'canonical', href: 'https://www.noxfianca.com/seguro-fianca' }],
  }),
  component: SeguroFiancaPage,
});

function SeguroFiancaPage() {
  return (
    <div className="min-h-screen bg-white font-sans text-neutral-900 selection:bg-[#FACC15] selection:text-neutral-900">
      <InstitutionalHeader />
      <main className="pt-20">
        <InsuranceHero />
        <InsuranceJourney />
        <InsuranceForEveryone />
        <BenefitsGrid />
        <InsuranceFinalCta />
      </main>
      <InstitutionalFooter hideCta />
    </div>
  );
}
