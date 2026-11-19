import type { ReactNode } from 'react';
import { LEVEL_NAMES } from './stock-display';
import type { StockLevel } from './stock-api';

const LEVEL_STYLES: Record<StockLevel, string> = {
  OUT: 'bg-danger-soft text-danger',
  LOW: 'bg-warning-soft text-warning',
  OK: 'bg-primary-soft text-primary-strong',
};

// A small word beside a name, such as "Draft" or "Off sale".
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-ink-muted shadow-chip inset-shadow-clay">
      {children}
    </span>
  );
}

// Out of stock, low or in stock, in its colour. The word says it too, for
// those who cannot tell the colours apart.
export function LevelTag({ level }: { level: StockLevel }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-chip inset-shadow-clay ${LEVEL_STYLES[level]}`}
    >
      {LEVEL_NAMES[level]}
    </span>
  );
}
