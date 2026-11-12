import { ShieldCheck } from 'lucide-react';
import { Link, Navigate, Outlet, useLocation } from 'react-router';
import { LoadingScreen, UnreachableScreen } from '../components/StatusScreens';
import { usePageTitle } from '../page-title';
import { useSession } from './session-context';
import { ROLE_NAMES } from './staff-api';
import type { StaffRole } from './staff-api';

// The console's pages open only with a session. Without one, staff go to the
// sign-in page, and come back to the page they asked for afterwards.
export function RequireSession() {
  const { state, retry } = useSession();
  const location = useLocation();

  switch (state.status) {
    case 'checking':
      return <LoadingScreen />;
    case 'unreachable':
      return <UnreachableScreen onRetry={retry} />;
    case 'signed-out':
      return (
        <Navigate
          to="/sign-in"
          replace
          state={{ from: `${location.pathname}${location.search}` }}
        />
      );
    case 'signed-in':
      return <Outlet />;
  }
}

// Hides what a role cannot use. Only a convenience: the API refuses it to
// that role either way.
export function RequireRole({ only }: { only: StaffRole }) {
  const { state } = useSession();
  if (state.status !== 'signed-in') {
    return null;
  }
  return state.staff.role === only ? <Outlet /> : <NotAllowed needs={only} />;
}

function NotAllowed({ needs }: { needs: StaffRole }) {
  usePageTitle('Not available');
  return (
    <section className="max-w-lg">
      <span className="grid size-12 place-items-center rounded-full bg-surface-muted text-ink-muted">
        <ShieldCheck aria-hidden="true" className="size-6" />
      </span>
      <h1 className="mt-4 text-2xl font-semibold">
        Only {ROLE_NAMES[needs]}s can open this page
      </h1>
      <p className="mt-2 text-ink-muted">
        Ask a {ROLE_NAMES[needs]} if you need something here.
      </p>
      <Link
        to="/"
        className="mt-6 inline-block text-sm font-medium text-primary hover:underline"
      >
        Back to the overview
      </Link>
    </section>
  );
}
