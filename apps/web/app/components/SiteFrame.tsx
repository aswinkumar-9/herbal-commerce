import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
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
    </>
  );
}
