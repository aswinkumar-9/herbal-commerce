import { AnimatePresence, motion } from 'motion/react';
import { useId } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { DURATION, EASE_OUT } from '../motion';

interface FieldProps extends ComponentProps<'input'> {
  label: string;
  error?: string | undefined;
  hint?: string;
  // A button inside the box, on the right (for example "show password").
  trailing?: ReactNode;
}

// A labelled input. Its hint and error are read out with it.
export function Field({
  label,
  error,
  hint,
  trailing,
  id,
  className,
  ...input
}: FieldProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className}>
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative mt-1.5">
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={`h-11 w-full rounded-lg border bg-surface px-3 text-ink transition-colors duration-150 outline-none placeholder:text-ink-muted/70 focus:border-primary focus:ring-3 focus:ring-primary/15 ${
            error ? 'border-danger' : 'border-line'
          } ${trailing ? 'pr-11' : ''}`}
          {...input}
        />
        {trailing ? (
          <div className="absolute inset-y-0 right-1 flex items-center">
            {trailing}
          </div>
        ) : null}
      </div>
      {hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
      <AnimatePresence initial={false}>
        {error ? (
          <motion.p
            key="error"
            id={errorId}
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION.fast, ease: EASE_OUT }}
            className="mt-1.5 text-sm text-danger"
          >
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
