import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/privacidade")({
  component: PrivacidadePage,
});

function PrivacidadePage() {
  return (
    <div className="min-h-screen bg-white py-20 px-6">
      <div className="container mx-auto max-w-3xl">
        <Link to="/cadastro" className="inline-flex items-center gap-2 text-neutral-500 hover:text-neutral-900 font-bold text-sm mb-12 transition-colors">
          <ArrowLeft size={18} />
          Voltar para o cadastro
        </Link>
        
        <h1 className="text-4xl font-bold text-neutral-900 mb-8 tracking-tight">Política de Privacidade</h1>
        
        <div className="prose prose-neutral max-w-none space-y-6 text-neutral-600 leading-relaxed">
          <p className="text-lg font-medium text-neutral-900">Sua privacidade é nossa prioridade.</p>
          
          <p>
            Esta Política de Privacidade descreve como a NOX FIANÇA coleta, utiliza e protege suas informações pessoais de acordo com a Lei Geral de Proteção de Dados (LGPD).
          </p>
          
          <h2 className="text-xl font-bold text-neutral-900 mt-10">1. Coleta de Dados</h2>
          <p>
            Coletamos dados necessários para a identificação civil e profissional (CPF, CNPJ, CRECI) e para o processamento de análises de crédito de inquilinos.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 mt-10">2. Uso das Informações</h2>
          <p>
            Os dados coletados são utilizados exclusivamente para fins de emissão de seguro fiança, gestão de parcerias e comunicações institucionais obrigatórias. Não vendemos seus dados a terceiros.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 mt-10">3. Segurança</h2>
          <p>
            Implementamos medidas técnicas e administrativas rigorosas para proteger seus dados contra acessos não autorizados e situações acidentais ou ilícitas de destruição, perda, alteração ou difusão.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 mt-10">4. Seus Direitos</h2>
          <p>
            Você tem o direito de solicitar o acesso, correção ou exclusão de seus dados pessoais a qualquer momento através de nossos canais de suporte.
          </p>

          <p className="pt-10 text-sm text-neutral-400">Última atualização: 02 de Junho de 2026.</p>
        </div>
      </div>
    </div>
  );
}
