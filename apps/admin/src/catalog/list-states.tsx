import { RefreshCw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../components/Button';

// What a catalog page shows before its list is there, when it could not be
// loaded, and when it is empty.

export function ListLoading({ label }: { label: string }) {
  return (
    <div className="mt-8">
      <output className="sr-only">{label}</output>
      <ul aria-hidden="true" className="space-y-2">
        {[0, 1, 2, 3].map((row) => (
          <li
            key={row}
            className="h-16 animate-pulse rounded-card bg-surface-muted"
          />
        ))}
      </ul>
    </div>
  );
}

export function LoadFailed({
  title,
  message,
  retrying,
  onRetry,
}: {
  title: string;
  message: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="mt-8 rounded-card border border-line bg-surface p-6 text-center"
    >
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-ink-muted">{message}</p>
      <Button
        icon={RefreshCw}
        onClick={onRetry}
        busy={retrying}
        className="mt-4"
      >
        Try again
      </Button>
    </div>
  );
}

export function EmptyList({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="mt-8 flex flex-col items-center rounded-card border border-dashed border-line bg-surface p-10 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-primary-soft text-primary">
        <Icon aria-hidden="true" className="size-6" />
      </span>
      <p className="mt-4 font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-ink-muted">{children}</p>
      <div className="mt-5">{action}</div>
    </div>
  );
}
