import { Leaf } from 'lucide-react';
import { motion } from 'motion/react';
import { rise } from './motion';

// The console's first page, until the sign-in arrives (Part 12A, Step 3).
export function App() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <motion.section
        variants={rise}
        initial="hidden"
        animate="shown"
        className="w-full max-w-sm rounded-card border border-line bg-surface p-8 shadow-soft"
      >
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-primary-soft text-primary">
            <Leaf aria-hidden="true" className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold">Herbal Commerce</h1>
            <p className="text-sm text-ink-muted">Admin console</p>
          </div>
        </div>
        <p className="mt-6 text-sm text-ink-muted">Staff sign-in comes next.</p>
      </motion.section>
    </main>
  );
}
