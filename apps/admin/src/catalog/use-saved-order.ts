import { useCallback, useEffect, useRef, useState } from 'react';

interface Options<T extends { id: string }> {
  // The order the server has, from the cache.
  items: T[] | undefined;
  // Sends a whole new order; answers the list as the server now has it.
  send: (ids: string[]) => Promise<T[]>;
  // The answer, for the cache.
  onSaved: (items: T[]) => void;
  // The order went back to the server's: say why, and read it again.
  onFailed: (error: unknown) => void;
}

export interface SavedOrder {
  // The order on screen: the one staff are making, else the server's.
  ids: string[];
  // While a row is dragged: the screen follows, nothing is sent yet.
  arrange: (ids: string[]) => void;
  // The new order is final (a drop, an arrow key): it is sent.
  save: (ids: string[]) => void;
  saving: boolean;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

// Drag-and-drop ordering (ADR 0032): the screen moves at once, and the new
// order goes to the server as one list. One request at a time: moves made
// while one is on the way are sent after it, as their latest order only, so
// an older order can never arrive last. A failure puts the server's order
// back.
export function useSavedOrder<T extends { id: string }>({
  items,
  send,
  onSaved,
  onFailed,
}: Options<T>): SavedOrder {
  const [draft, setDraft] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const serverIds = items?.map((item) => item.id) ?? [];

  const latest = useRef({ send, onSaved, onFailed, serverIds });
  useEffect(() => {
    latest.current = { send, onSaved, onFailed, serverIds };
  });
  const inFlight = useRef(false);
  const queued = useRef<string[] | null>(null);

  // A named function, as it calls itself for the order that waited.
  const save = useCallback(function save(ids: string[]) {
    setDraft(ids);
    if (inFlight.current) {
      queued.current = ids;
      return;
    }
    if (sameOrder(ids, latest.current.serverIds)) {
      // Dropped where it started: nothing to send.
      setDraft(null);
      return;
    }
    inFlight.current = true;
    setSaving(true);
    latest.current.send(ids).then(
      (saved) => {
        latest.current.onSaved(saved);
        const savedIds = saved.map((item) => item.id);
        latest.current.serverIds = savedIds;
        finish(savedIds);
      },
      (error: unknown) => {
        queued.current = null;
        setDraft(null);
        finish(null);
        latest.current.onFailed(error);
      },
    );

    function finish(savedIds: string[] | null) {
      inFlight.current = false;
      const next = queued.current;
      queued.current = null;
      if (next && !(savedIds && sameOrder(next, savedIds))) {
        save(next);
        return;
      }
      setSaving(false);
      // The screen follows the server again, unless a row is being dragged
      // into yet another order.
      if (savedIds) {
        setDraft((current) =>
          current && sameOrder(current, savedIds) ? null : current,
        );
      }
    }
  }, []);

  return { ids: draft ?? serverIds, arrange: setDraft, save, saving };
}
