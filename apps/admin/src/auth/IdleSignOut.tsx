import { Clock } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback } from 'react';
import { DURATION, EASE_OUT } from '../motion';
import { useIdleCountdown } from './idle';
import { useSession } from './session-context';

function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

// Signs staff out after 30 idle minutes, with a quiet warning for the last
// one. Any click, key or scroll, in any console tab, starts the time again.
export function IdleSignOut() {
  const { signOut } = useSession();
  const signOutIdle = useCallback(() => {
    void signOut({ idle: true });
  }, [signOut]);
  const { secondsLeft, stay } = useIdleCountdown(signOutIdle);

  return (
    <AnimatePresence>
      {secondsLeft !== null ? (
        <motion.section
          key="idle-warning"
          aria-labelledby="idle-warning-title"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: DURATION.base, ease: EASE_OUT }}
          className="fixed inset-x-4 bottom-4 z-20 mx-auto flex max-w-md items-start gap-3 rounded-card border border-line bg-surface p-4 shadow-soft"
        >
          <Clock
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-accent"
          />
          {/* Said once by screen readers; the clock below is not read out
              every second. */}
          <p role="alert" className="sr-only">
            The console signs out in one minute without activity.
          </p>
          <div className="flex-1">
            <p id="idle-warning-title" className="font-medium">
              Still there?
            </p>
            <p className="mt-0.5 text-sm text-ink-muted">
              For safety, the console signs out in{' '}
              <span className="font-medium text-ink tabular-nums">
                {clock(secondsLeft)}
              </span>{' '}
              after 30 minutes without activity.
            </p>
          </div>
          <button
            type="button"
            onClick={stay}
            className="h-9 shrink-0 rounded-lg bg-primary px-3 text-sm font-medium text-on-primary transition-colors hover:bg-primary-strong"
          >
            Stay signed in
          </button>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}
