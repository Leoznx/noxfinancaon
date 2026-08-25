import type { DemoProfileKey } from "@/lib/demo-accounts";

const DEMO_SESSION_KEY = "nox_demo_session";

export function activateDemoSession(profile: DemoProfileKey): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(DEMO_SESSION_KEY, profile);
}

export function clearDemoSession(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(DEMO_SESSION_KEY);
}

export function isDemoSession(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.sessionStorage.getItem(DEMO_SESSION_KEY));
}

export function getDemoSessionProfile(): DemoProfileKey | null {
  if (typeof window === "undefined") return null;
  const value = window.sessionStorage.getItem(DEMO_SESSION_KEY);
  return value === "proprietario" ||
    value === "corretor" ||
    value === "imobiliaria" ||
    value === "inquilino"
    ? value
    : null;
}
