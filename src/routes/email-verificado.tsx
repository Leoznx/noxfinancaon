import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { LogoNox } from "@/components/LogoNox";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/AuthProvider";
import { redirectPathForRole } from "@/lib/authRedirect";

export const Route = createFileRoute("/email-verificado")({
  component: EmailVerificadoPage,
});

function EmailVerificadoPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleEntrar = () => {
    const to = user ? redirectPathForRole(user.internalRole || user.role) : "/login";
    navigate({ to: to as any });
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-neutral-50 p-6 text-center">
      <div className="mb-10">
        <LogoNox variant="claro" size="sm" />
      </div>
      <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center mb-8 text-yellow-600">
        <CheckCircle2 size={48} />
      </div>
      <h1 className="text-3xl font-bold text-neutral-900 mb-4">E-mail verificado com sucesso!</h1>
      <div className="max-w-md text-neutral-600 space-y-4 mb-10">
        <p>Sua conta foi confirmada. Agora você já pode acessar a plataforma NOX Fiança.</p>
      </div>
      <Button
        onClick={handleEntrar}
        className="bg-neutral-900 hover:bg-neutral-800 text-white px-8 py-2.5 rounded-lg font-bold text-sm h-auto"
      >
        Entrar na plataforma
      </Button>
    </div>
  );
}
