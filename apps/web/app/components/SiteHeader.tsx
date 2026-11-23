import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, useRouteLoaderData } from 'react-router';
import { SHOP_MOTION } from '@herbal/design';
import { text } from '../text/en.ts';
import { ThemeSwitch } from './ThemeSwitch.tsx';

// The website's places, in the menu bar and the phone menu. More come with
// each page.
export const SITE_LINKS = [
  { to: '/', label: text.nav.home },
  { to: '/shop', label: text.nav.shop },
] as const;

type SiteLink = {
  to: string;
  label: string;
  // How many packs the cart holds, shown beside "Cart".
  count?: number | undefined;
};

// Then the customer's own places: their cart, with what it holds, their
// orders and their account, once signed in; else the way to sign in. The
// root's loader says which (root.tsx).
function useSiteLinks(): readonly SiteLink[] {
  const root = useRouteLoaderData<{
    signedIn: boolean;
    cartPacks: number | null;
  }>('root');
  return root?.signedIn
    ? [
        ...SITE_LINKS,
        // No count while it is empty, or the API can't say.
        {
          to: '/cart',
          label: text.nav.cart,
          count: root.cartPacks || undefined,
        },
        { to: '/orders', label: text.nav.orders },
        { to: '/account', label: text.nav.account },
      ]
    : [...SITE_LINKS, { to: '/sign-in', label: text.nav.signIn }];
}

// A link's words, and for the cart how many packs it holds: read out as
// "Cart, 3 packs", starting with what it shows.
function LinkWords({ link }: { link: SiteLink }) {
  return link.count === undefined ? (
    link.label
  ) : (
    <>
      <span aria-hidden="true" className="flex items-center gap-2">
        {link.label}
        <span className="caption-3 rounded-full bg-gold px-2 py-0.5 text-on-gold">
          {link.count}
        </span>
      </span>
      <span className="sr-only">{text.nav.cartHolding(link.count)}</span>
    </>
  );
}

const WIDE = '(min-width: 64rem)';
const reducedMotion = (): boolean =>
  matchMedia('(prefers-reduced-motion: reduce)').matches;

// The menu bar floats off the top edge, sized to what it holds; only main
// text sits on its glass (ADR 0036). On a phone, its button opens the phone
// menu: a full-height panel of nearly solid glass over the page, whose
// parts arrive one after another. The page behind it can't be reached
// until it closes (the frame makes it inert), and Escape closes it.
export function SiteHeader({
  menuOpen,
  onMenuChange,
}: {
  menuOpen: boolean;
  onMenuChange: (open: boolean) => void;
}) {
  const links = useSiteLinks();
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // Closing, it stays in the page while it fades, then hides.
  const [wasOpen, setWasOpen] = useState(menuOpen);
  const [fading, setFading] = useState(false);
  if (wasOpen !== menuOpen) {
    setWasOpen(menuOpen);
    setFading(!menuOpen);
  }

  useEffect(() => {
    if (!fading) {
      return;
    }
    const hiding = setTimeout(
      () => setFading(false),
      reducedMotion() ? 0 : SHOP_MOTION.durations.hover * 1000,
    );
    return () => clearTimeout(hiding);
  }, [fading]);

  // Opening, it is drawn closed first, so the opening is seen: its parts
  // 60 ms apart, all within 400 ms however many there are. data-open and
  // the delays are set on the element itself (its style object, which the
  // security policy allows, never a style attribute); React leaves them be.
  useLayoutEffect(() => {
    const node = panel.current;
    if (!node) {
      return;
    }
    const items = menuItems(node);
    if (!menuOpen) {
      delete node.dataset['open'];
      for (const item of items) {
        item.style.transitionDelay = '0s';
      }
      return;
    }
    const step = Math.min(
      SHOP_MOTION.stagger,
      SHOP_MOTION.menuCap / Math.max(items.length - 1, 1),
    );
    items.forEach((item, index) => {
      item.style.transitionDelay = `${index * step}s`;
    });
    node.getBoundingClientRect();
    node.dataset['open'] = '';
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onMenuChange(false);
        toggle.current?.focus();
      }
    };
    // A wide screen has no phone menu: it closes if the window grows.
    const wide = matchMedia(WIDE);
    const onWide = (event: MediaQueryListEvent): void => {
      if (event.matches) {
        onMenuChange(false);
      }
    };
    addEventListener('keydown', onKey);
    wide.addEventListener('change', onWide);
    return () => {
      removeEventListener('keydown', onKey);
      wide.removeEventListener('change', onWide);
    };
  }, [menuOpen, onMenuChange]);

  return (
    <>
      <header className="fixed inset-x-0 top-4 z-30 flex justify-center px-4">
        <nav
          aria-label={text.nav.label}
          className="glass flex items-center gap-2 rounded-full py-2 pr-2 pl-4 inset-shadow-glass"
        >
          <Link
            prefetch="intent"
            to="/"
            className="title-4 rounded-full px-2 py-2 text-ink"
          >
            {text.shop.name}
          </Link>
          <ul className="hidden items-center lg:flex">
            {links.map((link) => (
              <li key={link.to}>
                {/* The page you are on sits on a solid chip, in gold. */}
                <NavLink
                  prefetch="intent"
                  to={link.to}
                  className="body-5 block rounded-full px-3 py-2 text-ink transition-colors hover:bg-primary-soft hover:text-primary aria-[current=page]:bg-primary-soft aria-[current=page]:text-primary"
                >
                  <LinkWords link={link} />
                </NavLink>
              </li>
            ))}
          </ul>
          <ThemeSwitch name="theme-bar" place="bar" />
          {/* Its two lines turn into a cross as the menu opens. */}
          <button
            ref={toggle}
            type="button"
            aria-expanded={menuOpen}
            aria-controls="menu"
            aria-label={text.nav.menu}
            onClick={() => onMenuChange(!menuOpen)}
            className="group relative flex size-10 items-center justify-center rounded-full bg-primary-soft transition-transform active:scale-95 lg:hidden"
          >
            <span
              aria-hidden="true"
              className="absolute h-0.5 w-4 -translate-y-1 rounded-full bg-ink transition-transform duration-500 group-aria-expanded:translate-y-0 group-aria-expanded:rotate-45"
            />
            <span
              aria-hidden="true"
              className="absolute h-0.5 w-4 translate-y-1 rounded-full bg-ink transition-transform duration-500 group-aria-expanded:translate-y-0 group-aria-expanded:-rotate-45"
            />
          </button>
        </nav>
      </header>

      <div
        id="menu"
        ref={panel}
        hidden={!menuOpen && !fading}
        className="group glass-strong fixed inset-0 z-20 overflow-y-auto overscroll-contain px-6 pt-24 pb-12 opacity-0 transition-opacity not-data-open:pointer-events-none data-open:opacity-100 lg:hidden"
      >
        <nav aria-label={text.nav.phoneLabel}>
          <ul className="flex flex-col gap-2">
            {links.map((link) => (
              <li
                key={link.to}
                data-menu-item
                className="translate-y-6 opacity-0 transition duration-500 group-data-open:translate-y-0 group-data-open:opacity-100"
              >
                <NavLink
                  prefetch="intent"
                  to={link.to}
                  onClick={() => onMenuChange(false)}
                  className="heading-5 block rounded-2xl py-2 text-ink aria-[current=page]:text-primary"
                >
                  <LinkWords link={link} />
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div
          data-menu-item
          className="mt-12 translate-y-6 opacity-0 transition duration-500 group-data-open:translate-y-0 group-data-open:opacity-100"
        >
          <ThemeSwitch name="theme-menu" place="menu" />
        </div>
      </div>
    </>
  );
}

function menuItems(panel: HTMLElement | null): HTMLElement[] {
  return panel
    ? [...panel.querySelectorAll<HTMLElement>('[data-menu-item]')]
    : [];
}
