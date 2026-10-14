import * as React from "react";
import { useRouterState } from "@tanstack/react-router";

import { GLOBAL_LOADING_TIMEOUT_MS, LoadingTokenRegistry } from "@/lib/global-loading";

type GlobalLoadingContextValue = {
  beginEssentialLoad: () => number;
  endEssentialLoad: (token: number) => void;
  beginDashboardScope: () => number;
  endDashboardScope: (token: number) => void;
};

const GlobalLoadingContext = React.createContext<GlobalLoadingContextValue | null>(null);
const FADE_OUT_MS = 80;
const SHOW_DELAY_MS = 90;

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
      <GlobalLoadingOverlay active={active} />
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

function GlobalLoadingOverlay({ active }: { active: boolean }) {
  const [rendered, setRendered] = React.useState(active);
  const [exiting, setExiting] = React.useState(false);
  const [timedOut, setTimedOut] = React.useState(false);
  const [videoFailed, setVideoFailed] = React.useState(false);

  React.useEffect(() => {
    if (active) {
      if (rendered) {
        setExiting(false);
        return;
      }

      const timer = window.setTimeout(() => {
        setRendered(true);
        setExiting(false);
      }, SHOW_DELAY_MS);
      return () => window.clearTimeout(timer);
    }

    if (!rendered) return;
    setExiting(true);
    const timer = window.setTimeout(() => {
      setRendered(false);
      setExiting(false);
    }, FADE_OUT_MS);
    return () => window.clearTimeout(timer);
  }, [active, rendered]);

  React.useEffect(() => {
    if (!active) {
      setTimedOut(false);
      return;
    }

    const timer = window.setTimeout(() => setTimedOut(true), GLOBAL_LOADING_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [active]);

  React.useLayoutEffect(() => {
    const shouldLock = (active && rendered) || timedOut;
    document.documentElement.classList.toggle("nox-loading-locked", shouldLock);
    document.body.classList.toggle("nox-loading-locked", shouldLock);
    return () => {
      document.documentElement.classList.remove("nox-loading-locked");
      document.body.classList.remove("nox-loading-locked");
    };
  }, [active, rendered, timedOut]);

  if (!rendered && !timedOut) return null;

  return (
    <div
      className={`nox-global-loading${exiting && !timedOut ? " nox-global-loading--exiting" : ""}`}
      role={timedOut ? "alert" : "status"}
      aria-live="polite"
      aria-label={timedOut ? "Falha ao carregar a página" : "Carregando página"}
    >
      {timedOut ? (
        <div className="nox-global-loading__error">
          <strong>Não foi possível carregar esta página.</strong>
          <span>Verifique sua conexão e tente novamente.</span>
          <button type="button" onClick={() => window.location.reload()}>
            Tentar novamente
          </button>
        </div>
      ) : (
        <div className="nox-global-loading__indicator" aria-hidden="true">
          <div className="nox-global-loading__media">
            {!videoFailed ? (
              <video
                className="nox-global-loading__video"
                src="/media/nox-loading-ping-pong.mp4"
                poster="/media/nox-loading-static.png"
                autoPlay
                muted
                loop
                playsInline
                preload="auto"
                disablePictureInPicture
                controlsList="nodownload noplaybackrate noremoteplayback"
                onError={() => setVideoFailed(true)}
              />
            ) : null}
            <img
              className={`nox-global-loading__static${videoFailed ? " nox-global-loading__static--visible" : ""}`}
              src="/media/nox-loading-static.png"
              alt=""
            />
          </div>
          <span className="nox-global-loading__dots">
            <i />
            <i />
            <i />
          </span>
        </div>
      )}
    </div>
  );
}
