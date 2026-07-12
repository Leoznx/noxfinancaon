import React from "react";
import { useEffect, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { useAuth } from "./AuthProvider";
import { getCachedPermissoesCargo, loadPermissoesCargo, podeVerModulo } from "@/lib/permissoes-cache";

const CARGOS_INTERNOS_GATEADOS = ["juridico", "financeiro", "marketing", "suporte", "vendedor"];

export function ProtectedRoute({
  children,
  roles,
  moduleKey,
}: {
  children: React.ReactNode;
  roles?: string[];
  moduleKey?: string;
}) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  const isAllowed = (u: { role: string; internalRole?: string | null }) => {
    if (!roles) return true;
    if (roles.includes(u.role)) return true;
    if (u.internalRole && roles.includes(u.internalRole)) return true;
    return false;
  };

  // Não basta esconder a aba do menu — a rota também precisa recusar acesso
  // direto (digitando a URL) pra quem não tem a permissão real do cargo.
  // Só os 5 cargos internos gateados passam por essa checagem extra; admin/
  // admin_master/analista (e todo o resto do app, quando moduleKey não é
  // passado) seguem só a checagem de roles de sempre.
  const cargoGateado =
    user && moduleKey
      ? CARGOS_INTERNOS_GATEADOS.includes(user.internalRole || "")
        ? user.internalRole!
        : CARGOS_INTERNOS_GATEADOS.includes(user.role)
          ? user.role
          : null
      : null;

  const [permissoesCarregando, setPermissoesCarregando] = useState(!!cargoGateado);
  const [temPermissaoModulo, setTemPermissaoModulo] = useState<boolean>(!cargoGateado);

  useEffect(() => {
    if (!cargoGateado || !moduleKey) {
      setTemPermissaoModulo(true);
      setPermissoesCarregando(false);
      return;
    }
    const cached = getCachedPermissoesCargo(cargoGateado);
    if (cached !== undefined) {
      setTemPermissaoModulo(podeVerModulo(cached, moduleKey));
      setPermissoesCarregando(false);
      return;
    }
    setPermissoesCarregando(true);
    loadPermissoesCargo(cargoGateado)
      .then((permissoes) => {
        setTemPermissaoModulo(podeVerModulo(permissoes, moduleKey));
        setPermissoesCarregando(false);
      })
      .catch(() => {
        setTemPermissaoModulo(false);
        setPermissoesCarregando(false);
      });
  }, [cargoGateado, moduleKey]);

  useEffect(() => {
    if (isLoading || permissoesCarregando) return;
    if (!user && location.pathname !== "/login") {
      window.location.replace(`/login?returnTo=${encodeURIComponent(location.pathname)}`);
      return;
    }
    if (user && (!isAllowed(user) || !temPermissaoModulo)) {
      window.location.replace("/dashboard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, permissoesCarregando, location.pathname, roles, user, temPermissaoModulo]);

  if (isLoading || permissoesCarregando) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (!isAllowed(user) || !temPermissaoModulo) {
    return null;
  }

  return <>{children}</>;
}
