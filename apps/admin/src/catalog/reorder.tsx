import { Check, GripVertical } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { DragControls } from 'motion/react';
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useSavedOrder } from './use-saved-order';

// How long "Order saved" stays.
const SAVED_NOTE_MS = 2500;

interface Named {
  id: string;
  name: string;
}

interface Options<T extends Named> {
  // The list as the server has it, first to last.
  items: T[] | undefined;
  send: (ids: string[]) => Promise<T[]>;
  onSaved: (items: T[]) => void;
  onFailed: (error: unknown) => void;
}

export interface Reordering<T extends Named> {
  // The rows on screen, in the order staff are making.
  rows: T[];
  rowIds: string[];
  // For the list's onReorder, while a row is dragged.
  arrange: (ids: string[]) => void;
  saving: boolean;
  savedNote: boolean;
  // The last move, for a screen reader.
  announcement: string;
  // Ties each handle to the help that says how to move rows.
  helpId: string;
  keyMove: (item: T, event: KeyboardEvent) => void;
  dragStart: (item: T) => void;
  drop: (item: T) => void;
}

// Drag-and-drop ordering of a list of named rows (ADR 0032), with the
// keyboard too: Up and Down move a row one place, Home and End to the top or
// the bottom. Each move is read out, and saved as one new order.
export function useReorder<T extends Named>({
  items,
  send,
  onSaved,
  onFailed,
}: Options<T>): Reordering<T> {
  const [announcement, setAnnouncement] = useState('');
  const [savedNote, setSavedNote] = useState(false);
  const order = useSavedOrder({
    items,
    send,
    onSaved: (saved) => {
      onSaved(saved);
      setSavedNote(true);
    },
    onFailed,
  });

  useEffect(() => {
    if (!savedNote) {
      return;
    }
    const timer = setTimeout(() => setSavedNote(false), SAVED_NOTE_MS);
    return () => clearTimeout(timer);
  }, [savedNote]);

  const byId = new Map(items?.map((item) => [item.id, item]));
  const rows = order.ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
  const rowIds = rows.map((item) => item.id);

  // Read when a drag ends, after the last move has drawn.
  const shownIds = useRef(rowIds);
  useEffect(() => {
    shownIds.current = rowIds;
  });
  const dragFrom = useRef<number | null>(null);
  const helpId = useId();

  function announceMove(item: T, ids: string[]) {
    const at = ids.indexOf(item.id) + 1;
    setAnnouncement(`${item.name} moved to position ${at} of ${ids.length}.`);
  }

  // The handle keeps the focus as its row moves: React puts it back after
  // moving the row in the page.
  function keyMove(item: T, event: KeyboardEvent) {
    const from = rowIds.indexOf(item.id);
    const last = rowIds.length - 1;
    const to =
      event.key === 'ArrowUp'
        ? from - 1
        : event.key === 'ArrowDown'
          ? from + 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (to === null) {
      return;
    }
    event.preventDefault();
    if (to < 0 || to > last || to === from) {
      return;
    }
    const next = [...rowIds];
    next.splice(from, 1);
    next.splice(to, 0, item.id);
    order.save(next);
    announceMove(item, next);
  }

  function dragStart(item: T) {
    dragFrom.current = rowIds.indexOf(item.id);
  }

  function drop(item: T) {
    const ids = shownIds.current;
    if (dragFrom.current !== ids.indexOf(item.id)) {
      announceMove(item, ids);
    }
    dragFrom.current = null;
    order.save(ids);
  }

  return {
    rows,
    rowIds,
    arrange: order.arrange,
    saving: order.saving,
    savedNote,
    announcement,
    helpId,
    keyMove,
    dragStart,
    drop,
  };
}

// Above the list: how to move rows (the keys for screen readers), and
// whether the order is saved. Each move is read out.
export function OrderBar({
  order,
  noun,
  children,
}: {
  order: Pick<
    Reordering<Named>,
    'helpId' | 'saving' | 'savedNote' | 'announcement'
  >;
  // "category" or "product".
  noun: string;
  // What staff see: how to drag.
  children: ReactNode;
}) {
  return (
    <>
      <div className="mt-8 flex min-h-6 flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
        <p id={order.helpId}>
          {children}
          <span className="sr-only">
            {' '}
            Or press Up or Down to move a {noun} one place, Home or End to move
            it to the top or the bottom.
          </span>
        </p>
        {/* Read out as it changes. */}
        <output className="flex items-center gap-1.5">
          <AnimatePresence mode="wait" initial={false}>
            {order.saving ? (
              <motion.span
                key="saving"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                Saving the order…
              </motion.span>
            ) : order.savedNote ? (
              <motion.span
                key="saved"
                initial={{ opacity: 0, y: 2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-1.5 text-primary"
              >
                <Check aria-hidden="true" className="size-4" />
                Order saved
              </motion.span>
            ) : null}
          </AnimatePresence>
        </output>
      </div>
      <p className="sr-only" aria-live="assertive">
        {order.announcement}
      </p>
    </>
  );
}

// The grip a row is dragged by, or moved with the arrow keys.
export function DragHandle({
  label,
  helpId,
  controls,
  onKeyDown,
}: {
  label: string;
  helpId: string;
  controls: DragControls;
  onKeyDown: (event: KeyboardEvent) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-describedby={helpId}
      onPointerDown={(event) => controls.start(event)}
      onKeyDown={onKeyDown}
      className="relative z-10 grid size-9 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-ink-muted hover:bg-surface-muted hover:text-ink active:cursor-grabbing"
    >
      <GripVertical aria-hidden="true" className="size-4" />
    </button>
  );
}
