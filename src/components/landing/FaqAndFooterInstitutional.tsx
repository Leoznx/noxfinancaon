import React, { useState } from 'react';
import { Plus, Minus, Instagram, Linkedin, Youtube } from 'lucide-react';
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

    <footer className="bg-neutral-900 text-white pt-16 sm:pt-24 pb-10 sm:pb-12 px-4 sm:px-6">
      <div className="container mx-auto max-w-7xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-10 sm:gap-12 mb-16 sm:mb-20">
          <div className="space-y-6 sm:col-span-2 md:col-span-1">
            <LogoNox variant="escuro" size="md" />
            <p className="text-neutral-400 text-xs font-bold uppercase tracking-[0.2em]">"A proteção que nunca dorme."</p>
            <p className="text-neutral-400 text-sm leading-relaxed">
              A NOX é especialista em seguro fiança e soluções tecnológicas para o mercado imobiliário brasileiro, trazendo segurança e agilidade para inquilinos e proprietários.
            </p>
            <p className="text-neutral-500 text-xs font-medium">CNPJ: 00.000.000/0001-00</p>
          </div>
          
          <div>
            <h4 className="text-white font-bold text-sm mb-6 sm:mb-8 tracking-wider uppercase">Soluções</h4>
            <ul className="space-y-4 text-neutral-400 text-sm font-medium">
              <Link to="/corretor" className="hover:text-white transition-colors cursor-pointer block">Seguro Fiança Pessoa Física</Link>
              <Link to="/imobiliaria" className="hover:text-white transition-colors cursor-pointer block">Seguro Fiança Pessoa Jurídica</Link>
              <Link to="/imobiliaria" className="hover:text-white transition-colors cursor-pointer block">Para Imobiliárias</Link>
              <Link to="/corretor" className="hover:text-white transition-colors cursor-pointer block">Para Corretores</Link>
            </ul>
          </div>
          
          <div>
            <h4 className="text-white font-bold text-sm mb-6 sm:mb-8 tracking-wider uppercase">Empresa</h4>
            <ul className="space-y-4 text-neutral-400 text-sm font-medium">
              <li><Link to="/sobre" className="hover:text-white transition-colors cursor-pointer block">Sobre a NOX</Link></li>
              <li><Link to="/trabalhe-conosco" className="hover:text-white transition-colors cursor-pointer block">Trabalhe conosco</Link></li>
              <li><Link to="/blog" className="hover:text-white transition-colors cursor-pointer block">Blog</Link></li>
              <li><Link to="/seja-parceiro" className="hover:text-white transition-colors cursor-pointer block">Seja parceiro</Link></li>
            </ul>
          </div>

          <div className="space-y-8">
            <div>
              <h4 className="text-white font-bold text-sm mb-6 sm:mb-8 tracking-wider uppercase">Contato</h4>
              <ul className="space-y-4 text-neutral-400 text-sm font-medium">
                <li>0800 000 0000</li>
                <li className="break-all">contato@noxfianca.com.br</li>
                <li className="pt-2 text-neutral-500 font-normal">Atendimento: seg a sex, 9h às 18h</li>
              </ul>
            </div>
            <div className="flex gap-5">
              {[Instagram, Linkedin, Youtube].map((Icon, i) => (
                <Icon key={i} size={20} strokeWidth={1.5} className="text-neutral-500 hover:text-white transition-colors cursor-pointer" />
              ))}
            </div>
          </div>
        </div>
        
        <div className="pt-10 sm:pt-12 border-t border-neutral-800 flex flex-col md:flex-row justify-between items-center gap-6 sm:gap-8 text-center md:text-left">
          <p className="text-xs text-neutral-500">© 2025 NOX FIANÇA. Todos os direitos reservados.</p>
          <div className="flex flex-wrap justify-center gap-6 sm:gap-8 text-xs text-neutral-500 font-bold uppercase tracking-widest">
            <a href="#" className="hover:text-white transition-colors">Privacidade</a>
            <a href="#" className="hover:text-white transition-colors">Termos</a>
            <a href="#" className="hover:text-white transition-colors">Cookies</a>
          </div>
        </div>
      </div>
    </footer>
  </>
  );
};
