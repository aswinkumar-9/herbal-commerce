import { Link } from 'react-router';
import { usePageTitle } from '../page-title';

export function NotFoundPage() {
  usePageTitle('Page not found');
  return (
    <section className="max-w-lg">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-ink-muted">
        The console has no page at this address.
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
