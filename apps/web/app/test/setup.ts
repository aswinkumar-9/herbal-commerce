import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { forgetThemeChoice } from '../theme.ts';

// A page drawn from cold while every other test file runs too can take
// over a second on a busy computer.
configure({ asyncUtilTimeout: 3000 });

// jsdom has no matchMedia: a narrow screen with no wishes, unless a test
// says otherwise (media.ts).
export const mediaListeners = new Map<
  string,
  Set<(event: MediaQueryListEvent) => void>
>();
export const mediaMatches = new Map<string, boolean>();

function matchMedia(query: string): MediaQueryList {
  const listeners = mediaListeners.get(query) ?? new Set();
  mediaListeners.set(query, listeners);
  return {
    get matches() {
      return mediaMatches.get(query) ?? false;
    },
    media: query,
    onchange: null,
    addEventListener: (
      _type: string,
      listener: (event: MediaQueryListEvent) => void,
    ) => {
      listeners.add(listener);
    },
    removeEventListener: (
      _type: string,
      listener: (event: MediaQueryListEvent) => void,
    ) => {
      listeners.delete(listener);
    },
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  } as unknown as MediaQueryList;
}
// Again before each test, as a test may put the browser's globals back.
beforeEach(() => {
  if (typeof window !== 'undefined') {
    vi.stubGlobal('matchMedia', matchMedia);
  }
});

afterEach(() => {
  vi.useRealTimers();
  mediaMatches.clear();
  forgetThemeChoice();
  // Server tests run without a page.
  if (typeof document !== 'undefined') {
    cleanup();
    localStorage.clear();
    delete document.documentElement.dataset['theme'];
  }
});
