import type { ReactNode } from "react";

export function GlobalLoadingProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

// As telas preservam seus carregamentos locais sem o indicador flutuante.
// eslint-disable-next-line react-refresh/only-export-components
export function useEssentialLoading(active: boolean) {
  void active;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDashboardLoadingScope() {}
