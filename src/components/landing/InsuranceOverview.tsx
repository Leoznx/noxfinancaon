import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  Check,
  ClipboardCheck,
  FileSignature,
  Home,
  KeyRound,
  SearchCheck,
  ShieldCheck,
  UserRound,
} from 'lucide-react';

import { Button } from '@/components/ui/button';

const journey = [
  {
    icon: ClipboardCheck,
    step: '01',
    title: 'Envie a solicitação',
    text: 'Informe os dados da locação e do inquilino em uma jornada simples e digital.',
  },
  {
    icon: SearchCheck,
    step: '02',
    title: 'Receba a análise',
    text: 'A tecnologia da NOX cruza as informações e pode retornar a avaliação em até 1 minuto.',
  },
  {
    icon: FileSignature,
    step: '03',
    title: 'Escolha e assine',
    text: 'Com a aprovação, o plano adequado é selecionado e a contratação segue de forma eletrônica.',
  },
  {
    icon: KeyRound,
    step: '04',
    title: 'Alugue com segurança',
    text: 'O contrato fica protegido conforme as coberturas escolhidas, sem fiador e sem caução.',
  },
] as const;

const audiences = [
  {
    icon: UserRound,
    title: 'Para o inquilino',
    text: 'Mais liberdade para alugar sem buscar fiador e sem imobilizar dinheiro em caução.',
  },
  {
    icon: Home,
    title: 'Para o proprietário',
    text: 'Mais previsibilidade para o recebimento do aluguel e apoio durante a vigência do contrato.',
  },
  {
    icon: Building2,
    title: 'Para a imobiliária',
    text: 'Uma operação mais ágil, organizada e digital para analisar, contratar e acompanhar locações.',
  },
  {
    icon: BriefcaseBusiness,
    title: 'Para o corretor',
    text: 'Menos negócios parados pela garantia e mais velocidade para conduzir o cliente até as chaves.',
  },
] as const;

export function InsuranceHero() {
  return (
    <section className="relative overflow-hidden border-b border-neutral-100 bg-white">
      <div className="absolute inset-0 hidden lg:block">
        <img
          src="/assets/seguro-fianca-entrega-chaves.webp"
          alt="Inquilinos recebendo as chaves de um novo imóvel"
          className="h-full w-full object-cover object-center"
          fetchPriority="high"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,#fff_0%,#fff_37%,rgba(255,255,255,.96)_47%,rgba(255,255,255,.45)_61%,rgba(255,255,255,0)_73%)]" />
      </div>

      <div className="relative mx-auto grid min-h-[640px] max-w-7xl items-center px-5 pb-14 pt-14 sm:px-8 lg:px-6">
        <div className="max-w-[600px]">
          <span className="mb-6 inline-flex rounded-full bg-neutral-100 px-3 py-1 text-xs font-bold tracking-[0.16em] text-neutral-700">
            SEGURO FIANÇA LOCATÍCIA
          </span>
          <h1 className="max-w-[590px] text-4xl font-bold leading-[1.06] tracking-tight text-neutral-950 sm:text-5xl lg:text-6xl">
            Alugue com menos burocracia e mais segurança.
          </h1>
          <p className="mt-6 max-w-[540px] text-base font-medium leading-relaxed text-neutral-600 sm:text-lg">
            A NOX substitui fiador e caução por uma garantia digital. A análise é rápida, a contratação acontece online e cada pessoa da locação ganha uma jornada mais simples.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/simular" className="w-full sm:w-auto">
              <Button className="h-12 w-full rounded-lg bg-neutral-950 px-7 font-bold text-white hover:bg-neutral-800 sm:w-auto">
                Solicitar análise
              </Button>
            </Link>
            <Link to="/planos" className="w-full sm:w-auto">
              <Button variant="outline" className="h-12 w-full rounded-lg border-neutral-300 px-7 font-bold text-neutral-900 hover:bg-neutral-50 sm:w-auto">
                Conhecer os planos
              </Button>
            </Link>
          </div>

          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3">
            {['Sem fiador', 'Sem caução', 'Contratação digital'].map((item) => (
              <span key={item} className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-600">
                <Check className="h-4 w-4 text-[#eabf00]" strokeWidth={3} />
                {item}
              </span>
            ))}
          </div>

          <div className="mt-10 overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-100 lg:hidden">
            <img
              src="/assets/seguro-fianca-entrega-chaves.webp"
              alt="Inquilinos recebendo as chaves de um novo imóvel"
              className="aspect-[4/3] w-full object-cover object-right"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

export function InsuranceJourney() {
  return (
    <section className="bg-white px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-7xl">
        <div className="mx-auto mb-12 max-w-3xl text-center sm:mb-16">
          <span className="mb-5 inline-flex rounded-full bg-neutral-100 px-3 py-1 text-xs font-bold tracking-[0.16em] text-neutral-700">
            COMO FUNCIONA
          </span>
          <h2 className="text-3xl font-bold tracking-tight text-neutral-950 sm:text-4xl lg:text-5xl">
            Da análise às chaves, em quatro passos claros.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-neutral-600 sm:text-lg">
            A NOX conecta tecnologia e atendimento para reduzir o tempo entre a escolha do imóvel e a assinatura do contrato.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {journey.map(({ icon: Icon, step, title, text }) => (
            <article key={step} className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
              <div className="mb-7 flex items-center justify-between">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#FFD60A] text-neutral-950">
                  <Icon className="h-5 w-5" strokeWidth={2.2} />
                </span>
                <span className="text-sm font-black tabular-nums text-neutral-300">{step}</span>
              </div>
              <h3 className="text-lg font-bold text-neutral-950">{title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-neutral-600">{text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function InsuranceForEveryone() {
  return (
    <section className="border-y border-neutral-100 bg-neutral-50 px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1.02fr_.98fr] lg:gap-16">
        <div>
          <span className="mb-5 inline-flex rounded-full bg-white px-3 py-1 text-xs font-bold tracking-[0.16em] text-neutral-700 shadow-sm">
            UMA JORNADA PARA TODOS
          </span>
          <h2 className="max-w-2xl text-3xl font-bold leading-tight tracking-tight text-neutral-950 sm:text-4xl lg:text-5xl">
            Proteção que simplifica cada lado da locação.
          </h2>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-neutral-600 sm:text-lg">
            O seguro fiança organiza a garantia do contrato sem transferir a burocracia para quem quer alugar, administrar ou receber.
          </p>

          <div className="mt-9 grid gap-4 sm:grid-cols-2">
            {audiences.map(({ icon: Icon, title, text }) => (
              <article key={title} className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
                <Icon className="h-6 w-6 text-neutral-950" strokeWidth={2} />
                <h3 className="mt-4 font-bold text-neutral-950">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-neutral-600">{text}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-3xl border border-neutral-200 bg-white p-2 shadow-xl shadow-neutral-200/70">
          <img
            src="/assets/seguro-fianca-digital.webp"
            alt="Consultora explicando uma contratação digital de seguro fiança"
            loading="lazy"
            className="aspect-[4/3] w-full rounded-[1.2rem] object-cover"
          />
          <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-6">
            <div className="flex items-start gap-3 rounded-xl bg-neutral-950 p-4 text-white">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#FFD60A]" />
              <p className="text-sm font-semibold leading-relaxed">Coberturas definidas conforme o plano escolhido.</p>
            </div>
            <div className="flex items-start gap-3 rounded-xl bg-[#FFD60A] p-4 text-neutral-950">
              <FileSignature className="mt-0.5 h-5 w-5 shrink-0" />
              <p className="text-sm font-semibold leading-relaxed">Proposta, análise e assinatura em uma jornada digital.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function InsuranceFinalCta() {
  return (
    <section className="bg-neutral-950 px-4 py-16 text-white sm:px-6 sm:py-20">
      <div className="mx-auto flex max-w-5xl flex-col items-center text-center">
        <ShieldCheck className="h-10 w-10 text-[#FFD60A]" strokeWidth={1.8} />
        <h2 className="mt-6 text-3xl font-bold tracking-tight sm:text-4xl">Pronto para tirar o aluguel do papel?</h2>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-neutral-300 sm:text-lg">
          Faça sua solicitação ou compare os planos antes de decidir. A contratação começa online e a equipe NOX acompanha você quando precisar.
        </p>
        <div className="mt-8 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
          <Link to="/simular" className="w-full sm:w-auto">
            <Button className="h-12 w-full rounded-lg bg-[#FFD60A] px-7 font-bold text-neutral-950 hover:bg-yellow-300 sm:w-auto">
              Solicitar análise <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
          <Link to="/planos" className="w-full sm:w-auto">
            <Button variant="outline" className="h-12 w-full rounded-lg border-neutral-700 bg-transparent px-7 font-bold text-white hover:bg-neutral-900 hover:text-white sm:w-auto">
              Ver planos
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
