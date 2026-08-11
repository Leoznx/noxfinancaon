import { Link, createFileRoute } from '@tanstack/react-router';
import { ArrowRight, CircleDollarSign, Layers3, ShieldCheck } from 'lucide-react';

import { InstitutionalFooter } from '@/components/landing/FaqAndFooterInstitutional';
import { InstitutionalHeader } from '@/components/landing/InstitutionalHeader';
import { PlansSection } from '@/components/landing/PlansAndNumbers';
import { Button } from '@/components/ui/button';
import noxPlansHero from '@/assets/nox-plans-hero.png';

export const Route = createFileRoute('/planos')({
  head: () => ({
    meta: [
      { title: 'Planos e Coberturas | NOX Fiança' },
      {
        name: 'description',
        content: 'Compare os planos NOX Smart, NOX Smart+ e NOX Up e escolha a cobertura adequada para sua locação residencial ou comercial.',
      },
      { property: 'og:title', content: 'Planos e Coberturas | NOX Fiança' },
      { property: 'og:description', content: 'Conheça as opções de cobertura da NOX para sua locação.' },
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: 'https://www.noxfianca.com/planos' },
    ],
    links: [{ rel: 'canonical', href: 'https://www.noxfianca.com/planos' }],
  }),
  component: PlanosPage,
});

const planGuides = [
  {
    icon: CircleDollarSign,
    title: 'Cobertura proporcional',
    text: 'Cada opção amplia o limite principal de proteção, de 30 a 40 vezes o valor do aluguel.',
  },
  {
    icon: Layers3,
    title: 'Proteções adicionais',
    text: 'Taxas, condomínio e outros encargos entram conforme a composição do plano contratado.',
  },
  {
    icon: ShieldCheck,
    title: 'Suporte durante o contrato',
    text: 'A jornada inclui contratação digital e atendimento para acompanhar a locação e eventuais sinistros.',
  },
] as const;

function PlanosPage() {
  return (
    <div className="min-h-screen bg-white font-sans text-neutral-900 selection:bg-[#FACC15] selection:text-neutral-900">
      <InstitutionalHeader />
      <main className="pt-20">
        <section className="relative overflow-hidden border-b border-neutral-100 bg-white px-4 py-16 sm:px-6 sm:py-24">
          <div className="pointer-events-none absolute -right-24 -top-32 h-96 w-96 rounded-full bg-yellow-200/40 blur-3xl" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[1.08fr_.92fr] lg:gap-12">
            <div>
              <span className="mb-6 inline-flex rounded-full bg-neutral-100 px-3 py-1 text-xs font-bold tracking-[0.16em] text-neutral-700">
                PLANOS NOX FIANÇA
              </span>
              <h1 className="max-w-4xl text-4xl font-bold leading-[1.06] tracking-tight text-neutral-950 sm:text-5xl lg:text-6xl">
                Escolha a proteção que combina com a sua locação.
              </h1>
              <p className="mt-6 max-w-2xl text-base font-medium leading-relaxed text-neutral-600 sm:text-lg">
                Três opções objetivas para imóveis residenciais ou comerciais, com diferentes limites de cobertura e serviços de apoio.
              </p>
            </div>
            <div className="flex w-full items-center justify-center lg:justify-end">
              <div className="aspect-[3/2] w-full max-w-[620px]">
                <img
                  src={noxPlansHero}
                  alt="Comparativo visual dos planos NOX Smart, NOX Smart+ e NOX Up"
                  width={1536}
                  height={1024}
                  fetchPriority="high"
                  decoding="async"
                  className="h-full w-full object-contain object-center"
                />
              </div>
            </div>
          </div>
        </section>

        <PlansSection />

        <section className="bg-white px-4 py-16 sm:px-6 sm:py-24">
          <div className="mx-auto max-w-7xl">
            <div className="mx-auto max-w-3xl text-center">
              <span className="mb-5 inline-flex rounded-full bg-neutral-100 px-3 py-1 text-xs font-bold tracking-[0.16em] text-neutral-700">
                ESCOLHA COM CLAREZA
              </span>
              <h2 className="text-3xl font-bold tracking-tight text-neutral-950 sm:text-4xl lg:text-5xl">O que avaliar em cada plano.</h2>
              <p className="mt-5 text-base leading-relaxed text-neutral-600 sm:text-lg">
                A melhor opção depende do valor da locação, dos encargos que precisam ser protegidos e do nível de acompanhamento esperado.
              </p>
            </div>

            <div className="mt-12 grid gap-5 md:grid-cols-3">
              {planGuides.map(({ icon: Icon, title, text }) => (
                <article key={title} className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-7">
                  <span className="grid h-12 w-12 place-items-center rounded-xl bg-[#FFD60A] text-neutral-950">
                    <Icon className="h-6 w-6" strokeWidth={2} />
                  </span>
                  <h3 className="mt-6 text-xl font-bold text-neutral-950">{title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-neutral-600">{text}</p>
                </article>
              ))}
            </div>

            <div className="mt-12 flex flex-col items-center rounded-3xl bg-neutral-50 p-7 text-center sm:p-10">
              <h2 className="text-2xl font-bold text-neutral-950 sm:text-3xl">Ainda em dúvida sobre a cobertura?</h2>
              <p className="mt-3 max-w-2xl text-base leading-relaxed text-neutral-600">
                Comece pela análise da locação. A proposta apresenta a opção aplicável antes da contratação.
              </p>
              <div className="mt-7 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
                <Link to="/simular" className="w-full sm:w-auto">
                  <Button className="h-12 w-full rounded-lg bg-neutral-950 px-7 font-bold text-white hover:bg-neutral-800 sm:w-auto">
                    Solicitar análise <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
                <Link to="/seguro-fianca" className="w-full sm:w-auto">
                  <Button variant="outline" className="h-12 w-full rounded-lg border-neutral-300 px-7 font-bold text-neutral-950 hover:bg-white sm:w-auto">
                    Entender o seguro fiança
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <InstitutionalFooter hideCta />
    </div>
  );
}
