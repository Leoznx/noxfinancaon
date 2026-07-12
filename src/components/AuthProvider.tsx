import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { setCachedHeaderProfile } from "@/lib/profile-cache";
import { getPreferredStorage, clearAuthTokensFromBothStorages } from "@/lib/authStorage";

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
  id: string;
  email: string;
  role: Role;
  internalRole?: InternalRole | null;
}

interface AuthContextType {
  user: User | null;
  login: (email: string, role: Role, id: string) => void;
  logout: () => Promise<void>;
  isLoading: boolean;
  hasInternalRole: (...roles: InternalRole[]) => boolean;
  isInternal: () => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const LOGOUT_IN_PROGRESS_KEY = "nox_logout_in_progress";

function clearStoredAuth() {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem("nox_user");
    window.sessionStorage.removeItem("nox_user");
  } catch {}
  clearAuthTokensFromBothStorages();
}

function clearLogoutMarker() {
  try {
    window.sessionStorage.removeItem(LOGOUT_IN_PROGRESS_KEY);
  } catch {}
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const isLoggingOutRef = useRef(false);
  const authVersionRef = useRef(0);

  useEffect(() => {
    try {
      isLoggingOutRef.current = sessionStorage.getItem(LOGOUT_IN_PROGRESS_KEY) === "1";
    } catch {}

    if (isLoggingOutRef.current) {
      clearStoredAuth();
      clearLogoutMarker();
      setUser(null);
      setIsLoading(false);
      return;
    }

    try {
      const savedUser = getPreferredStorage().getItem("nox_user");
      if (savedUser) {
        const parsed = JSON.parse(savedUser);
        if (parsed && typeof parsed === "object" && parsed.id && parsed.email && parsed.role) {
          setUser({ id: parsed.id, email: parsed.email, role: parsed.role, internalRole: parsed.internalRole ?? null });
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
        if (isLoggingOutRef.current) return;
        const syncVersion = authVersionRef.current;
        try {
          const { data: profile } = await supabase
            .from("profiles")
            .select("role,nome,avatar_url")
            .eq("id", userId)
            .maybeSingle();
          if (!active || isLoggingOutRef.current || syncVersion !== authVersionRef.current) return;
          const role = (profile as any)?.role as Role | undefined;
          if (!role) return; // profile ainda não existe (ex.: trigger em voo) — não força estado incompleto
          setCachedHeaderProfile({
            email,
            nome: (profile as any)?.nome || authUser?.user_metadata?.nome || authUser?.user_metadata?.full_name || null,
            avatarUrl: (profile as any)?.avatar_url || null,
          });
          login(email, role, userId);

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
      if (active && !isLoggingOutRef.current && session?.user?.email) {
        await syncFromSession(session.user.id, session.user.email);
      }

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((event, newSession) => {
        if (event === "SIGNED_OUT") {
          authVersionRef.current += 1;
          setUser(null);
          clearStoredAuth();
        } else if (!isLoggingOutRef.current && event === "SIGNED_IN" && newSession?.user?.email) {
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
    // Antes, quando profiles.role já era um nome de cargo interno (ex.: 'suporte'),
    // isso retornava direto sem nunca consultar internal_users — trocar o cargo ou
    // bloquear alguém pela aba Colaboradores não tinha efeito nenhum na prática,
    // já que internal_users passou a ser a fonte editável de verdade pro cargo/
    // status, e profiles.role é só o valor histórico do cadastro. Agora sempre
    // confere internal_users primeiro; só cai pro valor de profiles.role quando
    // não existe nenhuma linha lá (edge case legado).
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        return INTERNAL_ROLES.includes(role as InternalRole) ? (role as InternalRole) : null;
      }
      const { data } = await supabase
        .from("internal_users" as any)
        .select("role,status")
        .eq("auth_user_id", authUser.id)
        .maybeSingle();
      if (data) {
        return (data as any).status === "ativo" ? ((data as any).role as InternalRole) : null;
      }
      return INTERNAL_ROLES.includes(role as InternalRole) ? (role as InternalRole) : null;
    } catch (e) {
      console.warn("[Auth] resolveInternalRole failed", e);
      return INTERNAL_ROLES.includes(role as InternalRole) ? (role as InternalRole) : null;
    }
  };

  const login = (email: string, role: Role, id: string) => {
    isLoggingOutRef.current = false;
    authVersionRef.current += 1;
    const loginVersion = authVersionRef.current;
    clearLogoutMarker();

    const baseUser: User = { id, email, role, internalRole: null };
    setUser(baseUser);
    try { getPreferredStorage().setItem("nox_user", JSON.stringify(baseUser)); } catch {}
    // Only attempt to enrich for users that could be internal
    resolveInternalRole(role).then((internalRole) => {
      if (isLoggingOutRef.current || loginVersion !== authVersionRef.current) return;
      if (!internalRole) return; // keep base user — don't break external profiles
      const enriched: User = { id, email, role, internalRole };
      setUser(enriched);
      try { getPreferredStorage().setItem("nox_user", JSON.stringify(enriched)); } catch {}
    }).catch((e) => console.warn("[Auth] enrich failed", e));
  };

  const logout = async () => {
    isLoggingOutRef.current = true;
    authVersionRef.current += 1;
    setUser(null);
    try {
      sessionStorage.setItem(LOGOUT_IN_PROGRESS_KEY, "1");
    } catch {}
    try {
      localStorage.removeItem("nox_user");
    } catch {}

    try {
      const { supabase } = await import("@/integrations/supabase/client");
      await supabase.auth.signOut();
    } catch {
      clearStoredAuth();
    } finally {
      clearStoredAuth();
      clearLogoutMarker();
    }
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
