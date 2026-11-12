import { motion } from 'motion/react';
import { NavLink, Outlet } from 'react-router';
import { transition } from '../motion';

const TABS = [{ to: '/catalog/categories', label: 'Categories' }];

// The catalog's pages, with tabs between them. The line under the open tab
// slides to the next one.
export function CatalogLayout() {
  return (
    <div>
      <nav aria-label="Catalog" className="mb-8 border-b border-line">
        <ul className="-mb-px flex gap-6">
          {TABS.map((tab) => (
            <li key={tab.to}>
              <NavLink
                to={tab.to}
                className={({ isActive }) =>
                  `relative block pb-3 text-sm font-medium transition-colors duration-150 ${
                    isActive ? 'text-ink' : 'text-ink-muted hover:text-ink'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {tab.label}
                    {isActive ? (
                      <motion.span
                        layoutId="catalog-tab"
                        transition={transition}
                        className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary"
                      />
                    ) : null}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </div>
  );
}
