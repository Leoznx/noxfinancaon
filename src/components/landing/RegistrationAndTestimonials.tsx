import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';


const leadSchema = z.object({
  nome: z.string().min(3, 'Nome muito curto'),
  email: z.string().email('E-mail inválido'),
  telefone: z.string().min(10, 'Telefone inválido'),
  perfil: z.string().min(1, 'Selecione um perfil'),
  cnpj_creci: z.string().optional(),
  cidade: z.string().min(2, 'Informe a cidade'),
  aceito_comunicacoes: z.boolean().refine(val => val === true, 'Necessário aceitar'),
});

type LeadFormValues = z.infer<typeof leadSchema>;

export const RegistrationForm = () => {
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<LeadFormValues>({
    resolver: zodResolver(leadSchema),
    defaultValues: { aceito_comunicacoes: false }
  });

  const perfil = watch('perfil');

  const onSubmit = async (data: LeadFormValues) => {
    try {
      const { supabase } = await import('@/integrations/supabase/client');
      const { error } = await supabase.from('leads').insert([
        { nome: data.nome, email: data.email, telefone: data.telefone, perfil: data.perfil, cnpj_creci: data.cnpj_creci, cidade: data.cidade }
      ]);
      if (error) throw error;
      toast.success('Cadastro enviado com sucesso! Nossa equipe entrará em contato.');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao enviar cadastro. Tente novamente mais tarde.');
    }
  };

  return (
    <section id="contato" className="py-16 sm:py-24 px-4 sm:px-6 bg-white">
      <div className="container mx-auto max-w-7xl grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
        <div>
          <span className="inline-block px-3 py-1 bg-neutral-100 text-neutral-700 text-xs font-bold tracking-widest rounded-full mb-6">
            COMEÇAR AGORA
          </span>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-neutral-900 mb-6 sm:mb-8 leading-tight tracking-tight">
            Cadastre-se e receba uma proposta personalizada em até 24 horas.
          </h2>
          <p className="text-base sm:text-lg lg:text-xl text-neutral-500 mb-8 sm:mb-10 leading-relaxed">
            Sem compromisso. Nossa equipe entrará em contato para entender as necessidades específicas da sua operação imobiliária.
          </p>
          <div className="space-y-5 sm:space-y-6">
            {[
              'Análise gratuita do seu portfólio',
              'Apresentação comercial sob demanda',
              'Implementação acompanhada por especialista'
            ].map(item => (
              <div key={item} className="flex items-center gap-4 text-neutral-800 font-medium text-sm sm:text-base">
                <div className="w-6 h-6 shrink-0 rounded-full bg-[#FACC15] flex items-center justify-center">
                  <Check size={14} className="text-neutral-900" strokeWidth={3} />
                </div>
                {item}
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white p-5 sm:p-8 md:p-10 rounded-xl border border-neutral-200 shadow-xl shadow-neutral-100">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-neutral-700">Nome completo</label>
              <Input {...register('nome')} placeholder="Ex: João da Silva" className="rounded-lg h-12 min-h-[44px]" />
              {errors.nome && <p className="text-xs text-red-600 font-medium">{errors.nome.message}</p>}
            </div>
            
            <div className="grid sm:grid-cols-2 gap-5">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-neutral-700">E-mail corporativo</label>
                <Input {...register('email')} type="email" placeholder="joao@empresa.com.br" className="rounded-lg h-12 min-h-[44px]" />
                {errors.email && <p className="text-xs text-red-600 font-medium">{errors.email.message}</p>}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-neutral-700">Telefone</label>
                <Input {...register('telefone')} placeholder="(11) 99999-9999" className="rounded-lg h-12 min-h-[44px]" />
                {errors.telefone && <p className="text-xs text-red-600 font-medium">{errors.telefone.message}</p>}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-neutral-700">Perfil</label>
              <select 
                {...register('perfil')}
                className="flex h-12 min-h-[44px] w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-900 transition-all"
              >
                <option value="">Selecione seu perfil</option>
                <option value="gestor">Gestor de imobiliária</option>
                <option value="corretor">Corretor de imóveis</option>
                <option value="proprietario">Proprietário de imóvel</option>
                <option value="inquilino">Inquilino</option>
                <option value="outro">Outro</option>
              </select>
              {errors.perfil && <p className="text-xs text-red-600 font-medium">{errors.perfil.message}</p>}
            </div>

            {(perfil === 'gestor' || perfil === 'corretor') && (
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-neutral-700">
                  {perfil === 'gestor' ? 'CNPJ da Imobiliária' : 'CRECI'}
                </label>
                <Input {...register('cnpj_creci')} placeholder={perfil === 'gestor' ? '00.000.000/0001-00' : 'F-00000'} className="rounded-lg h-12 min-h-[44px]" />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-neutral-700">Cidade / Estado</label>
              <Input {...register('cidade')} placeholder="Ex: São Paulo - SP" className="rounded-lg h-12 min-h-[44px]" />
              {errors.cidade && <p className="text-xs text-red-600 font-medium">{errors.cidade.message}</p>}
            </div>

            <div className="pt-2">
              <div className="flex items-start gap-3">
                <input {...register('aceito_comunicacoes')} type="checkbox" className="mt-1 accent-neutral-900 w-5 h-5" id="aceito_com" />
                <label htmlFor="aceito_com" className="text-xs text-neutral-500 font-medium leading-relaxed">
                  Aceito receber comunicações da NOX FIANÇA por e-mail e telefone para fins comerciais.
                </label>
              </div>
              {errors.aceito_comunicacoes && <p className="text-xs text-red-600 font-medium mt-1">{errors.aceito_comunicacoes.message}</p>}
            </div>

            <p className="text-[10px] text-neutral-400 font-medium text-center">
              Ao enviar, você concorda com nossa Política de Privacidade e Termos de Uso.
            </p>

            <Button disabled={isSubmitting} className="w-full min-h-[44px] h-14 bg-neutral-900 text-white hover:bg-neutral-800 rounded-lg font-bold text-base sm:text-lg transition-all">
              {isSubmitting ? 'Enviando...' : 'Enviar cadastro'}
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
};

export const InstitutionalTestimonials = () => {
  const testimonials = [
    { name: "Pedro Granada", role: "Diretor Comercial, Granada Imóveis", avatar: "https://randomuser.me/api/portraits/men/32.jpg", text: "A NOX transformou nossa operação de locação. O tempo médio de aprovação de inquilinos caiu de duas semanas para menos de uma hora. A previsibilidade financeira para nossos proprietários é incomparável." },
    { name: "Ana Paula Perez", role: "CEO, Imobiliária Perez", avatar: "https://randomuser.me/api/portraits/women/44.jpg", text: "Adotamos a NOX há dezoito meses e o impacto na conversão de visitas em contratos foi de 38%. O suporte técnico e jurídico funciona como uma extensão da nossa equipe." },
    { name: "Maurício Andrade", role: "Corretor Sênior, VOX16 Imóveis", avatar: "https://randomuser.me/api/portraits/men/45.jpg", text: "O modelo de comissionamento progressivo da NOX é justo e transparente. É o tipo de parceria que reconhece o trabalho do corretor de verdade." },
    { name: "Camila Bittencourt", role: "Sócia-Diretora, Brognoli Negócios Imobiliários", avatar: "https://randomuser.me/api/portraits/women/68.jpg", text: "Reduzimos a inadimplência em 71% no primeiro semestre. A integração com nosso CRM foi entregue em menos de uma semana — coisa rara no mercado." },
    { name: "Rafael Tavares", role: "Gerente de Locação, Lopes Consultoria", avatar: "https://randomuser.me/api/portraits/men/52.jpg", text: "A análise antifraude da NOX pegou casos que passariam batidos pela nossa equipe. O proprietário dorme tranquilo e nós também." },
    { name: "Letícia Vasconcelos", role: "Coordenadora de Carteira, Auxiliadora Predial", avatar: "https://randomuser.me/api/portraits/women/12.jpg", text: "Migramos toda a carteira de garantias em 30 dias. O onboarding foi simples e os relatórios mensais entregam clareza total sobre cada contrato." },
    { name: "Bruno Carvalho", role: "Head de Locação, Coelho da Fonseca", avatar: "https://randomuser.me/api/portraits/men/76.jpg", text: "Comparei com três concorrentes antes de fechar. A NOX foi a única que cumpriu o SLA de aprovação prometido — não em alguns casos, em todos." },
    { name: "Juliana Mascarenhas", role: "Diretora Operacional, Conexão Imóveis", avatar: "https://randomuser.me/api/portraits/women/31.jpg", text: "O painel do gestor entrega exatamente os indicadores que eu cobrava da minha equipe há anos. Saímos das planilhas para uma operação realmente orientada por dados." },
    { name: "Eduardo Marinho", role: "Sócio, Bossa Nova Sotheby's Realty", avatar: "https://randomuser.me/api/portraits/men/83.jpg", text: "Atendemos imóveis de altíssimo padrão e precisávamos de uma garantia que conversasse com esse perfil de cliente. A NOX entregou isso sem fricção." },
    { name: "Renata Holanda", role: "Gerente Comercial, Casa Mineira Imóveis", avatar: "https://randomuser.me/api/portraits/women/65.jpg", text: "O tempo que minha equipe gastava cobrando documento e validando renda virou tempo para fechar negócio. Triplicamos a produtividade do time de locação." },
    { name: "Tiago Ferreira", role: "Diretor, Apolar Imóveis", avatar: "https://randomuser.me/api/portraits/men/29.jpg", text: "Já estamos no segundo ano de parceria. O suporte responde em minutos e o produto evolui mês a mês — sentimos que a NOX cresce junto com a gente." },
    { name: "Beatriz Lacerda", role: "Diretora de Locação, Abyara Brasil", avatar: "https://randomuser.me/api/portraits/women/55.jpg", text: "A experiência do inquilino é o diferencial. Os clientes elogiam o processo de aprovação espontaneamente — isso fortalece nossa marca também." },
    { name: "Felipe Negrão", role: "Gestor de Contratos, Patrimóvel Negócios Imobiliários", avatar: "https://randomuser.me/api/portraits/men/91.jpg", text: "A régua de cobrança automatizada acabou com o atrito do nosso departamento financeiro. Recebimentos em dia viraram regra, não exceção." },
  ];

  const [perView, setPerView] = useState(1);
  const [position, setPosition] = useState(1);
  const [transitionEnabled, setTransitionEnabled] = useState(true);
  const total = testimonials.length;
  const loopedTestimonials = [
    ...testimonials.slice(-perView),
    ...testimonials,
    ...testimonials.slice(0, perView),
  ];
  const activeIndex = ((position - perView) % total + total) % total;

  useEffect(() => {
    const updatePerView = () => {
      if (window.matchMedia('(min-width: 1024px)').matches) {
        setPerView(3);
      } else if (window.matchMedia('(min-width: 640px)').matches) {
        setPerView(2);
      } else {
        setPerView(1);
      }
    };

    updatePerView();
    window.addEventListener('resize', updatePerView);
    return () => window.removeEventListener('resize', updatePerView);
  }, []);

  useEffect(() => {
    setTransitionEnabled(false);
    setPosition(perView);
    const timer = window.setTimeout(() => setTransitionEnabled(true), 40);
    return () => window.clearTimeout(timer);
  }, [perView]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTransitionEnabled(true);
      setPosition((current) => current + 1);
    }, 8000);

    return () => window.clearInterval(timer);
  }, []);

  const resetAfterLoop = () => {
    if (position >= total + perView) {
      setTransitionEnabled(false);
      setPosition(perView);
      window.requestAnimationFrame(() => setTransitionEnabled(true));
    }

    if (position < perView) {
      setTransitionEnabled(false);
      setPosition(total + perView - 1);
      window.requestAnimationFrame(() => setTransitionEnabled(true));
    }
  };

  const prev = () => {
    setTransitionEnabled(true);
    setPosition((current) => current - 1);
  };

  const next = () => {
    setTransitionEnabled(true);
    setPosition((current) => current + 1);
  };

  return (
    <section className="py-16 sm:py-24 px-4 sm:px-6 bg-neutral-50 border-y border-neutral-100">
      <div className="container mx-auto max-w-7xl">
        <div className="text-center mb-12 sm:mb-16">
          <span className="inline-block px-3 py-1 bg-neutral-100 text-neutral-700 text-xs font-bold tracking-widest rounded-full mb-6">
            DEPOIMENTOS
          </span>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-neutral-900 tracking-tight">O que dizem os parceiros da NOX FIANÇA.</h2>
        </div>

        <div className="relative">
          <div className="overflow-hidden">
            <div
              className={`flex ${transitionEnabled ? 'transition-transform duration-500 ease-out' : ''}`}
              style={{ transform: `translateX(-${position * (100 / perView)}%)` }}
              onTransitionEnd={resetAfterLoop}
            >
              {loopedTestimonials.map((t, i) => (
                <div
                  key={`${t.name}-${i}`}
                  className="w-full sm:w-1/2 lg:w-1/3 shrink-0 px-2 sm:px-3"
                >
                  <div className="p-6 sm:p-8 rounded-xl bg-white border border-neutral-200 shadow-sm flex flex-col h-full">
                    <p className="text-base sm:text-lg text-neutral-600 italic font-serif leading-relaxed flex-1 mb-6">
                      "{t.text}"
                    </p>
                    <div className="pt-6 border-t border-neutral-100 flex items-center gap-4">
                      <img
                        src={t.avatar}
                        alt={t.name}
                        loading="lazy"
                        width={48}
                        height={48}
                        className="w-12 h-12 rounded-full object-cover border border-neutral-200"
                      />
                      <div>
                        <p className="font-bold text-neutral-900 text-sm leading-none mb-1">{t.name}</p>
                        <p className="text-xs text-neutral-500 font-medium">{t.role}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-center gap-4 mt-8">
            <button
              onClick={prev}
              aria-label="Anterior"
              className="w-12 h-12 min-h-[44px] min-w-[44px] rounded-full bg-white border border-neutral-200 shadow-sm flex items-center justify-center hover:bg-neutral-900 hover:text-white transition-colors active:scale-95"
            >
              <ChevronLeft size={20} />
            </button>
            <div className="flex items-center gap-1.5">
              {testimonials.map((_, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setTransitionEnabled(true);
                    setPosition(i + perView);
                  }}
                  aria-label={`Ir para depoimento ${i + 1}`}
                  className={`h-2 rounded-full transition-all ${i === activeIndex ? 'w-6 bg-neutral-900' : 'w-2 bg-neutral-300'}`}
                />
              ))}
            </div>
            <button
              onClick={next}
              aria-label="Próximo"
              className="w-12 h-12 min-h-[44px] min-w-[44px] rounded-full bg-white border border-neutral-200 shadow-sm flex items-center justify-center hover:bg-neutral-900 hover:text-white transition-colors active:scale-95"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

