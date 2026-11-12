import { motion } from 'motion/react';
import { useId } from 'react';
import { transition } from '../motion';

interface SwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string | undefined;
  // Named for screen readers only, where the row around it says the rest.
  hideLabel?: boolean;
  // While its change is on the way: it shows the new state, ignores
  // clicks, and keeps the focus (a disabled one would drop it).
  busy?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
}

// On or off, such as whether customers see a category. A button with the
// switch role: Space or Enter flips it, and a screen reader says "on" or
// "off". The knob slides across.
export function Switch({
  label,
  checked,
  onChange,
  hint,
  hideLabel = false,
  busy = false,
  disabled = false,
  id,
  className = '',
}: SwitchProps) {
  const generated = useId();
  const switchId = id ?? generated;
  const labelId = `${switchId}-label`;
  const hintId = `${switchId}-hint`;

  return (
    <div className={`flex items-start justify-between gap-4 ${className}`}>
      <div>
        <label
          id={labelId}
          htmlFor={switchId}
          className={hideLabel ? 'sr-only' : 'text-sm font-medium'}
        >
          {label}
        </label>
        {hint ? (
          <p id={hintId} className="mt-0.5 text-xs text-ink-muted">
            {hint}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        id={switchId}
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={hint ? hintId : undefined}
        aria-disabled={busy || undefined}
        disabled={disabled}
        onClick={() => {
          if (!busy) {
            onChange(!checked);
          }
        }}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-wait aria-disabled:opacity-70 ${
          checked ? 'bg-primary' : 'bg-line'
        }`}
      >
        <motion.span
          aria-hidden="true"
          initial={false}
          animate={{ x: checked ? 22 : 2 }}
          transition={transition}
          className="block size-5 rounded-full bg-surface shadow-sm"
        />
      </button>
    </div>
  );
}
