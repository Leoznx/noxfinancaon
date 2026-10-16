import * as React from "react";
import { useRouterState } from "@tanstack/react-router";

import { LoadingTokenRegistry } from "@/lib/global-loading";

type GlobalLoadingContextValue = {
  beginEssentialLoad: () => number;
  endEssentialLoad: (token: number) => void;
  beginDashboardScope: () => number;
  endDashboardScope: (token: number) => void;
};

const GlobalLoadingContext = React.createContext<GlobalLoadingContextValue | null>(null);
const SHOW_DELAY_MS = 180;

export function GlobalLoadingProvider({ children }: { children: React.ReactNode }) {
  const routerLoading = useRouterState({ select: (state) => state.isLoading });
  const registryRef = React.useRef(new LoadingTokenRegistry());
  const dashboardScopeRegistryRef = React.useRef(new LoadingTokenRegistry());
  const [essentialLoadCount, setEssentialLoadCount] = React.useState(0);
  const [dashboardScopeCount, setDashboardScopeCount] = React.useState(0);

  const beginEssentialLoad = React.useCallback(() => {
    const token = registryRef.current.begin();
    setEssentialLoadCount(registryRef.current.size);
    return token;
  }, []);

  const endEssentialLoad = React.useCallback((token: number) => {
    if (!registryRef.current.end(token)) return;
    setEssentialLoadCount(registryRef.current.size);
  }, []);

  const beginDashboardScope = React.useCallback(() => {
    const token = dashboardScopeRegistryRef.current.begin();
    setDashboardScopeCount(dashboardScopeRegistryRef.current.size);
    return token;
  }, []);

  const endDashboardScope = React.useCallback((token: number) => {
    if (!dashboardScopeRegistryRef.current.end(token)) return;
    setDashboardScopeCount(dashboardScopeRegistryRef.current.size);
  }, []);

  const context = React.useMemo(
    () => ({ beginEssentialLoad, endEssentialLoad, beginDashboardScope, endDashboardScope }),
    [beginDashboardScope, beginEssentialLoad, endDashboardScope, endEssentialLoad],
  );
  const active = dashboardScopeCount > 0 && (routerLoading || essentialLoadCount > 0);

  return (
    <GlobalLoadingContext.Provider value={context}>
      {children}
      <GlobalLoadingIndicator active={active} />
    </GlobalLoadingContext.Provider>
  );
}

/** Registers only content that is essential for the first useful render. */
// eslint-disable-next-line react-refresh/only-export-components
export function useEssentialLoading(active: boolean) {
  const context = React.useContext(GlobalLoadingContext);

  React.useEffect(() => {
    if (!active || !context) return;
    const token = context.beginEssentialLoad();
    return () => context.endEssentialLoad(token);
  }, [active, context]);
}

/** Enables the global loader only while an authenticated dashboard surface is mounted. */
// eslint-disable-next-line react-refresh/only-export-components
export function useDashboardLoadingScope() {
  const context = React.useContext(GlobalLoadingContext);

  React.useEffect(() => {
    if (!context) return;
    const token = context.beginDashboardScope();
    return () => context.endDashboardScope(token);
  }, [context]);
}

function GlobalLoadingIndicator({ active }: { active: boolean }) {
  const [rendered, setRendered] = React.useState(false);

  React.useEffect(() => {
    if (!active) {
      setRendered(false);
      return;
    }

    const timer = window.setTimeout(() => setRendered(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [active]);

  if (!rendered) return null;

  return (
    <div
      className="nox-global-loading"
      role="status"
      aria-live="polite"
      aria-label="Atualizando conteúdo"
    >
      <span className="nox-global-loading__dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}
