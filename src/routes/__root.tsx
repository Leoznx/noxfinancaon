import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useNavigate,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { GlobalLoadingProvider } from "@/components/GlobalLoading";
import { Toaster } from "@/components/ui/sonner";
import { hasAuthEmailCallback, parseAuthEmailCallback } from "@/lib/auth-email-links";
import {
  isRecoverableNavigationError,
  reloadCurrentDocumentForNavigationError,
} from "@/lib/navigation-recovery";
import { GOOGLE_ADS_TAG_ID, META_PIXEL_ID, trackPageView } from "@/lib/tracking";
import { ROTA_CADASTRO_CONCLUIDO, precisaMostrarCadastroConcluido } from "@/lib/primeiroAcesso";

import appCss from "../styles.css?url";

const SITE_TITLE = "NOX FIANÇA";
const SOCIAL_SHARE_IMAGE = "https://noxfianca.com/nox-financa-whatsapp-2026-v2.png";

// Executa antes do bundle de hidratação. Algumas TVs AOSP mantêm WebViews que
// entendem ES2017, mas ainda não oferecem APIs usadas pelos chunks compartilhados.
// O conteúdo injetado abaixo é deliberadamente ES5 para que o próprio polyfill
// também seja interpretado nesses aparelhos.
const LEGACY_BROWSER_POLYFILLS = `
(function (root) {
  "use strict";

  function define(target, name, value) {
    try {
      Object.defineProperty(target, name, {
        configurable: true,
        writable: true,
        value: value
      });
    } catch (error) {
      target[name] = value;
    }
  }

  if (typeof root.globalThis === "undefined") {
    root.globalThis = root;
  }

  if (typeof Object.hasOwn !== "function") {
    define(Object, "hasOwn", function (object, property) {
      return Object.prototype.hasOwnProperty.call(Object(object), property);
    });
  }

  if (typeof String.prototype.replaceAll !== "function") {
    define(String.prototype, "replaceAll", function (search, replacement) {
      var input = String(this);
      if (search && Object.prototype.toString.call(search) === "[object RegExp]") {
        if (!search.global) {
          throw new TypeError("replaceAll exige uma expressão regular global");
        }
        return input.replace(search, replacement);
      }

      var source = String(search);
      var special = "\\\\^$.*+?()[]{}|";
      var escaped = "";
      var index;
      for (index = 0; index < source.length; index += 1) {
        escaped += special.indexOf(source.charAt(index)) >= 0
          ? "\\\\" + source.charAt(index)
          : source.charAt(index);
      }
      return input.replace(new RegExp(escaped, "g"), replacement);
    });
  }

  if (typeof Array.prototype.at !== "function") {
    define(Array.prototype, "at", function (position) {
      var length = this.length >>> 0;
      var number = Number(position) || 0;
      var index = number < 0 ? Math.ceil(number) : Math.floor(number);
      index = index < 0 ? length + index : index;
      return index < 0 || index >= length ? undefined : this[index];
    });
  }

  if (typeof Object.fromEntries !== "function") {
    define(Object, "fromEntries", function (entries) {
      var result = {};
      var iterator;
      var step;
      var index;
      if (
        typeof Symbol !== "undefined" &&
        Symbol.iterator &&
        entries != null &&
        typeof entries[Symbol.iterator] === "function"
      ) {
        iterator = entries[Symbol.iterator]();
        while (!(step = iterator.next()).done) {
          result[step.value[0]] = step.value[1];
        }
        return result;
      }
      for (index = 0; index < entries.length; index += 1) {
        result[entries[index][0]] = entries[index][1];
      }
      return result;
    });
  }

  if (typeof Promise !== "undefined" && typeof Promise.allSettled !== "function") {
    define(Promise, "allSettled", function (entries) {
      var values = [];
      var iterator;
      var step;
      var index;
      if (
        typeof Symbol !== "undefined" &&
        Symbol.iterator &&
        entries != null &&
        typeof entries[Symbol.iterator] === "function"
      ) {
        iterator = entries[Symbol.iterator]();
        while (!(step = iterator.next()).done) values.push(step.value);
      } else {
        for (index = 0; index < entries.length; index += 1) values.push(entries[index]);
      }
      return Promise.all(values.map(function (value) {
        return Promise.resolve(value).then(
          function (result) { return { status: "fulfilled", value: result }; },
          function (reason) { return { status: "rejected", reason: reason }; }
        );
      }));
    });
  }

  if (root.crypto && typeof root.crypto.randomUUID !== "function") {
    define(root.crypto, "randomUUID", function () {
      var bytes = new Uint8Array(16);
      var index;
      if (typeof root.crypto.getRandomValues === "function") {
        root.crypto.getRandomValues(bytes);
      } else {
        for (index = 0; index < bytes.length; index += 1) {
          bytes[index] = Math.floor(Math.random() * 256);
        }
      }
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      var hex = [];
      for (index = 0; index < bytes.length; index += 1) {
        hex.push((bytes[index] + 256).toString(16).slice(1));
      }
      return hex.slice(0, 4).join("") + "-" +
        hex.slice(4, 6).join("") + "-" +
        hex.slice(6, 8).join("") + "-" +
        hex.slice(8, 10).join("") + "-" +
        hex.slice(10, 16).join("");
    });
  }
})(typeof window !== "undefined" ? window : this);
`;

/**
 * PageView em cada troca de rota. Como o site é uma SPA, o Google Ads e o Pixel
 * da Meta só contariam o primeiro carregamento se dependessem apenas do
 * código-base — o resto da navegação passa por aqui.
 */
function PageViewTracker() {
  const locationHref = useRouterState({ select: (state) => state.location.href });
  const isInitialPageView = React.useRef(true);

  React.useEffect(() => {
    // O `config` do gtag e o `fbq('track','PageView')` do código-base já contam
    // o carregamento inicial — repetir aqui duplicaria a primeira visualização.
    if (isInitialPageView.current) {
      isInitialPageView.current = false;
      return;
    }

    trackPageView();
  }, [locationHref]);

  return null;
}

/** Mantém o nome da aba idêntico em todas as rotas, inclusive nas telas internas. */
function PageTitleSync() {
  const locationHref = useRouterState({ select: (state) => state.location.href });

  React.useEffect(() => {
    document.title = SITE_TITLE;
  }, [locationHref]);

  return null;
}

/**
 * Rede de segurança do primeiro acesso.
 *
 * O login por senha já manda a conta nova para `/cadastro-concluido`. Os outros
 * caminhos de entrada (link mágico do inquilino, modal de identificação) não
 * passam por lá, então este observador cobre todos eles: viu sessão nova cujo
 * perfil ainda não tem a conversão registrada, leva para a URL de conversão uma
 * única vez.
 */
// Telas que já cuidam do próprio redirecionamento (o login manda a conta nova
// direto para a URL de conversão, com o destino certo) ou onde a sessão ainda
// está sendo montada. Entrar aqui só atrapalharia.
const ROTAS_SEM_REDIRECIONAMENTO_DE_PRIMEIRO_ACESSO = [
  ROTA_CADASTRO_CONCLUIDO,
  "/login",
  "/email-verificado",
  "/acesso-inquilino",
  "/completar-acesso-inquilino",
  "/redefinir-senha",
];

function PrimeiroAcessoRedirect() {
  const navigate = useNavigate();
  const { user, isLoading } = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const verificadoParaRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (isLoading || !user) return;
    if (
      ROTAS_SEM_REDIRECIONAMENTO_DE_PRIMEIRO_ACESSO.some(
        (rota) => pathname === rota || pathname.startsWith(`${rota}/`),
      )
    )
      return;
    if (verificadoParaRef.current === user.id) return;
    verificadoParaRef.current = user.id;

    let ativo = true;
    (async () => {
      const precisa = await precisaMostrarCadastroConcluido(user.id);
      if (!ativo || !precisa) return;
      navigate({
        to: ROTA_CADASTRO_CONCLUIDO,
        search: { destino: window.location.pathname + window.location.search },
        replace: true,
      });
    })();

    return () => {
      ativo = false;
    };
  }, [isLoading, navigate, pathname, user]);

  return null;
}

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

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const [retrying, setRetrying] = React.useState(false);
  const recoverableNavigationError = isRecoverableNavigationError(error);

  React.useEffect(() => {
    if (!recoverableNavigationError) return;
    setRetrying(true);
    if (!reloadCurrentDocumentForNavigationError(error)) setRetrying(false);
  }, [error, recoverableNavigationError]);

  const retry = async () => {
    setRetrying(true);

    if (recoverableNavigationError) {
      reloadCurrentDocumentForNavigationError(error, { force: true });
      return;
    }

    try {
      await router.invalidate({ sync: true, forcePending: true });
      reset();
    } catch (retryError) {
      console.error(retryError);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4" role="alert">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {retrying ? "Atualizando o site…" : "Não foi possível abrir esta página"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {retrying
            ? "Estamos carregando a versão mais recente. Você continuará no mesmo lugar."
            : "Tente novamente. Se o problema continuar, volte ao início."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            disabled={retrying}
            onClick={() => void retry()}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {retrying ? "Atualizando…" : "Tentar novamente"}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Ir para o início
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
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
      },
      { title: SITE_TITLE },
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
      { property: "og:site_name", content: SITE_TITLE },
      { property: "og:title", content: SITE_TITLE },
      {
        property: "og:description",
        content:
          "Aluguel sem fiador, sem caução e sem burocracia. Aprovação em até 1 minuto. 100% digital.",
      },
      { property: "og:url", content: "https://noxfianca.com" },
      { property: "og:image", content: SOCIAL_SHARE_IMAGE },
      { property: "og:image:secure_url", content: SOCIAL_SHARE_IMAGE },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:width", content: "1600" },
      { property: "og:image:height", content: "900" },
      { property: "og:image:alt", content: "Logotipo da NOX Finança em fundo preto" },
      { property: "og:locale", content: "pt_BR" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@NoxFianca" },
      { name: "twitter:title", content: SITE_TITLE },
      {
        name: "twitter:description",
        content:
          "Aluguel sem fiador, sem caução e sem burocracia. Aprovação em até 1 minuto. 100% digital.",
      },
      { name: "twitter:image", content: SOCIAL_SHARE_IMAGE },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" },
      { rel: "icon", type: "image/png", sizes: "512x512", href: "/favicon-512.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "preconnect", href: "https://connect.facebook.net", crossOrigin: "anonymous" },
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
        async: true,
        src: `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_TAG_ID}`,
      },
      {
        children: `
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GOOGLE_ADS_TAG_ID}');
        `,
      },
      // Meta Pixel Code — código-base oficial. Registra o PageView do
      // carregamento inicial; as trocas de rota da SPA passam pelo
      // PageViewTracker acima.
      {
        children: `
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', '${META_PIXEL_ID}');
          fbq('track', 'PageView');
        `,
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "NOX Fiança",
          alternateName: "NOX",
          url: "https://noxfianca.com",
          logo: "https://noxfianca.com/favicon-512.png",
          image: SOCIAL_SHARE_IMAGE,
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
        {/* Meta Pixel — fallback para navegadores com JavaScript desativado. */}
        <noscript>
          <img
            height="1"
            width="1"
            style={{ display: "none" }}
            alt=""
            src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
          />
        </noscript>
        {children}
        <script dangerouslySetInnerHTML={{ __html: LEGACY_BROWSER_POLYFILLS }} />
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
        <GlobalLoadingProvider>
          <PageTitleSync />
          <PageViewTracker />
          <PrimeiroAcessoRedirect />
          <Outlet />
          <Toaster richColors position="top-right" />
        </GlobalLoadingProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
