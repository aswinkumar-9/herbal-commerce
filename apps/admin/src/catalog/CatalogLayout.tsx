import { Outlet } from 'react-router';
import { PageTabs } from '../layout/PageTabs';

const TABS = [
  { to: '/catalog/categories', label: 'Categories' },
  { to: '/catalog/products', label: 'Products' },
];

// The catalog's pages, with tabs between them.
export function CatalogLayout() {
  return (
    <div>
      <PageTabs label="Catalog" tabs={TABS} layoutId="catalog-tab" />
      <Outlet />
    </div>
  );
}
