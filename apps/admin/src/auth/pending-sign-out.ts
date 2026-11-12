// A note that an idle sign-out could not reach the server, so the session is
// still open there. The next start of the console ends it before anything
// else. Only this flag is kept in localStorage: never a token.
const KEY = 'herbal-staff-sign-out-pending';

// Storage can be switched off or full: the console still works without it.
export function markSignOutPending(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // Nothing more can be done: the session ends on its own in 12 hours.
  }
}

export function signOutPending(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function clearSignOutPending(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // As above.
  }
}
