import { createFileRoute } from '@tanstack/react-router';
import {
  BellRing,
  FileCheck2,
  LockKeyhole,
  ReceiptText,
  ShieldCheck,
  Zap,
} from 'lucide-react';

import { InstitutionalFooter } from '@/components/landing/FaqAndFooterInstitutional';
import { HomeSectionDivider } from '@/components/landing/HomeSectionDivider';
import { InstitutionalHeader } from '@/components/landing/InstitutionalHeader';
import { LogoNox } from '@/components/LogoNox';

export const Route = createFileRoute('/aplicativo')({
  head: () => ({
    meta: [
      { title: 'Aplicativo NOX Fiança — sua operação no bolso' },
      {
        name: 'description',
        content: 'Conheça o aplicativo da NOX Fiança para acompanhar análises, contratos, documentos, pagamentos e notificações em um só lugar.',
      },
      { property: 'og:title', content: 'Aplicativo NOX Fiança' },
      { property: 'og:description', content: 'Seguro fiança digital, simples e seguro, onde você estiver.' },
    ],
  }),
  component: AplicativoPage,
});

const features = [
  {
    icon: Zap,
    title: 'Análises e propostas',
    description: 'Inicie uma análise, acompanhe o retorno e avance pela contratação diretamente no celular.',
  },
  {
    icon: FileCheck2,
    title: 'Contratos e documentos',
    description: 'Consulte apólices, acompanhe assinaturas e acesse os documentos importantes de cada locação.',
  },
  {
    icon: ReceiptText,
    title: 'Pagamentos organizados',
    description: 'Visualize cobranças, faturas e comprovantes com informações claras e atualizadas.',
  },
  {
    icon: BellRing,
    title: 'Atualizações em tempo real',
    description: 'Receba avisos sobre cada etapa importante sem precisar acompanhar processos manualmente.',
  },
];

function AplicativoPage() {
  return (
    <div className="min-h-screen bg-white">
      <InstitutionalHeader />

      <main className="pt-20">
        <section className="bg-white px-4 pt-6 sm:px-6 sm:pt-8 lg:pt-10" aria-label="Nosso aplicativo">
          <img
            src="/assets/nox-aplicativo-banner.png"
            alt="Aplicativo NOX Finança para aluguel sem fiador, sem caução e com aprovação em até um minuto"
            width="1536"
            height="1024"
            className="mx-auto block h-auto max-h-[640px] w-auto max-w-full"
            fetchPriority="high"
          />
        </section>

        <HomeSectionDivider />

        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-yellow-600">Tudo em um só lugar</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-neutral-950 sm:text-4xl">Feito para simplificar a locação</h2>
            <p className="mt-4 leading-7 text-neutral-600">A mesma segurança da plataforma NOX, com uma navegação pensada para o celular.</p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map(({ icon: Icon, title, description }) => (
              <article key={title} className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-neutral-950 text-yellow-400">
                  <Icon size={21} />
                </div>
                <h3 className="mt-5 text-lg font-bold text-neutral-950">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-neutral-600">{description}</p>
              </article>
            ))}
          </div>
        </section>

        <HomeSectionDivider />

        <section className="overflow-hidden bg-neutral-50">
          <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-20">
            <div className="min-w-0">
              <div className="flex items-center gap-4 sm:gap-5" aria-label="Segurança NOX Fiança">
                <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-yellow-400 text-neutral-950 shadow-[0_8px_24px_rgba(250,204,21,0.20)]">
                  <ShieldCheck size={28} />
                </div>
                <span aria-hidden="true" className="text-2xl font-light text-neutral-400">×</span>
                <LogoNox variant="claro" size="md" />
              </div>
              <h2 className="mt-7 text-4xl font-black tracking-tight text-neutral-950 sm:text-5xl sm:leading-[1.08]">Segurança para acessar de onde estiver</h2>
              <p className="mt-5 max-w-xl text-lg leading-8 text-neutral-600">
                Cada usuário visualiza apenas as informações do seu perfil. A autenticação e os dados são protegidos pela mesma infraestrutura usada no portal NOX.
              </p>
              <div className="mt-7 flex items-center gap-3 text-base font-bold text-neutral-800">
                <LockKeyhole size={20} className="shrink-0 text-yellow-600" /> Acesso individual e dados protegidos
              </div>
            </div>
            <img
              src="/assets/nox-aplicativo-seguro-fianca.png"
              alt="Seguro fiança digital NOX, rápido, seguro e sem burocracia"
              width="1122"
              height="1402"
              className="mx-auto block h-auto w-full max-w-[360px] rounded-[2rem] shadow-[0_18px_50px_rgba(0,0,0,0.10)]"
              loading="lazy"
              decoding="async"
            />
          </div>
        </section>
      </main>

      <InstitutionalFooter hideCta />
    </div>
  );
}
