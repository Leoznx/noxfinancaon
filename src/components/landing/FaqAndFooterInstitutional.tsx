import React, { useState } from 'react';
import {
  Clock3,
  Facebook,
  Globe2,
  Instagram,
  Mail,
  Minus,
  Plus,
  Youtube,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LogoNox } from '../LogoNox';
import { Link } from '@tanstack/react-router';

const FaqItem = ({ question, answer }: { question: string, answer: string }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="border-b border-neutral-200">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full py-5 sm:py-7 flex items-center justify-between text-left gap-4 group min-h-[44px]"
      >
        <span className="text-base sm:text-lg font-semibold text-neutral-900 group-hover:text-neutral-700 transition-colors">{question}</span>
        {isOpen ? <Minus size={20} className="text-[#FACC15] shrink-0" /> : <Plus size={20} className="text-neutral-400 group-hover:text-neutral-600 shrink-0" />}
      </button>
      {isOpen && (
          <div className="overflow-hidden">
            <p className="pb-5 sm:pb-7 text-neutral-500 leading-relaxed text-sm sm:text-base">
              {answer}
            </p>
          </div>
        )}
    </div>
  );
};

export const InstitutionalFaq = () => {
  const faqs = [
    { q: "Como funciona a análise de crédito da NOX FIANÇA?", a: "Nossa tecnologia analisa centenas de fontes de dados em tempo real para fornecer um retorno em até 1 minuto. O processo é 100% automatizado, eliminando falhas humanas e agilizando a aprovação." },
    { q: "Qual a diferença entre seguro fiança e fiança locatícia?", a: "Embora os termos sejam usados como sinônimos, o seguro fiança é uma apólice emitida por uma fiança digital, garantindo ao proprietário o recebimento dos aluguéis e encargos em caso de inadimplência do inquilino." },
    { q: "Quanto custa o seguro fiança para o inquilino?", a: "O valor é calculado com base no perfil de crédito do inquilino e no valor do aluguel. Oferecemos taxas competitivas e parcelamento em até 12x no cartão de crédito." },
    { q: "O seguro substitui completamente o fiador?", a: "Sim. A NOX FIANÇA elimina a necessidade de fiador ou de desembolsar grandes quantias para o depósito caução, facilitando o acesso ao imóvel para o inquilino." },
    { q: "Quais coberturas estão inclusas?", a: "Nossos planos cobrem aluguel, condomínio, IPTU, água, luz e danos ao imóvel, dependendo da cobertura selecionada. A indenização pode chegar a 40x o valor do aluguel." },
    { q: "Quem é responsável pelo pagamento do seguro?", a: "Geralmente, o custo do seguro fiança é de responsabilidade do inquilino, assim como ocorre com o IPTU ou o condomínio, integrando os custos da locação." },
    { q: "O seguro fiança altera o valor do aluguel?", a: "Não. O valor do aluguel é definido pelo proprietário ou imobiliária. O seguro é um serviço de garantia adicional contratado para viabilizar a locação." },
    { q: "Como funciona em caso de inadimplência?", a: "Assim que o atraso é comunicado pela imobiliária, a NOX inicia o processo de indenização, garantindo que o proprietário receba os valores sem interrupções no fluxo de caixa." },
    { q: "O contrato pode ser renovado anualmente?", a: "Sim, a renovação é anual e simplificada. Nossa equipe entra em contato com antecedência para garantir a continuidade da proteção sem burocracia." },
    { q: "A contratação é 100% digital?", a: "Sim. Desde a análise de crédito até a assinatura da apólice, todo o processo ocorre dentro da nossa plataforma, com validade jurídica garantida por certificação digital." }
  ];

  return (
    <section className="py-16 sm:py-24 px-4 sm:px-6 bg-white">
      <div className="container mx-auto max-w-4xl">
        <div className="text-center mb-12 sm:mb-16">
          <span className="inline-block px-3 py-1 bg-neutral-100 text-neutral-700 text-xs font-bold tracking-widest rounded-full mb-6">
            PERGUNTAS FREQUENTES
          </span>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-neutral-900 tracking-tight">Tudo o que você precisa saber sobre seguro fiança.</h2>
        </div>
        <div className="border-t border-neutral-200">
          {faqs.map((faq, i) => <FaqItem key={i} question={faq.q} answer={faq.a} />)}
        </div>
      </div>
    </section>
  );
};

export const InstitutionalFooter = ({ hideCta = false }: { hideCta?: boolean } = {}) => {
  return (
    <>
      {!hideCta && (
        <section className="py-20 sm:py-32 px-4 sm:px-6 bg-white text-center border-t border-neutral-100">
          <div className="container mx-auto max-w-3xl">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-neutral-900 mb-6 sm:mb-8 tracking-tight leading-tight">
              Pronto para modernizar sua operação de locação?
            </h2>
            <p className="text-base sm:text-lg lg:text-xl text-neutral-500 mb-8 sm:mb-10 leading-relaxed">
              Fale com um especialista da NOX FIANÇA e descubra como aumentar sua conversão e segurança.
            </p>
            <Link to="/contato">
              <Button
                className="w-full sm:w-auto min-h-[44px] h-14 sm:h-16 px-8 sm:px-12 bg-neutral-900 text-white hover:bg-neutral-800 rounded-lg font-bold text-base sm:text-lg transition-all shadow-xl shadow-neutral-200"
              >
                Solicitar contato
              </Button>
            </Link>
            <p className="text-sm text-neutral-400 mt-6 font-medium">Resposta em até 24 horas úteis.</p>
          </div>
        </section>
      )}

    <footer className="border-t border-yellow-400/70 bg-[#0b0b0b] px-4 pb-7 pt-12 text-white sm:px-6 sm:pb-8 sm:pt-14">
      <div className="container mx-auto max-w-7xl">
        <div className="grid grid-cols-1 gap-10 pb-10 sm:grid-cols-2 sm:gap-x-12 sm:gap-y-12 lg:grid-cols-[1.35fr_0.85fr_0.95fr_1.2fr_0.8fr] lg:gap-10">
          <div className="space-y-5">
            <LogoNox variant="escuro" size="md" />
            <p className="max-w-xs text-sm leading-6 text-neutral-400">
              A NOX Fiança simplifica a garantia locatícia com tecnologia, segurança e atendimento para inquilinos, proprietários, corretores e imobiliárias.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {[
                { label: 'Instagram da NOX Fiança', href: 'https://www.instagram.com/noxfianca/', icon: Instagram },
                { label: 'Facebook da NOX Fiança', href: 'https://www.facebook.com/noxfianca/', icon: Facebook },
                { label: 'YouTube da NOX Fiança', href: 'https://www.youtube.com/@noxfianca', icon: Youtube },
              ].map(({ label, href, icon: Icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={label}
                  className="grid h-10 w-10 place-items-center rounded-lg border border-neutral-800 text-neutral-400 transition-colors hover:border-yellow-400 hover:text-yellow-400"
                >
                  <Icon size={17} strokeWidth={1.8} />
                </a>
              ))}
              <span className="mx-1 h-6 w-px bg-neutral-800" aria-hidden="true" />
              <span
                className="grid h-10 min-w-14 place-items-center rounded-lg border border-neutral-800 px-3 text-xl"
                aria-label="Brasil"
                title="Brasil"
              >
                <svg viewBox="0 0 28 20" className="h-5 w-7 rounded-[2px]" role="img" aria-label="Bandeira do Brasil">
                  <rect width="28" height="20" fill="#009B3A" />
                  <path d="M14 2.8 25 10 14 17.2 3 10Z" fill="#FFDF00" />
                  <circle cx="14" cy="10" r="4.25" fill="#002776" />
                  <path d="M10.3 9.3c2.9-.8 5.4-.3 7.6 1.1" fill="none" stroke="#FFFFFF" strokeWidth=".65" />
                </svg>
              </span>
            </div>
          </div>

          <div>
            <h4 className="mb-5 text-sm font-bold uppercase tracking-[0.14em] text-yellow-400">Links rápidos</h4>
            <ul className="space-y-3.5 text-sm font-medium text-neutral-400">
              <li><Link to="/" className="transition-colors hover:text-white">Início</Link></li>
              <li><Link to="/sobre" className="transition-colors hover:text-white">Sobre a NOX</Link></li>
              <li><Link to="/trabalhe-conosco" className="transition-colors hover:text-white">Trabalhe conosco</Link></li>
              <li><Link to="/blog" className="transition-colors hover:text-white">Blog</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="mb-5 text-sm font-bold uppercase tracking-[0.14em] text-yellow-400">Serviços</h4>
            <ul className="space-y-3.5 text-sm font-medium text-neutral-400">
              <li><Link to="/seguro-fianca" className="transition-colors hover:text-white">Seguro Fiança</Link></li>
              <li><Link to="/planos" className="transition-colors hover:text-white">Planos e coberturas</Link></li>
              <li><Link to="/imobiliaria" className="transition-colors hover:text-white">Para imobiliárias</Link></li>
              <li><Link to="/corretor" className="transition-colors hover:text-white">Para corretores</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="mb-5 text-sm font-bold uppercase tracking-[0.14em] text-yellow-400">Contato</h4>
            <ul className="space-y-4 text-sm text-neutral-400">
              <li className="flex items-start gap-3">
                <Mail className="mt-0.5 shrink-0 text-yellow-400" size={17} strokeWidth={1.8} />
                <a href="mailto:contato@noxfianca.com.br" className="break-all transition-colors hover:text-white">contato@noxfianca.com.br</a>
              </li>
              <li className="flex items-start gap-3">
                <Clock3 className="mt-0.5 shrink-0 text-yellow-400" size={17} strokeWidth={1.8} />
                <span>Seg a sex, das 9h às 18h</span>
              </li>
              <li className="flex items-start gap-3">
                <Globe2 className="mt-0.5 shrink-0 text-yellow-400" size={17} strokeWidth={1.8} />
                <span>Atendimento em todo o Brasil</span>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-bold uppercase tracking-[0.14em] text-yellow-400">Nosso app</h4>
            <div className="relative h-[92px] w-[136px] overflow-hidden" aria-label="Disponível na App Store e no Google Play">
              <img
                src="/assets/app-store-google-play.png"
                alt="Baixe na App Store ou no Google Play"
                className="absolute -left-[46px] -top-[19px] h-auto w-[228px] max-w-none"
                loading="lazy"
              />
            </div>
            <Link
              to="/aplicativo"
              className="mt-3 inline-flex min-h-10 items-center justify-center rounded-lg border border-yellow-400/70 px-4 text-sm font-bold text-yellow-400 transition-colors hover:bg-yellow-400 hover:text-neutral-950"
            >
              Saiba mais
            </Link>
          </div>
        </div>

        <div className="border-t border-neutral-800 pt-6 text-center text-xs text-neutral-500">
          <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
            <span>© 2026 NOX Fiança. Todos os direitos reservados.</span>
            <span className="whitespace-nowrap"><span className="mr-2 text-neutral-700">|</span><strong className="text-yellow-400">GRUPO NOX</strong></span>
          </p>
        </div>
      </div>
    </footer>
  </>
  );
};
