// The light and dark switch in the website (ADR 0036): every switch on the
// page shows the same choice, and so does another tab once one changes it.
// The server can't know a device's choice, so the page is made as "Auto";
// the first step in <head> has already shown the right colours, and the
// switch catches up as the page comes to life.
import { useCallback, useSyncExternalStore } from 'react';
import {
  THEME_KEY,
  applyThemeChoice,
  deviceStorage,
  readThemeChoice,
  saveThemeChoice,
} from '@herbal/design';
import type { ThemeChoice } from '@herbal/design';

const listeners = new Set<() => void>();
// A choice this page made, which holds even where storage is blocked.
let chosen: ThemeChoice | undefined;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const fromAnotherTab = (event: StorageEvent): void => {
    if (event.key === THEME_KEY || event.key === null) {
      chosen = undefined;
      applyThemeChoice(document.documentElement, current());
      listener();
    }
  };
  addEventListener('storage', fromAnotherTab);
  return () => {
    listeners.delete(listener);
    removeEventListener('storage', fromAnotherTab);
  };
}

const current = (): ThemeChoice => chosen ?? readThemeChoice(deviceStorage());
const onTheServer = (): ThemeChoice => 'system';

export function useThemeChoice(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const choice = useSyncExternalStore(subscribe, current, onTheServer);
  const choose = useCallback((next: ThemeChoice) => {
    chosen = next;
    saveThemeChoice(deviceStorage(), next);
    applyThemeChoice(document.documentElement, next);
    for (const listener of listeners) {
      listener();
    }
  }, []);
  return [choice, choose];
}

// For tests: forget this page's choice.
export function forgetThemeChoice(): void {
  chosen = undefined;
}
