import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";

export function RouteErrorFallback({ error, reset, message }: { error: Error; reset: () => void; message?: string }) {
  console.error("[RouteError]", error);
  return (
    <DashboardLayout>
      <div className="max-w-xl mx-auto mt-12 text-center p-8 rounded-xl border bg-card">
        <h2 className="text-lg font-semibold">{message ?? "Não foi possível carregar esta página."}</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Tente novamente. Se o problema persistir, verifique suas permissões ou volte ao painel.
        </p>
        <div className="flex gap-2 justify-center mt-5">
          <Button onClick={() => reset()}>Tentar novamente</Button>
          <Button asChild variant="outline"><Link to="/dashboard">Voltar ao painel</Link></Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
