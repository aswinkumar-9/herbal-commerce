import { Outlet, Route, createRoutesFromElements } from 'react-router';
import { SessionProvider } from './auth/SessionProvider';
import { RequireRole, RequireSession } from './auth/guards';
import { CrashScreen, ErrorBoundary } from './components/ErrorBoundary';
import { AppShell } from './layout/AppShell';
import { NAV_ITEMS } from './layout/nav-items';
import type { NavItem } from './layout/nav-items';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OverviewPage } from './pages/OverviewPage';
import { SignInPage } from './pages/SignInPage';

const forEveryone = NAV_ITEMS.filter((item) => item.arrives && !item.role);
const forSuperUsers = NAV_ITEMS.filter(
  (item) => item.arrives && item.role === 'SUPER_USER',
);

function comingSoon(item: NavItem) {
  return (
    <Route
      key={item.to}
      path={item.to.slice(1)}
      element={<ComingSoonPage item={item} />}
    />
  );
}

// Around every page: a calm screen if one breaks, and the staff session.
function Root() {
  return (
    <ErrorBoundary>
      <SessionProvider>
        <Outlet />
      </SessionProvider>
    </ErrorBoundary>
  );
}

// The console's pages, for createBrowserRouter (main.tsx) and the tests'
// createMemoryRouter. A data router, so a page with unsaved changes can ask
// before staff leave it (useBlocker).
export const routes = createRoutesFromElements(
  <Route element={<Root />} errorElement={<CrashScreen />}>
    <Route path="/sign-in" element={<SignInPage />} />
    <Route element={<RequireSession />}>
      <Route element={<AppShell />}>
        <Route index element={<OverviewPage />} />
        {forEveryone.map(comingSoon)}
        <Route element={<RequireRole only="SUPER_USER" />}>
          {forSuperUsers.map(comingSoon)}
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Route>
  </Route>,
);
