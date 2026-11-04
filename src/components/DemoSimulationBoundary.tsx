import { useState, type ReactNode } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";
import { useVerifiedSimulation } from "@/hooks/use-verified-simulation";
import {
  advanceSimulation,
  isDemoSimulationEmail,
  startSimulation,
  steps,
  type DemoIdentity,
  type Scenario,
} from "@/lib/demo-simulation";

export function DemoSimulationBoundary({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <p role="status">Verificando sessão…</p>;
  if (!user || !isDemoSimulationEmail(user.email)) return <>{children}</>;
  return (
    <main>
      <VerifiedSimulation key={`${user.id}:${user.email}:${user.role}`} user={user} />
    </main>
  );
}
function VerifiedSimulation({ user }: { user: DemoIdentity }) {
  const status = useVerifiedSimulation(user);
  const [state, setState] = useState(() => startSimulation());
  if (status !== "verified")
    return (
      <p role="status">
        {status === "checking"
          ? "Verificando identidade demo…"
          : "Não foi possível verificar esta identidade demo. Nenhuma operação foi liberada."}
      </p>
    );
  const step = steps[state.stage];
  return (
    <section className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="rounded-xl bg-yellow-100 p-4">
        <strong>Demonstração local · {user.role}</strong>
        <p>
          Dados fictícios. Sem envio, assinatura ou cobrança. Ao sair desta tela, o cenário é
          descartado.
        </p>
      </div>
      <h1 className="text-2xl font-bold">Simulação completa</h1>
      <div className="flex flex-wrap gap-2" aria-label="Cenários">
        {(["aprovado", "recusado", "pendente"] as Scenario[]).map((scenario) => (
          <Button
            key={scenario}
            variant={state.scenario === scenario ? "default" : "outline"}
            onClick={() => setState(startSimulation(scenario))}
          >
            {scenario === "pendente"
              ? "Em análise"
              : scenario === "aprovado"
                ? "Aprovado"
                : "Recusado"}
          </Button>
        ))}
      </div>
      <p>
        Etapa {["analise", "documentos", "contrato", "fatura", "recibo"].indexOf(state.stage) + 1}{" "}
        de 5
      </p>
      <article className="space-y-4 rounded-xl border p-6" aria-live="polite">
        <h2 className="text-xl font-bold">{step.title}</h2>
        <p>{step.detail}</p>
        {state.stage !== "recibo" && !(state.stage === "analise" && state.history.length > 0) && (
          <Button onClick={() => setState(advanceSimulation)}>{step.action}</Button>
        )}
      </article>
      <ol className="space-y-2" aria-label="Histórico">
        {state.history.map((entry, index) => (
          <li key={index}>{entry}</li>
        ))}
      </ol>
      <Button variant="outline" onClick={() => setState(startSimulation(state.scenario))}>
        Reiniciar simulação
      </Button>
    </section>
  );
}
