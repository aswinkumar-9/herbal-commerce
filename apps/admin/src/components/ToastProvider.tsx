import { CircleAlert, CircleCheck, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { DURATION, EASE_OUT, transition } from '../motion';
import { ToastContext } from './toast-context';
import type { ToastKind } from './toast-context';

// How long a note stays, unless the pointer or the focus is on it.
export const TOAST_MS: Record<ToastKind, number> = {
  success: 5000,
  error: 8000,
};
// More than this and the oldest goes.
const MOST = 3;

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

// Holds the notes for the signed-in console. It lives in the AppShell, so
// signing out takes every note with it.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const lastId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.filter((toast) => toast.id !== id));
  }, []);
  const show = useCallback((message: string, kind: ToastKind = 'success') => {
    lastId.current += 1;
    const toast = { id: lastId.current, message, kind };
    setToasts((all) => [...all, toast].slice(-MOST));
  }, []);
  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Always on the page, so a screen reader hears each new note. */}
      <output
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:items-end"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <ToastNote key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </AnimatePresence>
      </output>
    </ToastContext.Provider>
  );
}

function ToastNote({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  const [held, setHeld] = useState({ pointer: false, focus: false });
  const paused = held.pointer || held.focus;

  useEffect(() => {
    if (paused) {
      return;
    }
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_MS[toast.kind]);
    return () => clearTimeout(timer);
  }, [paused, onDismiss, toast.id, toast.kind]);

  const Icon = toast.kind === 'error' ? CircleAlert : CircleCheck;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition }}
      exit={{
        opacity: 0,
        x: 24,
        transition: { duration: DURATION.fast, ease: EASE_OUT },
      }}
      onPointerEnter={() => setHeld((h) => ({ ...h, pointer: true }))}
      onPointerLeave={() => setHeld((h) => ({ ...h, pointer: false }))}
      onFocus={() => setHeld((h) => ({ ...h, focus: true }))}
      onBlur={() => setHeld((h) => ({ ...h, focus: false }))}
      className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card border bg-surface p-3 pl-4 text-sm shadow-soft ${
        toast.kind === 'error' ? 'border-danger/40' : 'border-line'
      }`}
    >
      <Icon
        aria-hidden="true"
        className={`mt-0.5 size-4 shrink-0 ${
          toast.kind === 'error' ? 'text-danger' : 'text-primary'
        }`}
      />
      <p className="flex-1">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="-m-1 grid size-7 shrink-0 place-items-center rounded-md text-ink-muted hover:bg-surface-muted hover:text-ink"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </motion.div>
  );
}
