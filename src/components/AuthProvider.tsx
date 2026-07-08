import React, { createContext, useContext, useState, useEffect } from "react";

export type Role =
  | "admin"
  | "analista"
  | "corretor"
  | "imobiliaria"
  | "proprietario"
  | "inquilino"
  | "financeiro"
  | "comercial"
  | "admin_master"
  | "juridico"
  | "marketing"
  | "suporte"
  | "vendedor";

export type InternalRole =
  | "admin_master"
  | "juridico"
  | "financeiro"
  | "marketing"
  | "suporte"
  | "vendedor";

const INTERNAL_ROLES: InternalRole[] = [
  "admin_master",
  "juridico",
  "financeiro",
  "marketing",
  "suporte",
  "vendedor",
];

interface User {
  email: string;
  role: Role;
  internalRole?: InternalRole | null;
}

interface AuthContextType {
  user: User | null;
  login: (email: string, role: Role) => void;
  logout: () => void;
  isLoading: boolean;
  hasInternalRole: (...roles: InternalRole[]) => boolean;
  isInternal: () => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      const savedUser = localStorage.getItem("nox_user");
      if (savedUser) {
        const parsed = JSON.parse(savedUser);
        if (parsed && typeof parsed === "object" && parsed.email && parsed.role) {
          setUser({ email: parsed.email, role: parsed.role, internalRole: parsed.internalRole ?? null });
        }
      }
    } catch (e) {
      console.warn("[Auth] failed to parse saved user", e);
    }
    setIsLoading(false);
  }, []);

  // Reconcilia com a sessão REAL do Supabase (além do "nox_user" no localStorage acima).
  // Necessário para os casos em que o app nunca chamou login() explicitamente mas já existe
  // uma sessão válida — ex.: o usuário confirma o e-mail de cadastro e volta pra Home com a
  // sessão só na URL/no client do Supabase, ou o token é revogado/expira em outra aba.
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      const { supabase } = await import("@/integrations/supabase/client");

      const syncFromSession = async (userId: string, email: string, authUser?: any, isFreshSignIn?: boolean) => {
        try {
          const { data: profile } = await supabase
            .from("profiles")
            .select("role")
            .eq("id", userId)
            .maybeSingle();
          if (!active) return;
          const role = (profile as any)?.role as Role | undefined;
          if (!role) return; // profile ainda não existe (ex.: trigger em voo) — não força estado incompleto
          login(email, role);

          // Só na hora do SIGNED_IN de verdade (ex.: acabou de confirmar o e-mail do
          // cadastro) — não no getSession() passivo de todo carregamento de página —
          // finaliza o que o cadastro.tsx não conseguiu fazer sem sessão ativa: vincular
          // contratos por CPF e gravar o telefone (bloqueados por RLS no signUp, já que
          // não há sessão até o e-mail ser confirmado).
          const cpf = authUser?.user_metadata?.cpf as string | undefined;
          if (isFreshSignIn && role === "inquilino" && cpf) {
            import("@/lib/inquilino-signup.functions")
              .then(({ linkTenantByCpf }) =>
                (linkTenantByCpf as any)({
                  data: { cpf, telefone: authUser.user_metadata.telefone },
                }),
              )
              .catch((e) => console.warn("[Auth] finalizar cadastro inquilino falhou", e));
          }
        } catch (e) {
          console.warn("[Auth] syncFromSession failed", e);
        }
      };

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (active && session?.user?.email) {
        await syncFromSession(session.user.id, session.user.email);
      }

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((event, newSession) => {
        if (event === "SIGNED_OUT") {
          setUser(null);
          try {
            localStorage.removeItem("nox_user");
          } catch {}
        } else if (event === "SIGNED_IN" && newSession?.user?.email) {
          syncFromSession(newSession.user.id, newSession.user.email, newSession.user, true);
        }
      });

      if (active) unsubscribe = () => subscription.unsubscribe();
      else subscription.unsubscribe();
    })();

    return () => {
      active = false;
      unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolveInternalRole = async (role: Role): Promise<InternalRole | null> => {
    if (INTERNAL_ROLES.includes(role as InternalRole)) {
      return role as InternalRole;
    }
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) return null;
      const { data } = await supabase
        .from("internal_users" as any)
        .select("role,status")
        .eq("auth_user_id", authUser.id)
        .eq("status", "ativo")
        .maybeSingle();
      return ((data as any)?.role as InternalRole) ?? null;
    } catch (e) {
      console.warn("[Auth] resolveInternalRole failed", e);
      return null;
    }
  };

  const login = (email: string, role: Role) => {
    const baseUser: User = { email, role, internalRole: null };
    setUser(baseUser);
    try { localStorage.setItem("nox_user", JSON.stringify(baseUser)); } catch {}
    // Only attempt to enrich for users that could be internal
    resolveInternalRole(role).then((internalRole) => {
      if (!internalRole) return; // keep base user — don't break external profiles
      const enriched: User = { email, role, internalRole };
      setUser(enriched);
      try { localStorage.setItem("nox_user", JSON.stringify(enriched)); } catch {}
    }).catch((e) => console.warn("[Auth] enrich failed", e));
  };

  const logout = () => {
    setUser(null);
    try { localStorage.removeItem("nox_user"); } catch {}
    import("@/integrations/supabase/client")
      .then(({ supabase }) => supabase.auth.signOut())
      .catch(() => {});
  };

  const hasInternalRole = (...roles: InternalRole[]) => {
    const ir = user?.internalRole;
    if (!ir) return false;
    return roles.includes(ir);
  };

  const isInternal = () => Boolean(user?.internalRole);

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading, hasInternalRole, isInternal }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
