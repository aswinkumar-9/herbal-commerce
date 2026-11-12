import { LoaderCircle, LogOut, Menu, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { ApiError } from '../api/api-error';
import { useSession } from '../auth/session-context';
import { ROLE_NAMES } from '../auth/staff-api';
import { Brand } from '../components/Brand';
import { rise, transition } from '../motion';
import { navItemsFor } from './nav-items';

// The signed-in console: the menu on the left (at the top on small
// screens), the page on the right.
export function AppShell() {
  const { state, signOut } = useSession();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutProblem, setSignOutProblem] = useState<string | null>(null);

  // Escape closes the small-screen menu.
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [menuOpen]);

  if (state.status !== 'signed-in') {
    return null;
  }
  const { staff } = state;

  async function leave() {
    setSigningOut(true);
    setSignOutProblem(null);
    try {
      await signOut();
    } catch (error) {
      // Staff are not told they signed out while the session is still open.
      setSignOutProblem(
        error instanceof ApiError && error.status === 0
          ? "Couldn't sign out: the server can't be reached. Try again."
          : "Couldn't sign out. Try again.",
      );
      setSigningOut(false);
    }
  }

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-10 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-soft"
      >
        Skip to the page
      </a>
      <aside className="border-b border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between p-4 lg:p-5">
          <Brand />
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="console-menu"
            aria-label={menuOpen ? 'Close the menu' : 'Open the menu'}
            className="grid size-10 place-items-center rounded-lg text-ink-muted hover:bg-surface-muted lg:hidden"
          >
            {menuOpen ? (
              <X aria-hidden="true" className="size-5" />
            ) : (
              <Menu aria-hidden="true" className="size-5" />
            )}
          </button>
        </div>

        <div
          id="console-menu"
          className={`${menuOpen ? 'flex' : 'hidden'} flex-1 flex-col lg:flex`}
        >
          <nav aria-label="Main" className="px-3">
            <ul className="space-y-1">
              {navItemsFor(staff.role).map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) =>
                      `relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150 ${
                        isActive
                          ? 'font-medium text-primary-strong'
                          : 'text-ink-muted hover:bg-surface-muted hover:text-ink'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive ? (
                          // The highlight slides to the page that opens.
                          <motion.span
                            layoutId="nav-highlight"
                            transition={transition}
                            className="absolute inset-0 rounded-lg bg-primary-soft"
                          />
                        ) : null}
                        <item.icon
                          aria-hidden="true"
                          className="relative size-4 shrink-0"
                        />
                        <span className="relative">{item.label}</span>
                        {item.arrives ? (
                          <span className="relative ml-auto rounded-full border border-line px-2 text-[0.6875rem] text-ink-muted">
                            Soon
                          </span>
                        ) : null}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          <div className="mt-6 border-t border-line p-4 lg:mt-auto lg:p-5">
            <p className="truncate text-sm font-medium">{staff.fullName}</p>
            <p className="truncate text-xs text-ink-muted">{staff.email}</p>
            <span className="mt-2 inline-block rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary-strong">
              {ROLE_NAMES[staff.role]}
            </span>
            <button
              type="button"
              onClick={leave}
              disabled={signingOut}
              className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-line text-sm font-medium transition-colors hover:bg-surface-muted disabled:cursor-wait disabled:opacity-70"
            >
              {signingOut ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="size-4 animate-spin"
                />
              ) : (
                <LogOut aria-hidden="true" className="size-4" />
              )}
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
            {signOutProblem ? (
              <p role="alert" className="mt-2 text-sm text-danger">
                {signOutProblem}
              </p>
            ) : null}
          </div>
        </div>
      </aside>

      <main id="main" tabIndex={-1} className="p-6 outline-none lg:p-10">
        {/* Each page rises in gently as it opens. */}
        <motion.div
          key={location.pathname}
          variants={rise}
          initial="hidden"
          animate="shown"
        >
          <Outlet />
        </motion.div>
      </main>
    </div>
  );
}
