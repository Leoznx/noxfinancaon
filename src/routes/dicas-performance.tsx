import { createFileRoute, Link } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/components/AuthProvider";
import { ArrowLeft, TrendingUp, Target, Users, Sparkles, MessageCircle, Award } from "lucide-react";

export const Route = createFileRoute("/dicas-performance")({
  component: () => (
    <ProtectedRoute roles={["corretor", "imobiliaria", "proprietario"]}>
      <DicasPage />
    </ProtectedRoute>
  ),
});

const DICAS: Record<string, { titulo: string; icone: any; descricao: string }[]> = {
  corretor: [
    { titulo: "Acelere consultas no mesmo dia", icone: TrendingUp, descricao: "Envie a documentação do inquilino completa logo na primeira interação. Consultas com docs completas têm 3x mais chance de aprovação rápida." },
    { titulo: "Foque em renovações", icone: Target, descricao: "Cada contrato renovado mantém sua comissão recorrente e conta para a subida de nível. Avise o inquilino com 60 dias de antecedência." },
    { titulo: "Indique outros corretores", icone: Users, descricao: "Use seu link de indicação no painel para ganhar bônus quando um corretor indicado fechar o primeiro contrato." },
    { titulo: "Mantenha sua carteira saudável", icone: Sparkles, descricao: "Apólices canceladas reduzem sua contagem de contratos ativos. Acompanhe inadimplências e atue rápido com o inquilino." },
  ],
  imobiliaria: [
    { titulo: "Padronize a captação", icone: Target, descricao: "Treine sua equipe para apresentar a NOX Fiança como primeira opção. Imobiliárias com fluxo padronizado fecham 40% mais." },
    { titulo: "Use o co-branding", icone: Award, descricao: "A partir do nível OURO, sua marca aparece nos materiais oficiais. Solicite seu kit visual pelo gerente de conta." },
    { titulo: "Acompanhe pelo dashboard", icone: TrendingUp, descricao: "O painel da equipe mostra quais corretores trazem mais contratos. Reconheça os destaques internamente." },
    { titulo: "Reduza o churn", icone: Sparkles, descricao: "Contratos cancelados não contam para o nível. Implemente uma rotina de check-in com inquilinos a cada 90 dias." },
  ],
  proprietario: [
    { titulo: "Cadastre todos os seus imóveis", icone: Target, descricao: "Quanto mais imóveis ativos no seu nome, maior o cashback por contrato fechado." },
    { titulo: "Renove com antecedência", icone: TrendingUp, descricao: "Renovações garantem bônus fixo. Confirme o interesse do inquilino antes do vencimento da apólice." },
    { titulo: "Aproveite a vistoria gratuita", icone: Award, descricao: "A partir do OURO, você tem vistoria anual sem custo. Use para manter o valor do imóvel." },
    { titulo: "Fale com seu concierge", icone: MessageCircle, descricao: "No DIAMANTE, um concierge dedicado cuida de tudo. Aproveite para tirar dúvidas e otimizar sua carteira." },
  ],
};

function DicasPage() {
  const { user } = useAuth();
  const tipo = (user?.role || "corretor") as "corretor" | "imobiliaria" | "proprietario";
  const dicas = DICAS[tipo] || DICAS.corretor;

  const titulo = tipo === "corretor" ? "Dicas para Corretor" : tipo === "imobiliaria" ? "Dicas para sua Imobiliária" : "Dicas para Proprietário";

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div>
          <Link to="/plano-carreira" className="inline-flex items-center gap-2 text-sm font-bold text-neutral-500 hover:text-neutral-900 transition-colors mb-4">
            <ArrowLeft className="w-4 h-4" />
            Voltar ao Plano de Carreira
          </Link>
          <h1 className="text-3xl font-black text-neutral-900 tracking-tight">{titulo}</h1>
          <p className="text-neutral-500 mt-1 font-medium max-w-2xl">
            Boas práticas para subir de nível mais rápido e maximizar seus ganhos na NOX Fiança.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {dicas.map((d, i) => {
            const Icone = d.icone;
            return (
              <div key={i} className="bg-white border border-neutral-200 rounded-2xl p-6 hover:shadow-lg hover:border-neutral-300 transition-all">
                <div className="flex items-start gap-4">
                  <div className="bg-yellow-400 rounded-xl p-3 flex-shrink-0 shadow-sm">
                    <Icone className="w-5 h-5 text-neutral-900" strokeWidth={2.5} />
                  </div>
                  <div>
                    <h3 className="font-black text-neutral-900 text-base mb-1.5">{d.titulo}</h3>
                    <p className="text-sm text-neutral-600 leading-relaxed">{d.descricao}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="bg-gradient-to-r from-neutral-900 to-neutral-800 rounded-2xl p-6 text-white flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <p className="text-lg font-black">Precisa de ajuda personalizada?</p>
            <p className="text-sm text-neutral-400">Fale com a equipe NOX e receba um plano de ação sob medida.</p>
          </div>
          <a href="https://wa.me/5511999999999" target="_blank" rel="noreferrer" className="bg-yellow-400 hover:bg-yellow-300 text-neutral-900 h-12 px-6 rounded-xl font-black transition-all active:scale-95 flex items-center gap-2">
            <MessageCircle className="w-4 h-4" strokeWidth={2.5} />
            Falar com a NOX
          </a>
        </div>
      </div>
    </DashboardLayout>
  );
}
