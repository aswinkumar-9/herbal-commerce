import { CaretRight } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { text } from '../text/en.ts';

// Where the page sits in the shop, and the way back (the website's rule
// B10): home, the shop, any steps between, then this page, not a link. A
// page outside the shop, such as a policy page, leaves the shop out.
export function Trail({
  steps = [],
  here,
  inShop = true,
}: {
  steps?: readonly { label: string; to: string }[];
  here: string;
  inShop?: boolean;
}) {
  const links = [
    { label: text.nav.home, to: '/' },
    ...(inShop ? [{ label: text.nav.shop, to: '/shop' }] : []),
    ...steps,
  ];
  return (
    <nav aria-label={text.categoryPage.trail} className="mt-12">
      <ol className="body-6 flex flex-wrap items-center gap-2 text-ink-muted">
        {links.map((step, index) => (
          <li key={step.to} className="flex items-center gap-2">
            {index > 0 ? (
              <CaretRight aria-hidden="true" className="size-3" />
            ) : null}
            <Link
              prefetch="intent"
              to={step.to}
              className="hover:text-primary hover:underline"
            >
              {step.label}
            </Link>
          </li>
        ))}
        <li aria-current="page" className="flex items-center gap-2 text-ink">
          <CaretRight aria-hidden="true" className="size-3 text-ink-muted" />
          {here}
        </li>
      </ol>
    </nav>
  );
}
