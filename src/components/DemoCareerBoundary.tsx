import { type ReactNode } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useVerifiedSimulation } from "@/hooks/use-verified-simulation";
import { isDemoSimulationEmail, type DemoIdentity } from "@/lib/demo-simulation";
import { demoCareerSimulation as career, demoCareerRoles } from "@/lib/demo-career-simulation";

export function DemoCareerBoundary({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <p role="status">Verificando sessão…</p>;
  if (!user || !isDemoSimulationEmail(user.email)) return <>{children}</>;
  return <DemoCareer key={`${user.id}:${user.email}:${user.role}`} user={user} />;
}
function DemoCareer({ user }: { user: DemoIdentity }) {
  const verified = useVerifiedSimulation(user);
  if (verified !== "verified")
    return (
      <p role="status">
        {verified === "checking"
          ? "Verificando identidade demo…"
          : "Não foi possível verificar esta identidade demo. Nenhuma operação foi liberada."}
      </p>
    );
  if (!demoCareerRoles.includes(user.role))
    return <p>Carreira não disponível para este perfil demonstrativo.</p>;
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <p className="rounded-xl bg-yellow-100 p-4">
        Demonstração local · contratos, níveis e comissões fictícios. Nenhuma operação financeira.
      </p>
      <h1 className="text-2xl font-bold">Plano de Carreira demonstrativo</h1>
      <h2>
        {career.currentLevel} • {career.activeContracts} contratos
      </h2>
      <p>1,5% de comissão fictícia por contrato</p>
      <progress
        aria-label="Progresso para o próximo nível"
        max={100}
        value={career.progress}
        aria-valuenow={career.progress}
        className="w-full"
      />
      <p>
        Faltam {career.remainingContracts} contratos para {career.nextLevel}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {career.levels.map((level) => (
          <section key={level.name} className="rounded-xl border p-4">
            <h3>{level.name}</h3>
            <p>
              {level.minimum}
              {level.maximum === null ? "+" : `–${level.maximum}`} contratos fictícios
            </p>
            <p>{level.commission}% de comissão fictícia</p>
          </section>
        ))}
      </div>
    </main>
  );
}
