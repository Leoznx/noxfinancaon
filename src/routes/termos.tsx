import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/termos")({
  component: TermosPage,
});

function TermosPage() {
  return (
    <div className="min-h-screen bg-white py-20 px-6">
      <div className="container mx-auto max-w-3xl">
        <Link to="/cadastro" className="inline-flex items-center gap-2 text-neutral-500 hover:text-neutral-900 font-bold text-sm mb-12 transition-colors">
          <ArrowLeft size={18} />
          Voltar para o cadastro
        </Link>
        
        <h1 className="text-4xl font-bold text-neutral-900 mb-8 tracking-tight">Termos de Uso</h1>
        
        <div className="prose prose-neutral max-w-none space-y-6 text-neutral-600 leading-relaxed">
          <p className="text-lg font-medium text-neutral-900">Bem-vindo à NOX FIANÇA.</p>
          
          <p>
            Ao acessar ou utilizar a plataforma NOX FIANÇA, você concorda em cumprir e estar vinculado aos seguintes Termos de Uso. Leia-os com atenção.
          </p>
          
          <h2 className="text-xl font-bold text-neutral-900 mt-10">1. Objeto</h2>
          <p>
            A NOX FIANÇA fornece uma plataforma digital para facilitação de contratação de seguro fiança locatícia entre imobiliárias, corretores e inquilinos.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 mt-10">2. Cadastro e Aprovação</h2>
          <p>
            O cadastro de imobiliárias e corretores está sujeito à análise e aprovação manual pela equipe administrativa da NOX FIANÇA. Reservamo-nos o direito de recusar cadastros que não atendam aos nossos critérios internos ou de segurança.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 mt-10">3. Responsabilidades do Usuário</h2>
          <p>
            O usuário é responsável pela veracidade de todas as informações fornecidas e pela segurança de suas credenciais de acesso. O uso indevido da plataforma ou o fornecimento de dados falsos resultará no banimento imediato.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 mt-10">4. Pagamentos e Comissões</h2>
          <p>
            As regras de comissionamento para corretores seguem o Plano de Carreira NOX vigente no momento da contratação da apólice.
          </p>

          <p className="pt-10 text-sm text-neutral-400">Última atualização: 02 de Junho de 2026.</p>
        </div>
      </div>
    </div>
  );
}
