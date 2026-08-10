import { createFileRoute, Link } from '@tanstack/react-router';
import {
  BellRing,
  CheckCircle2,
  FileCheck2,
  LockKeyhole,
  ReceiptText,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Zap,
} from 'lucide-react';

import { InstitutionalFooter } from '@/components/landing/FaqAndFooterInstitutional';
import { InstitutionalHeader } from '@/components/landing/InstitutionalHeader';
import { Button } from '@/components/ui/button';

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

function StoreArtwork({ large = false }: { large?: boolean }) {
  return (
    <div
      className={large ? 'relative aspect-[1.487] w-full max-w-[360px] overflow-hidden' : 'relative h-[92px] w-[136px] overflow-hidden'}
      aria-label="Aplicativo para iPhone e Android"
    >
      <img
        src="/assets/app-store-google-play.png"
        alt="Baixe na App Store ou no Google Play"
        className={large ? 'absolute -left-[34%] -top-[20.7%] h-auto w-[168%] max-w-none' : 'absolute -left-[46px] -top-[19px] h-auto w-[228px] max-w-none'}
      />
    </div>
  );
}

function AplicativoPage() {
  return (
    <div className="min-h-screen bg-white">
      <InstitutionalHeader />

      <main className="pt-20">
        <section className="relative overflow-hidden bg-[#f8f7f2]">
          <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-yellow-300/30 blur-3xl" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.05fr_0.95fr] lg:py-28">
            <div className="min-w-0">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-yellow-300 bg-yellow-100/70 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-yellow-800">
                <Sparkles size={14} /> Aplicativo NOX Fiança
              </div>
              <h1 className="max-w-3xl text-4xl font-black leading-tight tracking-tight text-neutral-950 sm:text-5xl lg:text-6xl">
                Toda a sua operação <span className="text-yellow-500">no bolso.</span>
              </h1>
              <p className="mt-6 max-w-2xl text-base leading-7 text-neutral-600 sm:text-lg">
                Consulte crédito, acompanhe contratos, pagamentos, documentos e sinistros em uma experiência segura, simples e feita para cada perfil da locação.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link to="/login">
                  <Button size="lg" className="bg-neutral-950 font-bold text-white hover:bg-neutral-800">Entrar na minha conta</Button>
                </Link>
                <Link to="/cadastro">
                  <Button size="lg" variant="outline" className="border-neutral-300 bg-white font-bold text-neutral-950 hover:bg-neutral-100">Criar acesso</Button>
                </Link>
              </div>
            </div>

            <div className="mx-auto w-full max-w-md">
              <div className="rounded-[2.25rem] border border-neutral-800 bg-neutral-950 p-3 shadow-2xl shadow-neutral-300">
                <div className="overflow-hidden rounded-[1.7rem] bg-white">
                  <div className="flex items-center justify-between bg-yellow-400 px-6 py-5">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-neutral-700">NOX Fiança</p>
                      <p className="mt-1 text-xl font-black text-neutral-950">Seu painel</p>
                    </div>
                    <div className="grid h-11 w-11 place-items-center rounded-xl bg-neutral-950 text-yellow-400">
                      <Smartphone size={23} />
                    </div>
                  </div>
                  <div className="space-y-3 p-5">
                    {['Análises em andamento', 'Contratos ativos', 'Próximos pagamentos'].map((label, index) => (
                      <div key={label} className="flex items-center gap-3 rounded-2xl border border-neutral-200 p-4">
                        <div className="grid h-9 w-9 place-items-center rounded-xl bg-yellow-100 text-yellow-700">
                          <CheckCircle2 size={18} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-neutral-900">{label}</p>
                          <div className="mt-2 h-1.5 rounded-full bg-neutral-100">
                            <div className="h-full rounded-full bg-yellow-400" style={{ width: `${74 - index * 13}%` }} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

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

        <section className="overflow-hidden border-y border-neutral-200 bg-neutral-50">
          <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-20">
            <div className="min-w-0">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-yellow-400 text-neutral-950">
                <ShieldCheck size={25} />
              </div>
              <h2 className="mt-5 text-3xl font-black tracking-tight text-neutral-950">Segurança para acessar de onde estiver</h2>
              <p className="mt-4 max-w-xl leading-7 text-neutral-600">
                Cada usuário visualiza apenas as informações do seu perfil. A autenticação e os dados são protegidos pela mesma infraestrutura usada no portal NOX.
              </p>
              <div className="mt-6 flex items-center gap-3 text-sm font-bold text-neutral-800">
                <LockKeyhole size={18} className="text-yellow-600" /> Acesso individual e dados protegidos
              </div>
            </div>
            <div className="min-w-0 flex flex-col items-center rounded-3xl border border-neutral-200 bg-white p-6 sm:p-8">
              <p className="text-center text-xs font-bold uppercase tracking-[0.16em] text-neutral-500">Para iPhone e Android</p>
              <StoreArtwork large />
            </div>
          </div>
        </section>
      </main>

      <InstitutionalFooter hideCta />
    </div>
  );
}
