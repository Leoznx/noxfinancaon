import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { AuthProvider } from "@/components/AuthProvider";
import { Toaster } from "@/components/ui/sonner";
import { hasAuthEmailCallback, parseAuthEmailCallback } from "@/lib/auth-email-links";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "NOX Fiança — Seguro Fiança Digital sem Fiador" },
      {
        name: "description",
        content:
          "Aluguel sem fiador, sem caução e sem burocracia. A NOX é o seguro fiança digital com aprovação em até 1 minuto. Camboriú, Balneário Camboriú e todo Santa Catarina.",
      },
      {
        name: "keywords",
        content:
          "seguro fiança, fiança aluguel, aluguel sem fiador, garantia locatícia, fiança digital, Camboriú, Santa Catarina",
      },
      { name: "author", content: "NOX Fiança" },
      { name: "robots", content: "index, follow" },
      { name: "theme-color", content: "#0A0A0A" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "NOX Fiança" },
      { property: "og:title", content: "NOX Fiança — Seguro Fiança Digital sem Fiador" },
      {
        property: "og:description",
        content:
          "Aluguel sem fiador, sem caução e sem burocracia. Aprovação em até 1 minuto. 100% digital.",
      },
      { property: "og:url", content: "https://noxfianca.com" },
      { property: "og:image", content: "https://noxfianca.com/og-image.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "NOX Fiança — Aluguel sem fiador, sem caução." },
      { property: "og:locale", content: "pt_BR" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@NoxFianca" },
      { name: "twitter:title", content: "NOX Fiança — Seguro Fiança Digital sem Fiador" },
      {
        name: "twitter:description",
        content:
          "Aluguel sem fiador, sem caução e sem burocracia. Aprovação em até 1 minuto. 100% digital.",
      },
      { name: "twitter:image", content: "https://noxfianca.com/og-image.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" },
      { rel: "icon", type: "image/png", sizes: "512x512", href: "/favicon-512.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "preconnect", href: "https://images.unsplash.com", crossOrigin: "anonymous" },
      { rel: "dns-prefetch", href: "https://images.unsplash.com" },
      {
        rel: "preconnect",
        href: "https://njheoytyidsghittjilr.supabase.co",
        crossOrigin: "anonymous",
      },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "NOX Fiança",
          alternateName: "NOX",
          url: "https://noxfianca.com",
          logo: "https://noxfianca.com/favicon-512.png",
          image: "https://noxfianca.com/og-image.png",
          description:
            "Seguro fiança digital com aprovação em até 1 minuto. Aluguel sem fiador, sem caução, 100% online.",
          address: {
            "@type": "PostalAddress",
            addressLocality: "Camboriú",
            addressRegion: "SC",
            addressCountry: "BR",
          },
          areaServed: { "@type": "State", name: "Santa Catarina" },
          sameAs: [],
        }),
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  if (typeof window !== "undefined" && "scrollRestoration" in window.history) {
    window.history.scrollRestoration = "manual";
  }
  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Quando um link de e-mail (recuperação de senha, confirmação de cadastro, troca de
  // e-mail) expira ou já foi usado, o GoTrue do Supabase ignora o `redirect_to` original
  // e sempre volta pro Site URL configurado no painel — no nosso caso, a Home (`/`) —
  // anexando `#error=...&error_code=...` no hash. Sem isso, a Home simplesmente ignora
  // o hash e mostra a página normal, dando a impressão de que o link "só abriu o site".
  // Encaminha pra /redefinir-senha (preservando o hash) porque ela já trata exatamente
  // esse formato de erro e mostra "link inválido/expirado" com opção de solicitar um novo.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.pathname !== "/") return;
    const callback = parseAuthEmailCallback(window.location.href);
    if (!hasAuthEmailCallback(callback)) return;

    const destino =
      callback.type === "recovery" || !callback.type ? "/redefinir-senha" : "/email-verificado";
    window.location.replace(destino + window.location.search + window.location.hash);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Outlet />
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  );
}
