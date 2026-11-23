import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigation } from 'react-router';
import { text } from '../text/en.ts';
import { SiteFooter } from './SiteFooter.tsx';
import { SiteHeader } from './SiteHeader.tsx';

// Every page's frame: the skip link, the floating menu bar, the page, and
// the foot. While the phone menu is open, everything but the menu bar is
// out of reach (inert).
export function SiteFrame({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const onMenuChange = useCallback((open: boolean) => setMenuOpen(open), []);
  return (
    <>
      <a
        href="#main"
        inert={menuOpen}
        className="button-sm sr-only rounded-full bg-primary px-3 py-2 text-on-primary focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50"
      >
        {text.skipLink}
      </a>
      <SiteHeader menuOpen={menuOpen} onMenuChange={onMenuChange} />
      <main
        id="main"
        tabIndex={-1}
        inert={menuOpen}
        className="flex-1 outline-none"
      >
        {children}
      </main>
      <SiteFooter inert={menuOpen} />
      <PageLoading />
    </>
  );
}

// While the next page is on its way: a thin bar across the very top, never
// a spinner (the website's rule B9), and only once the wait is noticeable
// (app.css), so a quick page change shows nothing. Pages that load their
// own parts show the shapes of what comes (the shop's cards); this is for
// going from one page to the next. A form being sent shows it on its
// button instead (FormPage, signing out). Read out as a progress bar.
function PageLoading() {
  const navigation = useNavigation();
  const { pathname } = useLocation();
  if (
    navigation.state !== 'loading' ||
    navigation.formMethod === 'POST' ||
    navigation.location.pathname === pathname
  ) {
    return null;
  }
  return (
    <div className="animate-page-loading-show pointer-events-none fixed inset-x-0 top-0 z-60 h-0.5 overflow-hidden">
      {/* The browser's own progress bar, with no value (still going), for
          those who listen; the light that passes is only to be seen. */}
      <progress aria-label={text.pageLoading} className="sr-only" />
      <div
        aria-hidden="true"
        className="animate-page-loading-pass h-full w-2/5 bg-primary motion-reduce:w-full motion-reduce:animate-none"
      />
    </div>
  );
}
