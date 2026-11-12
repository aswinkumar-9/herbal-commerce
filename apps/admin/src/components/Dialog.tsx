import { TriangleAlert } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { DURATION, EASE_OUT, transition } from '../motion';

interface DialogProps {
  open: boolean;
  // Escape, a click outside, or a button that cancels.
  onClose: () => void;
  title: string;
  // What the dialog is about, read out when it opens.
  description?: ReactNode;
  // Anything more, such as a form with its own buttons (DialogActions).
  children?: ReactNode;
  // The buttons, the safe one first: it takes the focus when the dialog
  // opens (unless the children come first with a field).
  actions?: ReactNode;
  tone?: 'default' | 'danger';
  // A form needs more room than a question.
  size?: 'sm' | 'md';
  // While a change is being sent: Escape and a click outside do nothing.
  locked?: boolean;
}

// A question that needs an answer before staff go on. The browser's own
// modal dialog: the rest of the page cannot be reached while it is open, and
// the focus goes back where it was when it closes.
export function Dialog({ open, ...box }: DialogProps) {
  return (
    <AnimatePresence>
      {open ? <DialogBox key="dialog" {...box} /> : null}
    </AnimatePresence>
  );
}

function DialogBox({
  onClose,
  title,
  description,
  children,
  actions,
  tone = 'default',
  size = 'sm',
  locked = false,
}: Omit<DialogProps, 'open'>) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const latest = useRef({ onClose, locked });
  useEffect(() => {
    latest.current = { onClose, locked };
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    let pressedOutside = false;

    // Escape: the dialog stays open until the page says it closes.
    const cancel = (event: Event) => {
      event.preventDefault();
      if (!latest.current.locked) {
        latest.current.onClose();
      }
    };
    // The browser may close it anyway (Escape pressed twice): the page
    // hears of it, or it opens again while locked.
    const closed = () => {
      if (dialog.open) {
        return;
      }
      if (latest.current.locked) {
        dialog.showModal();
      } else {
        latest.current.onClose();
      }
    };
    // A click on the backdrop lands on the dialog itself. Both the press
    // and the release must be there: dragging out of a text box is not a
    // click outside.
    const press = (event: PointerEvent) => {
      pressedOutside = event.target === dialog;
    };
    const click = (event: MouseEvent) => {
      if (pressedOutside && event.target === dialog && !latest.current.locked) {
        latest.current.onClose();
      }
      pressedOutside = false;
    };

    dialog.addEventListener('cancel', cancel);
    dialog.addEventListener('close', closed);
    dialog.addEventListener('pointerdown', press);
    dialog.addEventListener('click', click);
    dialog.showModal();
    return () => {
      dialog.removeEventListener('cancel', cancel);
      dialog.removeEventListener('close', closed);
      dialog.removeEventListener('pointerdown', press);
      dialog.removeEventListener('click', click);
      if (dialog.open) {
        dialog.close();
      }
      if (opener?.isConnected) {
        opener.focus();
      }
    };
  }, []);

  return (
    <motion.dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? bodyId : undefined}
      initial={{ opacity: 0, scale: 0.96, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0, transition }}
      exit={{
        opacity: 0,
        scale: 0.98,
        transition: { duration: DURATION.fast, ease: EASE_OUT },
      }}
      className={`m-auto max-h-[calc(100dvh-2rem)] overflow-y-auto ${
        size === 'md'
          ? 'w-[min(34rem,calc(100%-2rem))]'
          : 'w-[min(28rem,calc(100%-2rem))]'
      } rounded-card border border-line bg-surface p-0 text-ink shadow-soft backdrop:bg-black/45`}
    >
      <div className="p-6">
        <div className="flex items-start gap-3">
          {tone === 'danger' ? (
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-danger-soft text-danger">
              <TriangleAlert aria-hidden="true" className="size-5" />
            </span>
          ) : null}
          <h2 id={titleId} className="pt-1.5 text-lg font-semibold">
            {title}
          </h2>
        </div>
        {description ? (
          <div id={bodyId} className="mt-3 space-y-2 text-sm text-ink-muted">
            {description}
          </div>
        ) : null}
        {children}
        {actions ? <DialogActions>{actions}</DialogActions> : null}
      </div>
    </motion.dialog>
  );
}

// A dialog's buttons, on the right.
export function DialogActions({ children }: { children: ReactNode }) {
  return (
    <div className="mt-6 flex flex-wrap justify-end gap-2">{children}</div>
  );
}
