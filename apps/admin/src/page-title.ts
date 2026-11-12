import { useEffect } from 'react';

export const CONSOLE_NAME = 'Herbal Commerce Admin';

// The browser tab says which page is open.
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · ${CONSOLE_NAME}`;
  }, [title]);
}
