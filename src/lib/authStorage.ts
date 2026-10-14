// Controla se a sessão do Supabase Auth (o token, nunca a senha) persiste entre
// aberturas do navegador ("Manter-se conectado") ou só dura a aba/sessão atual.
// Um único client Supabase continua existindo — em vez de dois clients concorrentes
// com storages fixos, o próprio adapter de storage passado ao client decide, a cada
// leitura/escrita, se usa localStorage ou sessionStorage, olhando essa preferência.
const REMEMBER_KEY = "nox_remember_me";
const DEMO_SESSION_KEY = "nox_demo_session";
const CACHED_USER_KEY = "nox_user";

function usesDemoSessionStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(window.sessionStorage.getItem(DEMO_SESSION_KEY));
  } catch {
    return false;
  }
}

// A preferência em si é só um booleano, não um segredo — sempre em localStorage pra
// sobreviver ao fechamento do navegador (é o que permite saber, na próxima visita, se
// deve ou não tentar restaurar a sessão de localStorage).
export function getRememberMe(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(REMEMBER_KEY);
    return raw === null ? true : raw === "1";
  } catch {
    return true;
  }
}

export function setRememberMe(remember: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
  } catch {}

  if (usesDemoSessionStorage()) return;
  const source = remember ? window.sessionStorage : window.localStorage;
  const target = remember ? window.localStorage : window.sessionStorage;
  moveAuthState(source, target);
}

export function getPreferredStorage(): Storage {
  if (usesDemoSessionStorage()) return window.sessionStorage;
  return getRememberMe() ? window.localStorage : window.sessionStorage;
}

function otherStorage(): Storage {
  return getRememberMe() ? window.sessionStorage : window.localStorage;
}

/**
 * Adapter compatível com a opção `auth.storage` do supabase-js. Cada leitura/escrita
 * consulta a preferência atual e usa o storage correspondente; ao escrever, remove a
 * mesma chave do storage "não escolhido" pra nunca deixar duas sessões (uma em cada
 * armazenamento) vivas e conflitantes ao mesmo tempo.
 */
export const dynamicAuthStorage = {
  getItem(key: string) {
    if (usesDemoSessionStorage()) {
      try {
        return window.sessionStorage.getItem(key);
      } catch {
        return null;
      }
    }

    try {
      const preferred = getPreferredStorage();
      const value = preferred.getItem(key);
      if (value !== null) return value;

      // Recupera sessões que versões anteriores gravaram no sessionStorage mesmo
      // com "Lembrar de mim" marcado. A cópia só acontece no sentido persistente;
      // quando a preferência é temporária nunca restauramos dados do localStorage.
      if (getRememberMe() && isAuthStateKey(key)) {
        const temporaryValue = window.sessionStorage.getItem(key);
        if (temporaryValue !== null) {
          try {
            window.localStorage.setItem(key, temporaryValue);
            window.sessionStorage.removeItem(key);
          } catch {}
          return temporaryValue;
        }
      }
      return null;
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string) {
    if (usesDemoSessionStorage()) {
      try {
        window.sessionStorage.setItem(key, value);
      } catch {}
      return;
    }
    let stored = false;
    try {
      getPreferredStorage().setItem(key, value);
      stored = true;
    } catch {}
    // Nunca apaga a única cópia existente antes de confirmar a nova gravação.
    if (stored) {
      try {
        otherStorage().removeItem(key);
      } catch {}
    }
  },
  removeItem(key: string) {
    if (usesDemoSessionStorage()) {
      try {
        window.sessionStorage.removeItem(key);
      } catch {}
      return;
    }
    try {
      window.localStorage.removeItem(key);
    } catch {}
    try {
      window.sessionStorage.removeItem(key);
    } catch {}
  },
};

function isSupabaseAuthTokenKey(key: string | null): boolean {
  return !!key && key.startsWith("sb-") && key.includes("-auth-token");
}

function isAuthStateKey(key: string | null): boolean {
  return key === CACHED_USER_KEY || isSupabaseAuthTokenKey(key);
}

function moveAuthState(source: Storage, target: Storage): void {
  const entries: Array<[string, string]> = [];
  try {
    for (let index = 0; index < source.length; index += 1) {
      const key = source.key(index);
      if (!isAuthStateKey(key)) continue;
      const value = source.getItem(key as string);
      if (value !== null) entries.push([key as string, value]);
    }
  } catch {
    return;
  }

  for (const [key, value] of entries) {
    try {
      target.setItem(key, value);
      source.removeItem(key);
    } catch {
      // Mantém a cópia de origem quando o armazenamento de destino está bloqueado.
    }
  }
}

/** Limpa apenas o cache visual; preserva a sessão Supabase para nova tentativa. */
export function clearCachedAuthUserFromBothStorages(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CACHED_USER_KEY);
  } catch {}
  try {
    window.sessionStorage.removeItem(CACHED_USER_KEY);
  } catch {}
}

/** Limpa qualquer token de sessão do Supabase dos dois storages — usado no logout. */
export function clearAuthTokensFromBothStorages(): void {
  if (typeof window === "undefined") return;
  const storages = usesDemoSessionStorage()
    ? [window.sessionStorage]
    : [window.localStorage, window.sessionStorage];
  for (const storage of storages) {
    try {
      for (let i = storage.length - 1; i >= 0; i -= 1) {
        const key = storage.key(i);
        if (isSupabaseAuthTokenKey(key)) storage.removeItem(key as string);
      }
    } catch {}
  }
}
