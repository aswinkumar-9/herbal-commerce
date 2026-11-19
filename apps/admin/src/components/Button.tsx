import { LoaderCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ComponentProps, MouseEvent } from 'react';

const VARIANTS = {
  primary:
    'bg-primary bg-linear-to-b from-white/15 to-white/0 text-on-primary shadow-clay-sm inset-shadow-clay-solid hover:bg-primary-strong active:shadow-none active:inset-shadow-pressed-solid',
  secondary:
    'border border-line bg-surface text-ink shadow-clay-sm inset-shadow-clay hover:bg-surface-muted active:shadow-none active:inset-shadow-pressed',
  danger:
    'bg-danger bg-linear-to-b from-white/15 to-white/0 text-on-danger shadow-clay-sm inset-shadow-clay-solid hover:bg-danger-strong active:shadow-none active:inset-shadow-pressed-solid',
  ghost: 'text-ink-muted hover:bg-surface-muted hover:text-ink',
} as const;

const SIZES = {
  md: 'h-10 px-4',
  sm: 'h-8 px-3',
} as const;

// Also for a link that looks like a button, such as "New product".
export function buttonClass(
  variant: keyof typeof VARIANTS = 'secondary',
  size: keyof typeof SIZES = 'md',
): string {
  return `inline-flex shrink-0 items-center justify-center gap-2 rounded-control text-sm font-medium transition-[background-color,color,scale,box-shadow] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 aria-disabled:cursor-wait aria-disabled:opacity-80 ${VARIANTS[variant]} ${SIZES[size]}`;
}

interface ButtonProps extends ComponentProps<'button'> {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  icon?: LucideIcon;
  // While its request is on the way: a spinner, and clicks do nothing. The
  // button keeps its focus (a disabled one would drop it).
  busy?: boolean;
  busyLabel?: string;
}

// The console's buttons, in clay: raised, lit from above, and pressed in
// while held. A plain button unless told otherwise, so one never sends a
// form by accident.
export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  busy = false,
  busyLabel,
  type = 'button',
  className = '',
  children,
  onClick,
  ...rest
}: ButtonProps) {
  function click(event: MouseEvent<HTMLButtonElement>) {
    if (busy) {
      // Also stops a form being sent a second time.
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  return (
    <button
      type={type}
      aria-disabled={busy || undefined}
      onClick={click}
      className={`${buttonClass(variant, size)} ${className}`}
      {...rest}
    >
      {busy ? (
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
      ) : Icon ? (
        <Icon aria-hidden="true" className="size-4" />
      ) : null}
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}
