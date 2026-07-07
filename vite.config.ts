// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only),
//     componentTagger (dev-only, never runs in production builds), VITE_* env injection,
//     @ path alias, React/TanStack dedupe, error logger plugins, and sandbox detection
//     (port/host/strictPort) used only inside Lovable's own cloud editor.
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
export default defineConfig({
  tanstackStart: {
    router: { autoCodeSplitting: true },
    server: { entry: "server" },
  },
  // Deploy target: Vercel (Nitro's "vercel" preset emits Vercel's Build Output API v3 format
  // under .vercel/output). Only affects real builds — Lovable's own cloud editor forces
  // "cloudflare-module" for its own preview regardless of this setting (see isSandbox in
  // @lovable.dev/vite-tanstack-config), so this doesn't affect editing inside Lovable.
  nitro: { preset: "vercel" },
});
