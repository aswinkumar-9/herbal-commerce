import { Leaf, RefreshCw, WifiOff } from 'lucide-react';
import { motion } from 'motion/react';
import { rise } from '../motion';

// While the console checks whether the cookie still holds a session.
export function LoadingScreen() {
  return (
    <main className="grid min-h-dvh place-items-center">
      <output className="flex flex-col items-center gap-3">
        <motion.span
          className="grid size-12 place-items-center rounded-full bg-primary-soft text-primary"
          animate={{ opacity: [0.55, 1, 0.55] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Leaf aria-hidden="true" className="size-6" />
        </motion.span>
        <span className="sr-only">Opening the console…</span>
      </output>
    </main>
  );
}

export function UnreachableScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <motion.section
        variants={rise}
        initial="hidden"
        animate="shown"
        className="w-full max-w-sm rounded-card border border-line bg-surface p-8 text-center shadow-soft"
      >
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-surface-muted text-ink-muted">
          <WifiOff aria-hidden="true" className="size-6" />
        </span>
        <h1 className="mt-4 text-lg font-semibold">
          The server can&apos;t be reached
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          Check the connection, or that the API is running, then try again.
        </p>
        <motion.button
          type="button"
          onClick={onRetry}
          whileTap={{ scale: 0.98 }}
          className="mt-6 inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-on-primary transition-colors hover:bg-primary-strong"
        >
          <RefreshCw aria-hidden="true" className="size-4" />
          Try again
        </motion.button>
      </motion.section>
    </main>
  );
}
