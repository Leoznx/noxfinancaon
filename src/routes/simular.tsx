import { createFileRoute, Outlet, Link } from "@tanstack/react-router";
import { InstitutionalHeader } from "@/components/landing/InstitutionalHeader";
import { LogoNox } from "@/components/LogoNox";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/simular")({
  component: SimularLayout,
});

function SimularLayout() {
  return (
    <div className="min-h-screen bg-[#FAFAFA] flex flex-col">
      <header className="h-20 bg-white border-b border-neutral-100 flex items-center shrink-0">
        <div className="container mx-auto px-6 flex items-center justify-between max-w-7xl">
          <Link to="/" className="flex items-center gap-3">
            <LogoNox variant="claro" size="md" />
          </Link>
          <Link to="/login" className="text-sm font-bold text-neutral-600 hover:text-neutral-900 flex items-center gap-2">
            Já tenho conta <span className="text-neutral-300">·</span> <span className="text-neutral-900">Entrar</span>
          </Link>
        </div>
      </header>
      
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>

      <footer className="py-8 text-center text-xs text-neutral-400">
        © 2025 NOX FIANÇA - Todos os direitos reservados.
      </footer>
    </div>
  );
}
