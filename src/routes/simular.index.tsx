import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { FormularioSimulacao, DadosSimulacao } from "@/components/simulacao/FormularioSimulacao";
import { ChevronRight } from "lucide-react";

export const Route = createFileRoute("/simular/")({
  component: SimularPublico,
});

function SimularPublico() {
  const navigate = useNavigate();

  async function handleSubmit(dados: DadosSimulacao) {
    localStorage.setItem('nox_simulacao_pendente', JSON.stringify({
      ...dados,
      criadoEm: new Date().toISOString(),
    }));

    const { supabase } = await import("@/integrations/supabase/client");
    const { data: { session } } = await supabase.auth.getSession();

    if (session) {
      navigate({ to: '/simular/resultado' });
    } else {
      navigate({
        to: '/login',
        search: { returnTo: '/simular/resultado' }
      });
    }
  }

  return (
    <div className="px-4 py-12 lg:py-20">
      <div className="w-full max-w-6xl mx-auto">
        <div className="flex items-center gap-2 text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-6">
          <Link to="/" className="hover:text-neutral-900 transition-colors">Início</Link>
          <ChevronRight size={10} />
          <span className="text-neutral-900">Solicitar Análise</span>
        </div>

        <div className="animate-fade-in">
          <FormularioSimulacao modo="publico" onSubmit={handleSubmit} />
        </div>
      </div>
    </div>
  );
}
