// The shop's light and dark switch (ADR 0036). By default the page follows
// the device. A customer may choose light or dark instead; the choice stays
// on that device only (localStorage), as it is a preference of the device,
// not of the account. It is set on <html> as data-theme, which the shop's
// CSS reads.

export const THEME_CHOICES = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

export const THEME_KEY = 'herbal-theme';

const isChoice = (value: unknown): value is ThemeChoice =>
  (THEME_CHOICES as readonly unknown[]).includes(value);

// What was chosen on this device. Anything else, or storage that can't be
// read (a private window, blocked site data), means the device's own
// setting.
export function readThemeChoice(
  storage: Pick<Storage, 'getItem'> | undefined,
): ThemeChoice {
  try {
    const value = storage?.getItem(THEME_KEY);
    return isChoice(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

// Keeps the choice for next time. Following the device keeps nothing. If
// storage can't be written, the choice still holds until the page closes.
export function saveThemeChoice(
  storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined,
  choice: ThemeChoice,
): void {
  try {
    if (choice === 'system') {
      storage?.removeItem(THEME_KEY);
    } else {
      storage?.setItem(THEME_KEY, choice);
    }
  } catch {
    // The page still shows the choice; it just won't be remembered.
  }
}

// Shows the choice: data-theme="light" or "dark" on <html>, or none to
// follow the device.
export function applyThemeChoice(
  root: { dataset: DOMStringMap },
  choice: ThemeChoice,
): void {
  if (choice === 'system') {
    delete root.dataset['theme'];
  } else {
    root.dataset['theme'] = choice;
  }
}

// Storage, if the browser lets the page have it.
export function deviceStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
