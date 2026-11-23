import { Outlet } from 'react-router';
import { ErrorPage } from '../components/StatusPages.tsx';
import type { Route } from './+types/pages';

// Every page of the website, in one layout (routes.ts). A page that can't
// be made, "not found" or "short break", shows here, inside the site's
// frame. So a link to it, within the site, draws only the page: the
// document stays. Drawing the document anew in the browser had React make
// <script> elements, which Trusted Types refuses (ADR 0039), and the page
// went blank (found in part 14B, step 7).
export default function Pages() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ErrorPage error={error} />;
}
