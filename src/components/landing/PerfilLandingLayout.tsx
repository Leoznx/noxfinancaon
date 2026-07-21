import React from 'react';
import { InstitutionalHeader } from './InstitutionalHeader';
import { InstitutionalFooter } from './FaqAndFooterInstitutional';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Quote } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Beneficio {
  icone: any;
  titulo: string;
  texto: string;
}

interface PerfilLandingLayoutProps {
  icone: any;
  perfil: 'corretor' | 'imobiliaria' | 'proprietario' | 'inquilino';
  labelPerfil: string;
  titulo: string;
  subtitulo: string;
  beneficios: Beneficio[];
  depoimento: {
    texto: string;
    autor: string;
    cargo: string;
  };
  imagemUrl: string;
}

const cadastroRouteByPerfil = {
  corretor: '/cadastro-corretor',
  imobiliaria: '/cadastro-imobiliaria',
  proprietario: '/cadastro-proprietario',
  inquilino: '/cadastro-inquilino',
} as const;

export function PerfilLandingLayout({ 
  icone: Icone, 
  perfil, 
  labelPerfil,
  titulo, 
  subtitulo, 
  beneficios, 
  depoimento,
  imagemUrl
}: PerfilLandingLayoutProps) {
  return (
    <div className="min-h-screen bg-white">
      <InstitutionalHeader />
      
      <main className="pt-20">
        {/* Hero */}
        <section className="container mx-auto px-6 py-16 lg:py-24 max-w-7xl">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="order-2 lg:order-1 animate-in fade-in slide-in-from-left duration-700">
              <div className="inline-flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-full px-4 py-1.5 mb-8">
                <Icone className="w-4 h-4 text-yellow-600" strokeWidth={2.5} />
                <span className="text-xs font-black uppercase tracking-[0.15em] text-neutral-800">
                  Para {labelPerfil}
                </span>
              </div>
              
              <h1 className="text-4xl lg:text-7xl font-black text-neutral-900 tracking-tighter leading-[1] mb-8">
                {titulo}
              </h1>
              
              <p className="text-lg text-neutral-600 mb-10 leading-relaxed max-w-xl font-medium">
                {subtitulo}
              </p>
              
              <div className="flex flex-col sm:flex-row gap-4">
                <Link 
                  to="/login"
                  search={{ perfil, returnTo: `/dashboard` }}
                  className="bg-neutral-900 hover:bg-neutral-800 text-white px-8 py-4 rounded-xl font-bold inline-flex items-center justify-center gap-2 shadow-xl shadow-neutral-200 transition-all active:scale-95"
                >
                  Entrar no painel
                  <ArrowRight className="w-5 h-5" strokeWidth={2.5} />
                </Link>
                <Link 
                  to={cadastroRouteByPerfil[perfil]}
                  className="bg-yellow-400 hover:bg-yellow-500 text-neutral-900 px-8 py-4 rounded-xl font-bold inline-flex items-center justify-center gap-2 shadow-xl shadow-yellow-100 transition-all active:scale-95"
                >
                  Criar conta grátis
                </Link>
              </div>
            </div>
            
            <div className="order-1 lg:order-2 relative animate-in fade-in slide-in-from-right duration-1000">
              <div className="absolute -inset-4 bg-yellow-400/10 rounded-[2rem] blur-3xl -z-10"></div>
              <img 
                src={imagemUrl} 
                alt={titulo}
                loading="eager"
                decoding="async"
                fetchPriority="high"
                width={1200}
                height={900}
                className="w-full h-auto rounded-3xl shadow-2xl border-4 border-white object-cover aspect-[4/3]"
              />
            </div>
          </div>
        </section>
        
        {/* Benefícios */}
        <section className="bg-neutral-50 py-24">
          <div className="container mx-auto px-6 max-w-7xl text-center">
            <h2 className="text-3xl lg:text-5xl font-black text-neutral-900 tracking-tight mb-16">
              Por que escolher a NOX FIANÇA
            </h2>
            
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
              {beneficios.map((b, i) => (
                <div key={i} className="bg-white border border-neutral-100 rounded-2xl p-8 text-left shadow-sm hover:shadow-xl transition-all hover:-translate-y-1">
                  <div className="bg-yellow-400 rounded-xl p-3 inline-flex mb-6 text-neutral-900">
                    <b.icone className="w-6 h-6" strokeWidth={2.5} />
                  </div>
                  <h3 className="text-xl font-bold text-neutral-900 mb-3 tracking-tight">{b.titulo}</h3>
                  <p className="text-sm text-neutral-500 leading-relaxed font-medium">{b.texto}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
        
        {/* Depoimento */}
        <section className="container mx-auto px-6 py-24 max-w-7xl">
          <div className="max-w-4xl mx-auto bg-neutral-900 rounded-[2.5rem] p-10 lg:p-20 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-yellow-400/10 blur-3xl rounded-full"></div>
            <Quote className="w-12 h-12 text-yellow-400 mb-8" strokeWidth={1.5} />
            <p className="text-2xl lg:text-3xl text-white font-medium italic leading-snug mb-10 tracking-tight">
              "{depoimento.texto}"
            </p>
            <div className="flex items-center gap-4 border-t border-white/10 pt-8">
              <div className="w-12 h-12 rounded-full bg-yellow-400 flex items-center justify-center font-black text-neutral-900">
                {depoimento.autor.charAt(0)}
              </div>
              <div>
                <p className="font-bold text-white text-lg">{depoimento.autor}</p>
                <p className="text-neutral-400 font-medium">{depoimento.cargo}</p>
              </div>
            </div>
          </div>
        </section>
        
        {/* CTA final */}
        <section className="bg-neutral-900 text-white py-20">
          <div className="container mx-auto px-6 text-center max-w-4xl">
            <h2 className="text-4xl lg:text-6xl font-black text-white tracking-tighter mb-6">
              Pronto para começar?
            </h2>
            <p className="text-xl text-neutral-400 mb-10 font-medium max-w-2xl mx-auto leading-relaxed">
              Fale com nosso time e descubra como aumentar sua conversão e rentabilidade com a NOX FIANÇA.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link 
                to="/contato"
                search={{ perfil }}
                className="bg-yellow-400 hover:bg-yellow-500 text-neutral-900 px-10 py-4 rounded-xl font-black text-lg shadow-2xl transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                Solicitar contato
                <ArrowRight className="w-5 h-5" strokeWidth={3} />
              </Link>
              <Link 
                to={cadastroRouteByPerfil[perfil]}
                className="border border-white/20 hover:bg-white/5 text-white px-10 py-4 rounded-xl font-black text-lg transition-all active:scale-95"
              >
                Criar conta grátis
              </Link>
            </div>
          </div>
        </section>
      </main>
      
      <InstitutionalFooter />
    </div>
  );
}
