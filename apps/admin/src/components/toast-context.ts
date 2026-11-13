import { createContext, useContext } from 'react';

export type ToastKind = 'success' | 'error';

// Short notes that something happened ("Category saved"). They go away on
// their own; anything staff must act on stays on the page instead.
export interface Toasts {
  show(message: string, kind?: ToastKind): void;
}

export const ToastContext = createContext<Toasts | null>(null);

export function useToasts(): Toasts {
  const toasts = useContext(ToastContext);
  if (!toasts) {
    throw new Error('useToasts is used outside the ToastProvider');
  }
  return toasts;
}
