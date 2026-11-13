import { ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useId } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { DURATION, EASE_OUT } from '../motion';

interface Described {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
}

// The IDs that tie a box to its label, hint and error, so a screen reader
// reads them with it.
function useDescribed(id: string | undefined, { hint, error }: Described) {
  const generated = useId();
  const boxId = id ?? generated;
  const hintId = `${boxId}-hint`;
  const errorId = `${boxId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ');
  return {
    boxId,
    hintId,
    errorId,
    box: {
      id: boxId,
      'aria-invalid': error ? true : undefined,
      'aria-describedby': describedBy || undefined,
    },
  };
}

function boxClass(error: string | undefined): string {
  return `w-full rounded-lg border bg-surface px-3 text-ink transition-colors duration-150 outline-none placeholder:text-ink-muted/70 focus:border-primary focus:ring-3 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-surface-muted ${
    error ? 'border-danger' : 'border-line'
  }`;
}

function Hint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1.5 text-xs text-ink-muted">
      {children}
    </p>
  );
}

// The error slides in under the box.
function ErrorText({ id, error }: { id: string; error: string | undefined }) {
  return (
    <AnimatePresence initial={false}>
      {error ? (
        <motion.p
          key="error"
          id={id}
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
  );
}

interface FieldProps extends Described, ComponentProps<'input'> {
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
  const { boxId, hintId, errorId, box } = useDescribed(id, {
    label,
    error,
    hint,
  });
  return (
    <div className={className}>
      <label htmlFor={boxId} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative mt-1.5">
        <input
          {...box}
          className={`h-11 ${boxClass(error)} ${trailing ? 'pr-11' : ''}`}
          {...input}
        />
        {trailing ? (
          <div className="absolute inset-y-0 right-1 flex items-center">
            {trailing}
          </div>
        ) : null}
      </div>
      {hint ? <Hint id={hintId}>{hint}</Hint> : null}
      <ErrorText id={errorId} error={error} />
    </div>
  );
}

type TextAreaFieldProps = Described & ComponentProps<'textarea'>;

// A labelled box for longer text. With maxLength, it counts the characters
// left.
export function TextAreaField({
  label,
  error,
  hint,
  id,
  className,
  rows = 4,
  ...textarea
}: TextAreaFieldProps) {
  const { boxId, hintId, errorId, box } = useDescribed(id, {
    label,
    error,
    hint,
  });
  const { maxLength, value } = textarea;
  const used = typeof value === 'string' ? value.length : null;
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={boxId} className="text-sm font-medium">
          {label}
        </label>
        {maxLength !== undefined && used !== null ? (
          // The box itself stops at the limit, so the count is for the eye.
          <span aria-hidden="true" className="text-xs text-ink-muted">
            {used}/{maxLength}
          </span>
        ) : null}
      </div>
      <textarea
        {...box}
        rows={rows}
        className={`mt-1.5 block resize-y py-2.5 ${boxClass(error)}`}
        {...textarea}
      />
      {hint ? <Hint id={hintId}>{hint}</Hint> : null}
      <ErrorText id={errorId} error={error} />
    </div>
  );
}

type SelectFieldProps = Described & ComponentProps<'select'>;

// A labelled choice from a list: the browser's own, so it works the same
// with a keyboard, a screen reader and a phone.
export function SelectField({
  label,
  error,
  hint,
  id,
  className,
  children,
  ...select
}: SelectFieldProps) {
  const { boxId, hintId, errorId, box } = useDescribed(id, {
    label,
    error,
    hint,
  });
  return (
    <div className={className}>
      <label htmlFor={boxId} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative mt-1.5">
        <select
          {...box}
          className={`h-11 appearance-none pr-10 ${boxClass(error)}`}
          {...select}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-muted"
        />
      </div>
      {hint ? <Hint id={hintId}>{hint}</Hint> : null}
      <ErrorText id={errorId} error={error} />
    </div>
  );
}
