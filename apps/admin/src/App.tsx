import {
  Navigate,
  Outlet,
  Route,
  createRoutesFromElements,
} from 'react-router';
import { AdminsPage } from './admins/AdminsPage';
import { SessionProvider } from './auth/SessionProvider';
import { RequireRole, RequireSession } from './auth/guards';
import { CatalogLayout } from './catalog/CatalogLayout';
import { CategoriesPage } from './catalog/categories/CategoriesPage';
import { ProductPage } from './catalog/products/ProductPage';
import { ProductsPage } from './catalog/products/ProductsPage';
import { CrashScreen, ErrorBoundary } from './components/ErrorBoundary';
import { AppShell } from './layout/AppShell';
import { NAV_ITEMS } from './layout/nav-items';
import type { NavItem } from './layout/nav-items';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OrderPage } from './orders/OrderPage';
import { OrdersLayout } from './orders/OrdersLayout';
import { OrdersPage } from './orders/OrdersPage';
import { RefundsPage } from './orders/RefundsPage';
import { OverviewPage } from './pages/OverviewPage';
import { SignInPage } from './pages/SignInPage';
import { SetupLinkPage } from './setup/SetupLinkPage';
import { PackStockPage } from './stock/PackStockPage';
import { StockPage } from './stock/StockPage';

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
    {/* The emailed links: nobody is signed in there (ADR 0038). */}
    <Route path="/accept-invite" element={<SetupLinkPage purpose="INVITE" />} />
    <Route
      path="/reset-authenticator"
      element={<SetupLinkPage purpose="AUTHENTICATOR_RESET" />}
    />
    <Route element={<RequireSession />}>
      <Route element={<AppShell />}>
        <Route index element={<OverviewPage />} />
        <Route path="catalog" element={<CatalogLayout />}>
          <Route index element={<Navigate to="categories" replace />} />
          <Route path="categories" element={<CategoriesPage />} />
          <Route path="products" element={<ProductsPage />} />
        </Route>
        <Route path="catalog/products/new" element={<ProductPage />} />
        <Route path="catalog/products/:id" element={<ProductPage />} />
        <Route path="stock" element={<StockPage />} />
        <Route path="stock/:variantId" element={<PackStockPage />} />
        <Route path="orders" element={<OrdersLayout />}>
          <Route index element={<OrdersPage />} />
          <Route element={<RequireRole only="SUPER_USER" />}>
            <Route path="refunds" element={<RefundsPage />} />
          </Route>
        </Route>
        <Route path="orders/:id" element={<OrderPage />} />
        {forEveryone.map(comingSoon)}
        <Route element={<RequireRole only="SUPER_USER" />}>
          <Route path="admins" element={<AdminsPage />} />
          {forSuperUsers.map(comingSoon)}
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Route>
  </Route>,
);
