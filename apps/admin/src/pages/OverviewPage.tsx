import { ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';
import { Link } from 'react-router';
import { useSession } from '../auth/session-context';
import { ROLE_NAMES } from '../auth/staff-api';
import { navItemsFor } from '../layout/nav-items';
import { rise, staggered } from '../motion';
import { usePageTitle } from '../page-title';

export function OverviewPage() {
  usePageTitle('Overview');
  const { state } = useSession();
  if (state.status !== 'signed-in') {
    return null;
  }
  const { staff } = state;
  const firstName = staff.fullName.split(/\s+/)[0] ?? staff.fullName;
  const areas = navItemsFor(staff.role).filter((item) => item.to !== '/');

  return (
    <section>
      <h1 className="text-2xl font-semibold">Welcome, {firstName}</h1>
      <p className="mt-1 text-ink-muted">
        You&apos;re signed in with the {ROLE_NAMES[staff.role]} role.
      </p>

      <motion.ul
        variants={staggered}
        initial="hidden"
        animate="shown"
        className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
      >
        {areas.map((area) => (
          <motion.li key={area.to} variants={rise}>
            <Link
              to={area.to}
              className="group flex h-full flex-col rounded-card border border-line bg-surface p-5 shadow-soft transition-colors duration-150 hover:border-primary/40"
            >
              <span className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-primary-soft text-primary">
                  <area.icon aria-hidden="true" className="size-4" />
                </span>
                <span className="font-medium">{area.label}</span>
                <ArrowRight
                  aria-hidden="true"
                  className="ml-auto size-4 text-ink-muted transition-transform duration-150 group-hover:translate-x-0.5"
                />
              </span>
              <span className="mt-3 text-sm text-ink-muted">
                {area.summary}
              </span>
              {area.arrives ? (
                <span className="mt-3 text-xs text-ink-muted">
                  Arrives in {area.arrives}
                </span>
              ) : null}
            </Link>
          </motion.li>
        ))}
      </motion.ul>
    </section>
  );
}
