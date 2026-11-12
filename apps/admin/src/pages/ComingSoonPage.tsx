import { Sprout } from 'lucide-react';
import { Link } from 'react-router';
import type { NavItem } from '../layout/nav-items';
import { usePageTitle } from '../page-title';

// An area of the console that is still being built.
export function ComingSoonPage({ item }: { item: NavItem }) {
  usePageTitle(item.label);
  return (
    <section className="max-w-lg">
      <h1 className="text-2xl font-semibold">{item.label}</h1>
      <p className="mt-1 text-ink-muted">{item.summary}</p>
      <div className="mt-8 flex gap-4 rounded-card border border-dashed border-line bg-surface p-6">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
          <Sprout aria-hidden="true" className="size-5" />
        </span>
        <div>
          <p className="font-medium">Still growing</p>
          <p className="mt-1 text-sm text-ink-muted">
            This area arrives in {item.arrives ?? 'a later part'}.
          </p>
          <Link
            to="/"
            className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
          >
            Back to the overview
          </Link>
        </div>
      </div>
    </section>
  );
}
