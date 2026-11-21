import { NavLink } from 'react-router';
import { POLICY_PAGES } from '../policy-pages.ts';
import { text } from '../text/en.ts';

// The foot of every page: only what is true of the shop today, and its
// policies (the website's rule B10), each marked when it is the page open.
export function SiteFooter({ inert }: { inert: boolean }) {
  return (
    <footer
      inert={inert}
      aria-label={text.footer.label}
      className="border-t border-line py-12"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6">
        <div className="flex flex-col gap-2">
          <p className="title-3 text-ink">{text.shop.name}</p>
          <p className="body-6 text-ink-muted">{text.footer.prices}</p>
          <p className="body-6 text-ink-muted">{text.footer.delivery}</p>
        </div>
        <nav aria-label={text.footer.policies}>
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {POLICY_PAGES.map((page) => (
              <li key={page}>
                <NavLink
                  to={`/${page}`}
                  className="body-6 inline-block py-0.5 text-ink-muted underline-offset-4 transition-colors duration-300 ease-settle hover:text-primary hover:underline aria-[current=page]:text-ink"
                >
                  {text.policies.pages[page].title}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
