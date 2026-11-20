import type { ReactNode } from 'react';
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from 'react-router';
import themeInit from 'virtual:herbal-theme-init';
import type { Route } from './+types/root';
import styles from './app.css?url';
import { SiteFrame } from './components/SiteFrame.tsx';
import {
  FailedPage,
  NotFoundPage,
  UnavailablePage,
} from './components/StatusPages.tsx';

export const links: Route.LinksFunction = () => [
  { rel: 'stylesheet', href: styles },
  { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
];

// Every page's document. The theme's first step runs before anything is
// drawn and may set data-theme on <html>, which React is told to expect.
export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <script src={themeInit} />
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
