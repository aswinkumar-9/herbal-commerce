import { SHOP_FONT_FILES } from '@herbal/design/shop-fonts';
import { useContext } from 'react';
import type { ReactNode } from 'react';
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from 'react-router';
import themeStep from 'virtual:herbal-theme-init';
import type { Route } from './+types/root';
import styles from './app.css?url';
import { NonceContext } from './nonce.ts';
import { sessionMiddleware, sessionOf } from './session.server.ts';
import { SiteFrame } from './components/SiteFrame.tsx';
import {
  FailedPage,
  NotFoundPage,
  UnavailablePage,
} from './components/StatusPages.tsx';

// Before every page and data request: the customer's sign-in (ADR 0041).
export const middleware: Route.MiddlewareFunction[] = [sessionMiddleware];

// What every page needs to know: whether a customer is signed in, for the
// menu. Nothing else of the session ever reaches the browser.
export function loader({ context }: Route.LoaderArgs) {
  return { signedIn: sessionOf(context).current !== null };
}

export const links: Route.LinksFunction = () => [
  { rel: 'stylesheet', href: styles },
  // The shop's own fonts (never Google's), fetched alongside the
  // stylesheet instead of after it. A font is always fetched in CORS mode,
  // even from the shop itself, so the preload says so too, or the browser
  // would fetch each file twice.
  ...SHOP_FONT_FILES.map((href) => ({
    rel: 'preload',
    href,
    as: 'font',
    type: 'font/woff2',
    crossOrigin: 'anonymous' as const,
  })),
  { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
];

// Every page's document. The theme's first step runs before anything is
// drawn and may set data-theme on <html>, which React is told to expect.
export function Layout({ children }: { children: ReactNode }) {
  const nonce = useContext(NonceContext);
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        {/* The theme's first step, inline under the page's nonce: it runs
            before the page is drawn, with no file to fetch first. The
            browser runs it once, as it reads the page; React leaves it be,
            and the browser hides the nonce from it afterwards. */}
        <script nonce={nonce} data-theme-step="" suppressHydrationWarning>
          {themeStep}
        </script>
        <Meta />
        <Links />
      </head>
      <body className="flex min-h-dvh flex-col">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <SiteFrame>
      <Outlet />
    </SiteFrame>
  );
}

// A page that could not be made: unknown (404), the API resting or busy
// (503), or a failure. Never the failure's details.
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const status = isRouteErrorResponse(error) ? error.status : 500;
  return (
    <SiteFrame>
      {status === 404 ? (
        <NotFoundPage />
      ) : status === 503 ? (
        <UnavailablePage />
      ) : (
        <FailedPage />
      )}
    </SiteFrame>
  );
}
