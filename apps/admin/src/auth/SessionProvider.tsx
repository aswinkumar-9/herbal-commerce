import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { setAccessToken } from '../api/access-token';
import { ApiError } from '../api/api-error';
import { onSessionLost, renewSession } from '../api/client';
import {
  clearSignOutPending,
  markSignOutPending,
  signOutPending,
} from './pending-sign-out';
import { SessionContext } from './session-context';
import type { Session, SessionState } from './session-context';
import { fetchProfile, signInRequest, signOutRequest } from './staff-api';
import type { SignInInput, StaffProfile } from './staff-api';

// Tabs of the console tell each other when staff sign in or out.
const CHANNEL = 'herbal-staff-session';
type TabMessage = 'signed-in' | 'signed-out' | 'signed-out-idle';

// After a reload: the cookie brings the session back, if there is one.
async function resumeSession(): Promise<StaffProfile | null> {
  // An idle sign-out could not reach the server: the session ends first.
  if (signOutPending()) {
    await signOutRequest();
    clearSignOutPending();
    return null;
  }
  if (!(await renewSession())) {
    return null;
  }
  return fetchProfile();
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SessionState>({ status: 'checking' });
  const [attempt, setAttempt] = useState(0);
  const channel = useRef<BroadcastChannel | null>(null);

  // Nothing a signed-out console showed may stay in memory.
  const forget = useCallback(
    (next: SessionState) => {
      setAccessToken(null);
      queryClient.clear();
      setState(next);
    },
    [queryClient],
  );

  useEffect(() => {
    let current = true;
    resumeSession().then(
      (staff) => {
        if (current) {
          setState(
            staff ? { status: 'signed-in', staff } : { status: 'signed-out' },
          );
        }
      },
      (error: unknown) => {
        if (!current) {
          return;
        }
        const refused =
          error instanceof ApiError &&
          (error.status === 401 || error.status === 403);
        setState({ status: refused ? 'signed-out' : 'unreachable' });
      },
    );
    return () => {
      current = false;
    };
  }, [attempt]);

  useEffect(
    () =>
      onSessionLost(() => forget({ status: 'signed-out', notice: 'expired' })),
    [forget],
  );

  const retry = useCallback(() => {
    setState({ status: 'checking' });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') {
      return;
    }
    const tabs = new BroadcastChannel(CHANNEL);
    tabs.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === 'signed-out') {
        forget({ status: 'signed-out', notice: 'elsewhere' });
      } else if (event.data === 'signed-out-idle') {
        forget({ status: 'signed-out', notice: 'idle' });
      } else if (event.data === 'signed-in') {
        // Another tab signed in, and the cookie is now that session's: this
        // tab picks it up too, with its name and role (it may be someone
        // else's).
        retry();
      }
    };
    channel.current = tabs;
    return () => {
      tabs.close();
      channel.current = null;
    };
  }, [forget, retry]);

  const signIn = useCallback(async (input: SignInInput) => {
    await signInRequest(input);
    const staff = await fetchProfile();
    setState({ status: 'signed-in', staff });
    channel.current?.postMessage('signed-in' satisfies TabMessage);
  }, []);

  // Staff who sign out themselves are told when it did not work, and stay
  // signed in. After 30 idle minutes nobody is there to try again: the
  // console locks anyway, and its next start ends the session.
  const signOut = useCallback(
    async ({ idle = false }: { idle?: boolean } = {}) => {
      try {
        await signOutRequest();
      } catch (error) {
        if (!idle) {
          throw error;
        }
        markSignOutPending();
      }
      forget(
        idle
          ? { status: 'signed-out', notice: 'idle' }
          : { status: 'signed-out' },
      );
      channel.current?.postMessage(
        (idle ? 'signed-out-idle' : 'signed-out') satisfies TabMessage,
      );
    },
    [forget],
  );

  const session = useMemo<Session>(
    () => ({ state, signIn, signOut, retry }),
    [state, signIn, signOut, retry],
  );
  return (
    <SessionContext.Provider value={session}>
      {children}
    </SessionContext.Provider>
  );
}
