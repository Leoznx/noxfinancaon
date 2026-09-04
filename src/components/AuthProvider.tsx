import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { setCachedHeaderProfile } from "@/lib/profile-cache";
import { getPreferredStorage, clearAuthTokensFromBothStorages } from "@/lib/authStorage";
import { clearDemoSession, isDemoSession } from "@/lib/demo-session";

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
  "admin_master" | "juridico" | "financeiro" | "marketing" | "suporte" | "vendedor";
export type SellerType = "sdr" | "closer";

const INTERNAL_ROLES: InternalRole[] = [
  "admin_master",
  "juridico",
  "financeiro",
  "marketing",
  "suporte",
  "vendedor",
];

const PERMISSION_GATED_INTERNAL_ROLES = new Set<InternalRole>([
  "juridico",
  "financeiro",
  "marketing",
  "suporte",
  "vendedor",
]);

interface User {
  id: string;
  email: string;
  role: Role;
  internalRole?: InternalRole | null;
  sellerType?: SellerType | null;
}

interface AuthContextType {
  user: User | null;
  login: (
    email: string,
    role: Role,
    id: string,
    internalRoleHint?: InternalRole | null,
    sellerTypeHint?: SellerType | null,
  ) => void;
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
    if (isDemoSession()) window.sessionStorage.removeItem("nox_user");
    else {
      window.localStorage.removeItem("nox_user");
      window.sessionStorage.removeItem("nox_user");
    }
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
    // O portal demonstrativo é deliberadamente isolado: ele não restaura a
    // sessão real do vendedor e não inicializa o client do Supabase. Além de
    // impedir qualquer chamada de produção, isso mantém a aba demo independente
    // mesmo quando o vendedor escolheu uma sessão restrita à aba original.
    if (window.location.pathname.startsWith("/demo/")) {
      setUser(null);
      setIsLoading(false);
      return;
    }

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
          const cachedUser: User = {
            id: parsed.id,
            email: parsed.email,
            role: parsed.role,
            internalRole: parsed.internalRole ?? null,
            sellerType: parsed.sellerType ?? null,
          };
          // Começa a buscar as permissões junto com a restauração da sessão. Na
          // prática, o menu já está pronto quando a rota protegida é liberada.
          if (
            cachedUser.internalRole &&
            PERMISSION_GATED_INTERNAL_ROLES.has(cachedUser.internalRole)
          ) {
            void import("@/lib/permissoes-cache").then(({ loadPermissoesCargo }) =>
              loadPermissoesCargo(cachedUser.internalRole!),
            );
          }
          setUser(cachedUser);
        }
      }
    } catch (e) {
      console.warn("[Auth] failed to parse saved user", e);
    }
    // O usuario salvo e apenas cache visual. As rotas protegidas continuam
    // bloqueadas ate a sessao real do Supabase ser confirmada abaixo.
  }, []);

  // Reconcilia com a sessão REAL do Supabase (além do "nox_user" no localStorage acima).
  // Necessário para os casos em que o app nunca chamou login() explicitamente mas já existe
  // uma sessão válida — ex.: o usuário confirma o e-mail de cadastro e volta pra Home com a
  // sessão só na URL/no client do Supabase, ou o token é revogado/expira em outra aba.
  useEffect(() => {
    if (window.location.pathname.startsWith("/demo/")) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    let active = true;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      const { supabase } = await import("@/integrations/supabase/client");

      const syncFromSession = async (
        userId: string,
        email: string,
        authUser?: any,
        isFreshSignIn?: boolean,
      ) => {
        if (isLoggingOutRef.current) return false;
        const syncVersion = authVersionRef.current;
        try {
          const [profileResult, internalUserResult] = await Promise.all([
            supabase
              .from("profiles")
              .select("role,nome,avatar_url")
              .eq("id", userId)
              .maybeSingle(),
            supabase
              .from("internal_users" as any)
              .select("role,status,seller_type")
              .eq("auth_user_id", userId)
              .maybeSingle(),
          ]);
          const { data: profile, error: profileError } = profileResult;
          if (profileError) throw profileError;
          if (!active || isLoggingOutRef.current || syncVersion !== authVersionRef.current)
            return false;
          const role = (profile as any)?.role as Role | undefined;
          if (!role) return; // profile ainda não existe (ex.: trigger em voo) — não força estado incompleto
          const internalUser = internalUserResult.data as
            | { role?: string | null; status?: string | null; seller_type?: string | null }
            | null;
          const internalRole = internalUser
            ? internalUser.status === "ativo" &&
              INTERNAL_ROLES.includes(internalUser.role as InternalRole)
              ? (internalUser.role as InternalRole)
              : null
            : INTERNAL_ROLES.includes(role as InternalRole)
              ? (role as InternalRole)
              : null;

          if (internalRole && PERMISSION_GATED_INTERNAL_ROLES.has(internalRole)) {
            const { loadPermissoesCargo } = await import("@/lib/permissoes-cache");
            await loadPermissoesCargo(internalRole);
            if (!active || isLoggingOutRef.current || syncVersion !== authVersionRef.current) {
              return false;
            }
          }
          setCachedHeaderProfile({
            email,
            nome:
              (profile as any)?.nome ||
              authUser?.user_metadata?.nome ||
              authUser?.user_metadata?.full_name ||
              null,
            avatarUrl: (profile as any)?.avatar_url || null,
          });
          // A rota protegida só é liberada depois que o cargo interno já está
          // resolvido. Assim /dashboard nunca monta o painel genérico antes do
          // painel específico de Jurídico, Financeiro, Marketing ou Vendedor.
          const sellerType = ["sdr", "closer"].includes(internalUser?.seller_type || "")
            ? (internalUser!.seller_type as SellerType)
            : null;
          login(email, role, userId, internalRole, sellerType);

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
          return true;
        } catch (e) {
          console.warn("[Auth] syncFromSession failed", e);
          return false;
        }
      };

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!active) return;

      if (!isLoggingOutRef.current && session?.user?.email) {
        const synced = await syncFromSession(session.user.id, session.user.email, session.user);
        if (!active || isLoggingOutRef.current) return;
        if (!synced) {
          await supabase.auth.signOut({ scope: "local" });
          setUser(null);
          clearStoredAuth();
        }
      } else if (!isLoggingOutRef.current) {
        authVersionRef.current += 1;
        setUser(null);
        clearStoredAuth();
      }

      if (active) setIsLoading(false);

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((event, newSession) => {
        if (event === "SIGNED_OUT") {
          authVersionRef.current += 1;
          setUser(null);
          clearStoredAuth();
          setIsLoading(false);
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

  const resolveInternalIdentity = async (
    role: Role,
    userId: string,
  ): Promise<{ internalRole: InternalRole | null; sellerType: SellerType | null }> => {
    // Antes, quando profiles.role já era um nome de cargo interno (ex.: 'suporte'),
    // isso retornava direto sem nunca consultar internal_users — trocar o cargo ou
    // bloquear alguém pela aba Colaboradores não tinha efeito nenhum na prática,
    // já que internal_users passou a ser a fonte editável de verdade pro cargo/
    // status, e profiles.role é só o valor histórico do cadastro. Agora sempre
    // confere internal_users primeiro; só cai pro valor de profiles.role quando
    // não existe nenhuma linha lá (edge case legado).
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase
        .from("internal_users" as any)
        .select("role,status,seller_type")
        .eq("auth_user_id", userId)
        .maybeSingle();
      if (data) {
        return {
          internalRole:
            (data as any).status === "ativo" ? ((data as any).role as InternalRole) : null,
          sellerType:
            (data as any).status === "ativo" && ["sdr", "closer"].includes((data as any).seller_type)
              ? ((data as any).seller_type as SellerType)
              : null,
        };
      }
      return {
        internalRole: INTERNAL_ROLES.includes(role as InternalRole) ? (role as InternalRole) : null,
        sellerType: null,
      };
    } catch (e) {
      console.warn("[Auth] resolveInternalRole failed", e);
      return {
        internalRole: INTERNAL_ROLES.includes(role as InternalRole) ? (role as InternalRole) : null,
        sellerType: null,
      };
    }
  };

  const login = (
    email: string,
    role: Role,
    id: string,
    internalRoleHint?: InternalRole | null,
    sellerTypeHint?: SellerType | null,
  ) => {
    isLoggingOutRef.current = false;
    authVersionRef.current += 1;
    const loginVersion = authVersionRef.current;
    clearLogoutMarker();

    const immediateInternalRole =
      internalRoleHint !== undefined
        ? internalRoleHint
        : INTERNAL_ROLES.includes(role as InternalRole)
          ? (role as InternalRole)
          : null;
    const baseUser: User = {
      id,
      email,
      role,
      internalRole: immediateInternalRole,
      sellerType: sellerTypeHint ?? null,
    };
    setUser(baseUser);
    try {
      getPreferredStorage().setItem("nox_user", JSON.stringify(baseUser));
    } catch {}
    // Quando o chamador já consultou internal_users, o estado acima é definitivo
    // e não precisa de um segundo roundtrip. Chamadas legadas ainda são enriquecidas.
    if (internalRoleHint !== undefined && sellerTypeHint !== undefined) return;
    resolveInternalIdentity(role, id)
      .then(({ internalRole, sellerType }) => {
        if (isLoggingOutRef.current || loginVersion !== authVersionRef.current) return;
        const enriched: User = { id, email, role, internalRole, sellerType };
        setUser(enriched);
        try {
          getPreferredStorage().setItem("nox_user", JSON.stringify(enriched));
        } catch {}
      })
      .catch((e) => console.warn("[Auth] enrich failed", e));
  };

  const logout = async () => {
    const wasDemo = isDemoSession();
    isLoggingOutRef.current = true;
    authVersionRef.current += 1;
    setUser(null);
    try {
      sessionStorage.setItem(LOGOUT_IN_PROGRESS_KEY, "1");
    } catch {}
    try {
      if (wasDemo) sessionStorage.removeItem("nox_user");
      else localStorage.removeItem("nox_user");
    } catch {}

    try {
      const { supabase } = await import("@/integrations/supabase/client");
      await supabase.auth.signOut(wasDemo ? { scope: "local" } : undefined);
    } catch {
      clearStoredAuth();
    } finally {
      clearStoredAuth();
      clearLogoutMarker();
      if (wasDemo) clearDemoSession();
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
