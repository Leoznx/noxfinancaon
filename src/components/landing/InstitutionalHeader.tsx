import React from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { LogoNox } from '../LogoNox';
import { UserRound, Building2, Home, KeyRound, Menu, X } from 'lucide-react';
import { useState } from 'react';

function PerfilTab({ to, icon: Icon, label }: { to: string; icon: any; label: string }) {
  return (
    <Link 
      to={to}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-base font-medium text-neutral-600 hover:bg-yellow-50 hover:text-neutral-900 transition-colors"
    >
      <Icon className="w-4 h-4 text-neutral-900" strokeWidth={2.75} />
      {label}
    </Link>
  );
}

export const InstitutionalHeader = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <header className="fixed top-0 w-full z-50 bg-white/90 backdrop-blur-md border-b border-neutral-100">
      <div className="container mx-auto px-6 h-20 flex items-center justify-between max-w-7xl">
        {/* Esquerda: Logo */}
        <Link to="/" className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity shrink-0">
          <LogoNox variant="claro" size="md" />
        </Link>
        
        {/* Centro: Menu principal + abas de perfil (Desktop) */}
        <nav className="hidden lg:flex items-center gap-1">
          <Link to="/#comparativo" className="px-3 py-1.5 text-base font-medium text-neutral-600 hover:text-neutral-900 transition-colors">Seguro Fiança</Link>
          <Link to="/#planos" className="px-3 py-1.5 text-base font-medium text-neutral-600 hover:text-neutral-900 transition-colors">Planos</Link>
          <Link to="/contato" className="px-3 py-1.5 text-base font-medium text-neutral-600 hover:text-neutral-900 transition-colors">Contato</Link>
          
          <span className="w-px h-5 bg-neutral-200 mx-3"></span>
          
          <PerfilTab to="/corretor" icon={UserRound} label="Corretor" />
          <PerfilTab to="/imobiliaria" icon={Building2} label="Imobiliária" />
          <PerfilTab to="/proprietario" icon={Home} label="Proprietário" />
          <PerfilTab to="/inquilino" icon={KeyRound} label="Inquilino" />
        </nav>

        {/* Direita: Botões (Desktop) */}
        <div className="hidden lg:flex items-center gap-4">
          <span className="w-px h-5 bg-neutral-200"></span>
          <Link to="/login">
            <Button variant="ghost" className="text-neutral-700 font-medium text-base">Entrar</Button>
          </Link>
          <Link to="/simular">
            <Button className="bg-neutral-900 text-white hover:bg-neutral-800 px-5 py-2 rounded-lg font-bold text-base shadow-xl shadow-neutral-100 transition-all active:scale-95">
              Solicitar Análise
            </Button>
          </Link>
        </div>

        {/* Menu Mobile Button */}
        <button 
          className="lg:hidden p-2 text-neutral-600 hover:text-neutral-900"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        >
          {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile Menu Drawer */}
      {isMobileMenuOpen && (
          <div className="lg:hidden bg-white border-t border-neutral-100 overflow-hidden">
            <div className="container mx-auto px-6 py-6 space-y-6">
              <nav className="flex flex-col gap-4">
                <Link to="/#comparativo" onClick={() => setIsMobileMenuOpen(false)} className="text-base font-medium text-neutral-600">Seguro Fiança</Link>
                <Link to="/#planos" onClick={() => setIsMobileMenuOpen(false)} className="text-base font-medium text-neutral-600">Planos</Link>
                <Link to="/contato" onClick={() => setIsMobileMenuOpen(false)} className="text-base font-medium text-neutral-600">Contato</Link>
              </nav>

              <div className="pt-4 border-t border-neutral-100">
                <p className="text-xs font-bold uppercase tracking-widest text-neutral-400 mb-4">Acesse por perfil</p>
                <nav className="flex flex-col gap-3">
                  <Link to="/corretor" onClick={() => setIsMobileMenuOpen(false)} className="flex items-center gap-2 text-base font-medium text-neutral-700">
                    <UserRound className="w-5 h-5 text-neutral-900" strokeWidth={2.75} /> Corretor
                  </Link>
                  <Link to="/imobiliaria" onClick={() => setIsMobileMenuOpen(false)} className="flex items-center gap-2 text-base font-medium text-neutral-700">
                    <Building2 className="w-5 h-5 text-neutral-900" strokeWidth={2.75} /> Imobiliária
                  </Link>
                  <Link to="/proprietario" onClick={() => setIsMobileMenuOpen(false)} className="flex items-center gap-2 text-base font-medium text-neutral-700">
                    <Home className="w-5 h-5 text-neutral-900" strokeWidth={2.75} /> Proprietário
                  </Link>
                  <Link to="/inquilino" onClick={() => setIsMobileMenuOpen(false)} className="flex items-center gap-2 text-base font-medium text-neutral-700">
                    <KeyRound className="w-5 h-5 text-neutral-900" strokeWidth={2.75} /> Inquilino
                  </Link>
                </nav>
              </div>

              <div className="pt-4 flex flex-col gap-3">
                <Link to="/login" onClick={() => setIsMobileMenuOpen(false)}>
                  <Button variant="outline" className="w-full h-12 font-bold text-neutral-900 border-neutral-200">Entrar</Button>
                </Link>
                <Link to="/simular" onClick={() => setIsMobileMenuOpen(false)}>
                  <Button className="w-full h-12 bg-neutral-900 text-white font-bold">Solicitar Análise</Button>
                </Link>
              </div>
            </div>
          </div>
        )}
    </header>
  );
};
