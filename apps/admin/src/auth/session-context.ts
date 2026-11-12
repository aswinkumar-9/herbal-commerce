import { createContext, useContext } from 'react';
import type { SignInInput, StaffProfile } from './staff-api';

// Why staff landed back on the sign-in page.
export type SignedOutNotice = 'expired' | 'elsewhere' | 'idle';

export type SessionState =
  | { status: 'checking' }
  | { status: 'unreachable' }
  | { status: 'signed-out'; notice?: SignedOutNotice }
  | { status: 'signed-in'; staff: StaffProfile };

export interface Session {
  state: SessionState;
  signIn(input: SignInInput): Promise<void>;
  // idle: after 30 minutes without activity (ADR 0031).
  signOut(options?: { idle?: boolean }): Promise<void>;
  // Tries again to resume the session after the server could not be reached.
  retry(): void;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error('useSession is used outside the SessionProvider');
  }
  return session;
}
