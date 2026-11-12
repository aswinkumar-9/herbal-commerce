import { useCallback, useEffect, useRef, useState } from 'react';

// Staff are signed out after 30 minutes without activity in any console tab
// (owner's decision, ADR 0031), and warned a minute before.
export const IDLE_LIMIT_MS = 30 * 60_000;
export const IDLE_WARNING_MS = 60_000;

const ACTIVITY_EVENTS = [
  'pointerdown',
  'pointermove',
  'keydown',
  'wheel',
  'touchstart',
  'scroll',
] as const;
// Tabs tell each other about activity, but not on every mouse move.
const SHARE_EVERY_MS = 10_000;
const CHANNEL = 'herbal-staff-activity';

function activityTime(data: unknown): number | null {
  if (typeof data !== 'object' || data === null || !('at' in data)) {
    return null;
  }
  const at = (data as { at: unknown }).at;
  return typeof at === 'number' && Number.isFinite(at) ? at : null;
}

export interface IdleCountdown {
  // While the warning shows: whole seconds left. Otherwise null.
  secondsLeft: number | null;
  // Counts as activity (the warning's "Stay signed in" button).
  stay(): void;
}

// The clock is read on every check, so a computer that slept for an hour
// signs out as soon as it wakes.
export function useIdleCountdown(onIdle: () => void): IdleCountdown {
  const lastActive = useRef(0);
  const share = useRef<(() => void) | null>(null);
  const idle = useRef(onIdle);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    idle.current = onIdle;
  });

  useEffect(() => {
    const tabs =
      typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel(CHANNEL);
    let sharedAt = 0;
    let finished = false;
    lastActive.current = Date.now();

    const touch = () => {
      const now = Date.now();
      lastActive.current = now;
      if (now - sharedAt >= SHARE_EVERY_MS) {
        sharedAt = now;
        tabs?.postMessage({ at: now });
      }
    };
    share.current = touch;
    if (tabs) {
      tabs.onmessage = (event: MessageEvent<unknown>) => {
        const at = activityTime(event.data);
        if (at !== null) {
          // Never later than now, whatever the message says.
          lastActive.current = Math.max(
            lastActive.current,
            Math.min(at, Date.now()),
          );
        }
      };
    }

    const check = () => {
      if (finished) {
        return;
      }
      const left = IDLE_LIMIT_MS - (Date.now() - lastActive.current);
      if (left <= 0) {
        finished = true;
        setSecondsLeft(null);
        idle.current();
        return;
      }
      setSecondsLeft(left <= IDLE_WARNING_MS ? Math.ceil(left / 1000) : null);
    };

    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, touch, { capture: true, passive: true });
    }
    document.addEventListener('visibilitychange', check);
    const timer = window.setInterval(check, 1000);

    return () => {
      for (const name of ACTIVITY_EVENTS) {
        window.removeEventListener(name, touch, { capture: true });
      }
      document.removeEventListener('visibilitychange', check);
      window.clearInterval(timer);
      tabs?.close();
      share.current = null;
    };
  }, []);

  const stay = useCallback(() => {
    share.current?.();
    setSecondsLeft(null);
  }, []);

  return { secondsLeft, stay };
}
