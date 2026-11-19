import { motion } from 'motion/react';
import { NavLink } from 'react-router';
import { transition } from '../motion';

export interface PageTab {
  to: string;
  label: string;
  // Open only on this very address, not on those below it.
  end?: boolean;
}

// Tabs between the pages of one part of the console, such as the catalog's.
// The line under the open tab slides to the next one.
export function PageTabs({
  label,
  tabs,
  layoutId,
}: {
  label: string;
  tabs: readonly PageTab[];
  // One per set of tabs, so each line slides only within its own.
  layoutId: string;
}) {
  return (
    <nav aria-label={label} className="mb-8 border-b border-line">
      <ul className="-mb-px flex gap-6">
        {tabs.map((tab) => (
          <li key={tab.to}>
            <NavLink
              to={tab.to}
              end={tab.end}
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
                      layoutId={layoutId}
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
  );
}
