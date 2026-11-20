import { Leaf } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

// Nothing to show: what happened, and a way on (never a blank space).
export function EmptyState({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-3xl bg-surface p-8">
      <Leaf aria-hidden="true" weight="light" className="size-8 text-accent" />
      <p className="title-2 text-ink">{title}</p>
      {hint ? <p className="body-6 text-ink-muted">{hint}</p> : null}
      {children}
    </div>
  );
}
